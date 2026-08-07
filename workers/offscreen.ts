import { type LoadCommand, isWorkerResultMessage } from "./protocol.js";
import {
  type LogMessage,
  type StepMessage,
  isCancelSeparationCommand,
  isCaptureChunkMessage,
  isRunPathBCommand,
} from "./protocol2.js";
import { SeparationHost } from "./separation-host.js";
import { TrackPipeline } from "./track-pipeline.js";

// -- Path B: offscreen document ----------------------------------------------
//
// Runs at the extension's own origin, so Worker construction, IndexedDB, and
// navigator.storage all share that origin rather than the page's. Reports
// each step to the background service worker, which relays it to the
// content script tab that asked for this run.

const WORKER_TIMEOUT_MS = 15000;
const TEST_DB_NAME = "blk-spike2-test";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sendStep(step: string, ok: boolean, error?: string): void {
  const message: StepMessage = { type: "blk-spike2-step", path: "B", step, ok };
  if (error !== undefined) message.error = error;
  chrome.runtime.sendMessage(message).catch(err => {
    console.error("[BLK-SPIKE2-OFFSCREEN] failed to send step", err);
  });
}

function sendLog(line: string): void {
  const message: LogMessage = { type: "blk-spike2-log", path: "B", line };
  chrome.runtime.sendMessage(message).catch(err => {
    console.error("[BLK-SPIKE2-OFFSCREEN] failed to send log", err);
  });
}

// -- Checks -----------------------------------------------------------------

function checkNavigatorGpu(): void {
  const hasGpu = typeof navigator !== "undefined" && "gpu" in navigator;
  if (hasGpu) sendStep("navigatorGpu", true);
  else sendStep("navigatorGpu", false, "navigator.gpu not present");
}

async function checkOrtWasm(): Promise<void> {
  let bytes: ArrayBuffer;
  try {
    const response = await fetch(chrome.runtime.getURL("assets/ort/ort-wasm-simd-threaded.jspi.wasm"));
    if (!response.ok) throw new Error(`fetch status ${response.status}`);
    bytes = await response.arrayBuffer();
    sendStep("ortWasmFetch", true);
  } catch (error) {
    const message = toErrorMessage(error);
    sendStep("ortWasmFetch", false, message);
    sendStep("ortWasmCompile", false, message);
    return;
  }

  // compile, not instantiate. This step only needs to prove the extension CSP
  // permits WebAssembly; instantiating ORT's module for real would require its
  // full import object, and its absence was reported as a spurious failure.
  try {
    await WebAssembly.compile(bytes);
    sendStep("ortWasmCompile", true);
  } catch (error) {
    sendStep("ortWasmCompile", false, toErrorMessage(error));
  }
}

function checkIndexedDb(): Promise<void> {
  return new Promise(resolve => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(TEST_DB_NAME, 1);
    } catch (error) {
      sendStep("indexedDbOpen", false, toErrorMessage(error));
      resolve();
      return;
    }

    request.onupgradeneeded = () => {
      request.result.createObjectStore("probe");
    };

    request.onsuccess = () => {
      request.result.close();
      indexedDB.deleteDatabase(TEST_DB_NAME);
      sendStep("indexedDbOpen", true);
      resolve();
    };

    request.onerror = () => {
      sendStep("indexedDbOpen", false, toErrorMessage(request.error));
      resolve();
    };

    request.onblocked = () => {
      sendStep("indexedDbOpen", false, "blocked");
      resolve();
    };
  });
}

async function checkStorageEstimate(): Promise<void> {
  try {
    const estimate = await navigator.storage.estimate();
    sendLog(`storageEstimate ${JSON.stringify(estimate)}`);
    sendStep("storageEstimate", true);
  } catch (error) {
    sendStep("storageEstimate", false, toErrorMessage(error));
  }
}

function checkWorker(): Promise<void> {
  return new Promise(resolve => {
    let worker: Worker;
    try {
      worker = new Worker(chrome.runtime.getURL("assets/workers/separator.js"), { type: "module" });
      sendStep("workerConstructed", true);
    } catch (error) {
      const message = toErrorMessage(error);
      sendStep("workerConstructed", false, message);
      sendStep("workerOrtLoaded", false, message);
      sendStep("workerWebgpuSession", false, message);
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve();
    };

    worker.addEventListener("message", event => {
      if (settled) return;
      const data: unknown = event.data;
      if (!isWorkerResultMessage(data)) return;
      if (data.ortLoaded) sendStep("workerOrtLoaded", true);
      else sendStep("workerOrtLoaded", false, data.ortError ?? "ORT did not load");
      if (data.webgpuSession) sendStep("workerWebgpuSession", true);
      else sendStep("workerWebgpuSession", false, data.webgpuError ?? "webgpu session not built");
      finish();
    });

    worker.addEventListener("error", event => {
      if (settled) return;
      const message = event.message.length > 0 ? event.message : "(empty message)";
      const detail = `ErrorEvent message="${message}" filename="${event.filename}" lineno=${event.lineno}`;
      sendStep("workerOrtLoaded", false, detail);
      sendStep("workerWebgpuSession", false, detail);
      finish();
    });

    const loadCommand: LoadCommand = { type: "load", ortBaseUrl: chrome.runtime.getURL("assets/ort/") };
    worker.postMessage(loadCommand);

    setTimeout(() => {
      if (settled) return;
      sendStep("workerOrtLoaded", false, "timed out waiting for worker result");
      sendStep("workerWebgpuSession", false, "timed out waiting for worker result");
      finish();
    }, WORKER_TIMEOUT_MS);
  });
}

// -- Orchestration ------------------------------------------------------

async function runPathB(): Promise<void> {
  checkNavigatorGpu();
  await checkOrtWasm();
  await checkIndexedDb();
  await checkStorageEstimate();
  await checkWorker();
  sendStep("done", true);
}

// -- Real separation host -----------------------------------------------
//
// One Worker for this document's lifetime, shared by the track pipeline
// (workers/track-pipeline.ts) below. Cancellation always goes through the
// pipeline, not straight to the host, so its own notion of "which track is
// active" clears in step with the Worker actually stopping.

const separationHost = new SeparationHost();
const trackPipeline = new TrackPipeline(separationHost);

chrome.runtime.onMessage.addListener(message => {
  if (isRunPathBCommand(message)) {
    runPathB().catch(error => {
      sendStep("done", false, toErrorMessage(error));
    });
    return;
  }

  if (isCaptureChunkMessage(message)) {
    trackPipeline.handleCaptureChunk(message);
    return;
  }

  if (isCancelSeparationCommand(message)) {
    trackPipeline.cancelActive();
  }
});

// -- Stem verification hook -----------------------------------------------
//
// Answers "is there actually a separated stem in there". Reads the cached
// stems straight out of IndexedDB and reports, per stem, the RMS and the
// normalised correlation between the two. Separation that worked yields two
// largely independent signals, so correlation is low. Separation that
// silently passed the original through twice yields correlation near 1.

interface StemAnalysis {
  key: string;
  vocalsBytes: number;
  instrumentalBytes: number;
  frames: number;
  sampleRate: number;
  vocalsRms: number;
  instrumentalRms: number;
  correlation: number;
  verdict: string;
}

function rms(channel: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
  return Math.sqrt(sum / Math.max(1, channel.length));
}

function correlate(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  const denom = Math.sqrt(aa * bb);
  return denom === 0 ? 0 : dot / denom;
}

async function analyseCachedStems(): Promise<StemAnalysis[]> {
  const { decodeOpusToPcm } = await import("../src/cache/opus-codec.js");
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("blk-cache");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const entries = await new Promise<Array<{ key: IDBValidKey; value: Record<string, unknown> }>>((resolve, reject) => {
    const tx = db.transaction("stems", "readonly");
    const store = tx.objectStore("stems");
    const collected: Array<{ key: IDBValidKey; value: Record<string, unknown> }> = [];
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve(collected);
        return;
      }
      collected.push({ key: cursor.key, value: cursor.value as Record<string, unknown> });
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
  db.close();

  const results: StemAnalysis[] = [];
  for (const entry of entries) {
    const vocalsBlob = entry.value.vocals as Blob;
    const instrumentalBlob = entry.value.instrumental as Blob;
    const vocals = await decodeOpusToPcm(vocalsBlob);
    const instrumental = await decodeOpusToPcm(instrumentalBlob);
    const vocalsRms = rms(vocals.channels[0]);
    const instrumentalRms = rms(instrumental.channels[0]);
    const correlation = correlate(vocals.channels[0], instrumental.channels[0]);
    results.push({
      key: String(entry.key),
      vocalsBytes: vocalsBlob.size,
      instrumentalBytes: instrumentalBlob.size,
      frames: vocals.channels[0].length,
      sampleRate: vocals.sampleRate,
      vocalsRms,
      instrumentalRms,
      correlation,
      verdict:
        vocalsRms < 1e-4
          ? "FAILED: vocals stem is silent"
          : Math.abs(correlation) > 0.8
            ? "FAILED: stems are near-identical, separation did not happen"
            : "OK: stems are distinct signals",
    });
  }
  return results;
}

(self as unknown as Record<string, unknown>).blkAnalyseCachedStems = analyseCachedStems;
