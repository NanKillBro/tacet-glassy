import { isLoadCommand, type WorkerResultMessage } from "./protocol.js";

// -- ORT surface used here ---------------------------------------

interface OrtEnv {
  wasm: { wasmPaths?: string };
}

interface OrtInferenceSessionStatic {
  create(buffer: ArrayBufferLike | Uint8Array, options?: { executionProviders?: string[] }): Promise<unknown>;
}

interface OrtModule {
  env: OrtEnv;
  InferenceSession: OrtInferenceSessionStatic;
}

// chrome.runtime is bound to the isolated-world realm, not to a Worker's
// global scope (a Worker's self.origin inherits the page's origin, and no
// chrome.* bindings are injected there). The base URL is passed in on the
// "load" command instead of calling chrome.runtime.getURL() from in here.

// -- Minimal valid ONNX model, hand-encoded --------------------------------
//
// A single Identity node over a [1,1] float32 tensor: the smallest graph ORT
// will actually build a session from. Passing real bytes makes the check
// below a positive test, success means the webgpu EP genuinely built a
// session, so there is no error string it could fail to recognise and
// misreport as a pass. Encoded by hand against onnx/onnx's onnx.proto3
// (ModelProto, GraphProto, NodeProto, ValueInfoProto, TypeProto,
// TensorShapeProto); a protobuf library is not worth pulling in for 111
// bytes. Verified end to end against onnxruntime-web's wasm backend in Node
// before this replaced the old check: the session builds, reports
// inputNames ["x"] / outputNames ["y"], and running it on 3.5 returns 3.5.

function varint(value: number): number[] {
  const bytes: number[] = [];
  let v = value >>> 0;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return bytes;
}

function tag(fieldNumber: number, wireType: number): number[] {
  return varint((fieldNumber << 3) | wireType);
}

function lengthDelimited(fieldNumber: number, bytes: number[]): number[] {
  return [...tag(fieldNumber, 2), ...varint(bytes.length), ...bytes];
}

function stringField(fieldNumber: number, value: string): number[] {
  return lengthDelimited(fieldNumber, Array.from(new TextEncoder().encode(value)));
}

function varintField(fieldNumber: number, value: number): number[] {
  return [...tag(fieldNumber, 0), ...varint(value)];
}

function messageField(fieldNumber: number, bytes: number[]): number[] {
  return lengthDelimited(fieldNumber, bytes);
}

const ONNX_ELEM_TYPE_FLOAT = 1;

function buildShape(dims: number[]): number[] {
  return dims.flatMap(dim => messageField(1, varintField(1, dim)));
}

function buildValueInfo(name: string, dims: number[]): number[] {
  const tensorType = [...varintField(1, ONNX_ELEM_TYPE_FLOAT), ...messageField(2, buildShape(dims))];
  const typeProto = messageField(1, tensorType);
  return [...stringField(1, name), ...messageField(2, typeProto)];
}

function buildIdentityNode(): number[] {
  return [
    ...stringField(1, "x"),
    ...stringField(2, "y"),
    ...stringField(3, "identity_node"),
    ...stringField(4, "Identity"),
  ];
}

function buildGraph(): number[] {
  const dims = [1, 1];
  return [
    ...messageField(1, buildIdentityNode()),
    ...stringField(2, "blk-spike-graph"),
    ...messageField(11, buildValueInfo("x", dims)),
    ...messageField(12, buildValueInfo("y", dims)),
  ];
}

function buildMinimalOnnxModel(): Uint8Array {
  const opsetImport = varintField(2, 13);
  return new Uint8Array([
    ...varintField(1, 7),
    ...messageField(8, opsetImport),
    ...stringField(2, "blk-spike"),
    ...messageField(7, buildGraph()),
  ]);
}

const MINIMAL_ONNX_MODEL_BYTES = buildMinimalOnnxModel();

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runChecks(ortBaseUrl: string): Promise<WorkerResultMessage> {
  const hasNavigatorGpu = typeof navigator !== "undefined" && "gpu" in navigator;

  let ort: OrtModule | null = null;
  let ortLoaded = false;
  let ortError: string | null = null;

  try {
    const bundleUrl = `${ortBaseUrl}ort.webgpu.bundle.min.mjs`;
    ort = (await import(bundleUrl)) as OrtModule;
    ort.env.wasm.wasmPaths = ortBaseUrl;
    ortLoaded = true;
  } catch (error) {
    ortError = toErrorMessage(error);
  }

  let webgpuSession = false;
  let webgpuError: string | null = null;

  if (ort) {
    try {
      await ort.InferenceSession.create(MINIMAL_ONNX_MODEL_BYTES, { executionProviders: ["webgpu"] });
      webgpuSession = true;
    } catch (error) {
      webgpuError = toErrorMessage(error);
    }
  } else {
    webgpuError = "ort module did not load";
  }

  return {
    type: "result",
    ortLoaded,
    webgpuSession,
    hasNavigatorGpu,
    ortError,
    webgpuError,
  };
}

self.addEventListener("message", event => {
  const data: unknown = event.data;
  if (!isLoadCommand(data)) return;
  runChecks(data.ortBaseUrl)
    .then(result => self.postMessage(result))
    .catch(error => {
      const result: WorkerResultMessage = {
        type: "result",
        ortLoaded: false,
        webgpuSession: false,
        hasNavigatorGpu: typeof navigator !== "undefined" && "gpu" in navigator,
        ortError: toErrorMessage(error),
        webgpuError: null,
      };
      self.postMessage(result);
    });
});
