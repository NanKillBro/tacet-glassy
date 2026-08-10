"""Convert the fp32 htdemucs export to a half precision model the WebGPU
execution provider computes correctly.

    uv venv --python 3.12 .venv-onnx
    VIRTUAL_ENV=.venv-onnx uv pip install onnx onnxruntime onnxconverter-common numpy
    .venv-onnx/bin/python tooling/convert-fp16.py models/htdemucs_fp32.v1.onnx models/htdemucs_fp16.v2.onnx

A plain convert_float_to_float16 pass produces a model that is correct on the
CPU and wasm providers and entirely NaN on WebGPU. ORT's CPU kernels widen to
fp32 internally; its WebGPU shaders do not, so any reduction that exceeds 65504
saturates. Three sites in htdemucs do:

  ReduceMean      demucs standardises its own input, and the sum of squares over
                  a 343980 sample segment reaches ~1.6e7.
  ConvTranspose   the tdecoder transposed convolutions lose most of their
                  precision, which silently wrecks the time branch (relative
                  error 0.91) without ever producing a NaN.
  the two standardisation prologues
                  their Bessel correction constants are the element counts,
                  2752512 and 687960. Neither is representable in fp16, so the
                  converter clamps them to max_finite_val and the surviving
                  multiply overflows on loud input.

Blocking those keeps the rest of the network in fp16. Measured against the fp32
CPU reference on one segment: 32 dB SNR, 0.9997 correlation, no NaN across an
8192x input amplitude sweep.
"""

import collections
import json
import sys

import onnx
from onnxconverter_common.float16 import convert_float_to_float16

OP_BLOCK_LIST = ["ReduceMean", "ConvTranspose"]

NODE_BLOCK_LIST = [
    # magspec standardisation, Bessel constant 2752512
    "node_mean", "node_Sub_4", "node_Mul_5", "node_ReduceMean_6", "node_Mul_11",
    "node_var", "node_Reshape_22", "node_sqrt", "node_add", "node_div",
    # waveform standardisation, Bessel constant 687960
    "node_mean_1", "node_Sub_29", "node_Mul_30", "node_ReduceMean_31", "node_Mul_36",
    "node_var_1", "node_Reshape_45", "node_sqrt_1", "node_add_1", "node_div_1",
]


def convert(src: str, dst: str) -> dict:
    model = onnx.load(src)

    present = {node.name for node in model.graph.node}
    missing = [name for name in NODE_BLOCK_LIST if name not in present]
    if missing:
        raise SystemExit(f"{src} does not contain these nodes, the export changed: {missing}")

    converted = convert_float_to_float16(
        model,
        keep_io_types=True,
        disable_shape_infer=False,
        op_block_list=OP_BLOCK_LIST,
        node_block_list=NODE_BLOCK_LIST,
    )

    graph = converted.graph
    types = {v: k for k, v in onnx.TensorProto.DataType.items()}

    # keep_io_types is silently defeated when a blocked node lands on the graph
    # boundary. A float16 output reads back as a Uint16Array that every caller
    # in this repo would misread as garbage, so refuse to write one.
    for value in list(graph.input) + list(graph.output):
        actual = types[value.type.tensor_type.elem_type]
        if actual != "FLOAT":
            raise SystemExit(f"{value.name} came out {actual}, expected FLOAT")

    onnx.save(converted, dst)

    ops = collections.Counter(node.op_type for node in graph.node)
    initializers = collections.Counter(types[i.data_type] for i in graph.initializer)
    return {
        "src": src,
        "dst": dst,
        "nodes": len(graph.node),
        "casts": ops["Cast"],
        "initializers": dict(initializers),
        "io": [(v.name, types[v.type.tensor_type.elem_type]) for v in list(graph.input) + list(graph.output)],
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: convert-fp16.py <fp32.onnx> <fp16.onnx>")
    print(json.dumps(convert(sys.argv[1], sys.argv[2]), indent=2))
