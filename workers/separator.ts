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

// Not a valid ONNX model. Its only job is to reach the wasm parser: if the
// backend never loaded (CSP or fetch failure), InferenceSession.create never
// gets this far and throws a load error instead of a parse error.
const DUMMY_MODEL_BYTES = new Uint8Array([0x08, 0x01]);

const CSP_OR_LOAD_ERROR_PATTERNS = [
  "content security policy",
  "refused to",
  "wasm-unsafe-eval",
  "failed to fetch",
  "networkerror",
  "securityerror",
  "csp",
];

function isCspOrLoadError(message: string): boolean {
  const lower = message.toLowerCase();
  return CSP_OR_LOAD_ERROR_PATTERNS.some(pattern => lower.includes(pattern));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// This spike takes the fallback path described in the task: rather than
// hand-building a valid ONNX protobuf model, it calls InferenceSession.create
// with deliberately invalid bytes and classifies the resulting error. A CSP
// or fetch failure throws before the wasm parser runs; a parse failure proves
// the wasm backend fetched and instantiated successfully on the webgpu EP.
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
      await ort.InferenceSession.create(DUMMY_MODEL_BYTES, { executionProviders: ["webgpu"] });
      webgpuSession = true;
    } catch (error) {
      const message = toErrorMessage(error);
      webgpuError = message;
      webgpuSession = !isCspOrLoadError(message);
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
