/// <reference lib="webworker" />
import { type Chunk, SEGMENT_SAMPLES, chunkCount, iterateChunks } from "../src/separation/chunker.js";
import { extractVocalsStem, normalizeForDemucs } from "../src/separation/demucs-postprocess.js";
import { MAGSPEC_DIMS, computeMagspec } from "../src/separation/demucs-spec.js";
import { deriveRegionStems } from "../src/separation/region-stems.js";
import { StreamingStitcher } from "../src/separation/streaming-stitcher.js";
import { buildWaveformTensorData } from "../src/separation/waveform-tensor.js";
import {
  type SeparateOutboundMessage,
  type WorkerResultMessage,
  isLoadCommand,
  isSeparateCancelCommand,
  isSeparateInitCommand,
  isSeparateProcessCommand,
} from "./protocol.js";
import { createLogger } from "../src/shared/logger.js";

const logger = createLogger("separator");

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

// -- Minimal valid ONNX model, hand-encoded --------------------------------

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

// -- Real separation: htdemucs over the webgpu execution provider -----------

const FREQ_OUTPUT_NAME = "output";
const TIME_OUTPUT_NAME = "add_67";
const WAVEFORM_INPUT_NAME = "input";
const MAGSPEC_INPUT_NAME = "x";

interface SeparationOrt {
  InferenceSession: {
    create(
      bytes: ArrayBuffer | Uint8Array,
      opts: { executionProviders: string[]; graphOptimizationLevel?: string }
    ): Promise<SeparationOrtSession>;
  };
  Tensor: new (dtype: "float32", data: Float32Array, dims: readonly number[]) => SeparationOrtTensor;
  env: { wasm: { wasmPaths?: string; numThreads?: number } };
}

interface SeparationOrtTensor {
  data: Float32Array;
  dims: number[];
}

interface SeparationOrtSession {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, SeparationOrtTensor>): Promise<Record<string, SeparationOrtTensor>>;
  release?(): Promise<void>;
}

let separationOrt: SeparationOrt | null = null;
let separationSession: SeparationOrtSession | null = null;
let separateCancelled = false;

function postSeparate(message: SeparateOutboundMessage, transfer?: Transferable[]): void {
  self.postMessage(message, transfer ?? []);
}

async function loadSeparationOrt(ortBaseUrl: string): Promise<SeparationOrt> {
  const bundleUrl = `${ortBaseUrl}ort.webgpu.bundle.min.mjs`;
  const runtime = (await import(bundleUrl)) as SeparationOrt;
  runtime.env.wasm.numThreads = 1;
  runtime.env.wasm.wasmPaths = ortBaseUrl;
  return runtime;
}

async function probeWithZeros(runtime: SeparationOrt, session: SeparationOrtSession): Promise<void> {
  const magspecLength = MAGSPEC_DIMS.reduce((a, b) => a * b, 1);
  for (const amplitude of [0, 1e-3, 1e-1, 1]) {
    try {
      const waveformData = new Float32Array(2 * SEGMENT_SAMPLES);
      const magspecData = new Float32Array(magspecLength);
      for (let i = 0; i < waveformData.length; i++) waveformData[i] = amplitude * Math.sin(i * 0.01);
      for (let i = 0; i < magspecData.length; i++) magspecData[i] = amplitude * Math.sin(i * 0.017);

      const result = await session.run({
        [WAVEFORM_INPUT_NAME]: new runtime.Tensor("float32", waveformData, [1, 2, SEGMENT_SAMPLES]),
        [MAGSPEC_INPUT_NAME]: new runtime.Tensor("float32", magspecData, MAGSPEC_DIMS),
      });
      logger.log(`amp=${amplitude}`, probe(TIME_OUTPUT_NAME, result[TIME_OUTPUT_NAME].data));
    } catch (error) {
      logger.log(`amp=${amplitude} run failed`, toErrorMessage(error));
    }
  }
}

async function handleSeparateInit(
  ortBaseUrl: string,
  modelBytes: ArrayBuffer,
  forceWasm: boolean | undefined
): Promise<void> {
  separateCancelled = false;
  try {
    const runtime = await loadSeparationOrt(ortBaseUrl);
    const providers = forceWasm ? ["wasm"] : ["webgpu", "wasm"];
    separationSession = await runtime.InferenceSession.create(modelBytes, {
      executionProviders: providers,
      graphOptimizationLevel: "all",
    });
    separationOrt = runtime;
    logger.log(`model bytes=${modelBytes.byteLength}`);
    logger.log(
      `session inputs=${JSON.stringify(separationSession.inputNames)} outputs=${JSON.stringify(
        separationSession.outputNames
      )}`
    );
    await probeWithZeros(runtime, separationSession);
    postSeparate({ type: "separate-init-done" });
  } catch (error) {
    postSeparate({ type: "separate-error", code: "ort-failed", message: toErrorMessage(error) });
  }
}

function emitRegion(
  regionStart: number,
  vocalsRegionRaw: Float32Array[],
  originalChannels: Float32Array[],
  normalization: { mean: number; std: number },
  totalFrames: number
): void {
  const { vocals, instrumental } = deriveRegionStems(originalChannels, regionStart, vocalsRegionRaw, normalization);
  const transfers: Transferable[] = [
    ...vocals.map(channel => channel.buffer),
    ...instrumental.map(channel => channel.buffer),
  ];
  postSeparate({ type: "separate-region", vocals, instrumental, regionStart, totalFrames }, transfers);
}

// -- First-chunk NaN probe --------------------------------------------------
function probe(label: string, data: Float32Array): string {
  let nans = 0;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (Number.isNaN(value)) {
      nans++;
      continue;
    }
    sum += value * value;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }
  const finite = data.length - nans;
  const rms = finite > 0 ? Math.sqrt(sum / finite) : 0;
  return `${label}: len=${data.length}, nan=${nans}, rms=${rms.toExponential(3)}, peak=${peak.toExponential(3)}`;
}

async function handleSeparateProcess(channels: Float32Array[], totalFrames: number): Promise<void> {
  if (!separationSession || !separationOrt) {
    postSeparate({ type: "separate-error", code: "ort-failed", message: "Session not initialized." });
    return;
  }
  if (channels.length !== 2) {
    postSeparate({
      type: "separate-error",
      code: "ort-failed",
      message: `HTDemucs requires stereo input (got ${channels.length} channels).`,
    });
    return;
  }

  separateCancelled = false;
  const totalChunks = chunkCount(totalFrames);
  const normalized = normalizeForDemucs(channels, totalFrames);
  const stitcher = new StreamingStitcher(totalFrames, channels.length);

  let chunkIndex = 0;
  for (const chunk of iterateChunks(normalized.channels)) {
    if (separateCancelled) {
      postSeparate({ type: "separate-cancelled" });
      return;
    }

    let waveformTensor: SeparationOrtTensor;
    let magspecTensor: SeparationOrtTensor;
    try {
      const waveformFlat = buildWaveformTensorData(chunk.data);
      waveformTensor = new separationOrt.Tensor("float32", waveformFlat, [1, 2, SEGMENT_SAMPLES]);
      const magspecFlat = computeMagspec(chunk.data);
      magspecTensor = new separationOrt.Tensor("float32", magspecFlat, MAGSPEC_DIMS);
    } catch (error) {
      postSeparate({ type: "separate-error", code: "ort-failed", message: toErrorMessage(error) });
      return;
    }

    let result: Record<string, SeparationOrtTensor>;
    try {
      result = await separationSession.run({
        [WAVEFORM_INPUT_NAME]: waveformTensor,
        [MAGSPEC_INPUT_NAME]: magspecTensor,
      });
    } catch (error) {
      postSeparate({ type: "separate-error", code: "ort-failed", message: toErrorMessage(error) });
      return;
    }

    const timeTensor = result[TIME_OUTPUT_NAME];
    const freqTensor = result[FREQ_OUTPUT_NAME];
    if (!timeTensor || !freqTensor) {
      postSeparate({
        type: "separate-error",
        code: "ort-failed",
        message: `Missing output tensor ${!timeTensor ? TIME_OUTPUT_NAME : FREQ_OUTPUT_NAME}. Available: ${Object.keys(result).join(", ")}`,
      });
      return;
    }

    const vocalsChunk: Chunk = { start: chunk.start, end: chunk.end, data: extractVocalsStem(timeTensor, freqTensor) };

    if (chunkIndex === 0) {
      logger.log(probe("normalized input L", chunk.data[0]));
      logger.log(probe("waveform tensor", waveformTensor.data));
      logger.log(probe("magspec tensor", magspecTensor.data));
      logger.log(probe("model time output", timeTensor.data));
      logger.log(probe("model freq output", freqTensor.data));
      logger.log(probe("extracted vocals L", vocalsChunk.data[0]));
    }

    chunkIndex++;
    postSeparate({ type: "separate-progress", processed: chunkIndex, total: totalChunks });

    const regionStart = stitcher.finalisedFrames;
    const region = stitcher.push(vocalsChunk);
    if (region) emitRegion(regionStart, region, channels, normalized, totalFrames);
  }

  const tailStart = stitcher.finalisedFrames;
  const tail = stitcher.flush();
  if (tail) emitRegion(tailStart, tail, channels, normalized, totalFrames);

  try {
    await separationSession.release?.();
  } catch (error) {
    logger.warn("failed to release ORT session", error);
  }
  separationSession = null;

  postSeparate({ type: "separate-done", totalFrames });
}

self.addEventListener("message", event => {
  const data: unknown = event.data;

  if (isLoadCommand(data)) {
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
    return;
  }

  if (isSeparateInitCommand(data)) {
    handleSeparateInit(data.ortBaseUrl, data.modelBytes, data.forceWasm);
    return;
  }

  if (isSeparateProcessCommand(data)) {
    handleSeparateProcess(data.channels, data.totalFrames);
    return;
  }

  if (isSeparateCancelCommand(data)) {
    separateCancelled = true;
  }
});
