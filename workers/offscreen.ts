import { SEPARATION_VERSION, clearAllAliases } from "../src/cache/keys.js";
import { clearCachedModel, getCachedModelSize } from "../src/cache/model-cache.js";
import { clearAllStemRecords, evictUntilWithinBudget, getTotalStemBytes } from "../src/cache/stem-store.js";
import { DEFAULT_SETTINGS, shouldEvictForNewBudget } from "../src/settings/settings.js";
import type { Settings } from "../src/settings/settings.js";
import { type LoadCommand, isWorkerResultMessage } from "./protocol.js";
import {
  type CacheStatusMessage,
  type ClearCacheResultMessage,
  type GetSettingsCommand,
  type LogMessage,
  type StepMessage,
  isCancelSeparationCommand,
  isCaptureChunkMessage,
  isClearModelCacheCommand,
  isClearStemCacheCommand,
  isGetCacheStatusCommand,
  isProbeCacheCommand,
  isRunPathBCommand,
  isSettingsChangedMessage,
  isSettingsMessage,
} from "./protocol2.js";
import { SeparationHost } from "./separation-host.js";
import { TrackPipeline, fetchModelUrl } from "./track-pipeline.js";
import { createLogger } from "../src/shared/logger.js";

const logger = createLogger("offscreen");

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
    logger.error("failed to send step", err);
  });
}

function sendLog(line: string): void {
  const message: LogMessage = { type: "blk-spike2-log", path: "B", line };
  chrome.runtime.sendMessage(message).catch(err => {
    logger.error("failed to send log", err);
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

// -- Separation version purge -------------------------------------------------
//
// Content keys now include the model identity, but a videoId alias written by an
// older build still points at a record produced by that older model. Left alone,
// a probe follows the stale alias and serves stems the current model would never
// produce: the fp16 to fp32 switch fixed separation while silent NaN-derived
// stems kept being served from cache. Clearing once per version change is the
// only way to be sure nothing older survives.

const SEPARATION_VERSION_KEY = "blk-separation-version";

function purgeStaleSeparations(): void {
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(SEPARATION_VERSION_KEY);
  } catch (error) {
    logger.warn("could not read the separation version", error);
    return;
  }
  if (previous === SEPARATION_VERSION) return;

  Promise.all([clearAllStemRecords(), clearAllAliases()])
    .then(() => {
      localStorage.setItem(SEPARATION_VERSION_KEY, SEPARATION_VERSION);
      logger.log(`cleared stems from a previous separation version (${previous ?? "none"})`);
    })
    .catch(error => {
      logger.error("failed to purge stale separations", error);
    });
}

purgeStaleSeparations();

// -- Settings-driven cache budget --------------------------------------------
//
// The offscreen document owns every write to the stem store, so it is the
// only place that can apply a changed budget without waiting for a reload:
// it keeps the live cacheBudgetBytes value in memory, evicts right away if
// usage already exceeds a smaller budget, and hands the current value to the
// track pipeline on every future write (see TrackPipeline's constructor).
//
// An offscreen document is granted chrome.runtime and nothing else: chrome.storage
// is undefined here even with the permission declared in the manifest, and
// reading it at module scope threw and took the whole document down with it
// (nothing below ever registered). The current value is fetched from
// background on startup and pushed on every change instead; see
// src/background.ts and workers/protocol2.ts's settings relay.

let currentCacheBudgetBytes = DEFAULT_SETTINGS.cacheBudgetBytes;

function applySettings(settings: Settings): void {
  currentCacheBudgetBytes = settings.cacheBudgetBytes;
}

async function reactToBudgetChange(newBudgetBytes: number): Promise<void> {
  const usedBytes = await getTotalStemBytes();
  if (shouldEvictForNewBudget(usedBytes, newBudgetBytes)) {
    await evictUntilWithinBudget(newBudgetBytes);
  }
}

const getSettingsCommand: GetSettingsCommand = { type: "blk-get-settings" };
chrome.runtime
  .sendMessage(getSettingsCommand)
  .then(response => {
    if (isSettingsMessage(response)) applySettings(response.settings);
  })
  .catch(error => {
    logger.error("failed to load settings", error);
  });

function getCacheBudgetBytes(): number {
  return currentCacheBudgetBytes;
}

// -- Real separation host -----------------------------------------------
//
// One Worker for this document's lifetime, shared by the track pipeline
// (workers/track-pipeline.ts) below. Cancellation always goes through the
// pipeline, not straight to the host, so its own notion of "which track is
// active" clears in step with the Worker actually stopping.

const separationHost = new SeparationHost();
const trackPipeline = new TrackPipeline(separationHost, getCacheBudgetBytes);

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
    return;
  }

  if (isSettingsChangedMessage(message)) {
    applySettings(message.settings);
    reactToBudgetChange(message.settings.cacheBudgetBytes).catch(error => {
      logger.error("failed to react to a settings change", error);
    });
  }
});

// -- Cache status and clearing (popup) ---------------------------------------
//
// Routed through src/background.ts, since only the offscreen document holds
// the live IndexedDB connection and knows whether a separation is currently
// running. A running separation is cancelled first in both cases, so a job
// in flight cannot write a fresh record into a store the user just asked to
// empty. See src/settings/ for the setting this reacts to.

async function fetchCacheStatus(): Promise<CacheStatusMessage> {
  const stemCacheBytes = await getTotalStemBytes();
  const modelUrl = await fetchModelUrl();
  const modelCacheBytes = modelUrl ? await getCachedModelSize(modelUrl) : null;
  return {
    type: "blk-cache-status",
    stemCacheBytes,
    modelCached: modelCacheBytes !== null,
    modelCacheBytes: modelCacheBytes ?? 0,
  };
}

async function clearStemCache(): Promise<ClearCacheResultMessage> {
  trackPipeline.cancelActive();
  await clearAllStemRecords();
  await clearAllAliases();
  return { type: "blk-clear-cache-result", target: "stems", ok: true };
}

async function clearModelCache(): Promise<ClearCacheResultMessage> {
  trackPipeline.cancelActive();
  const modelUrl = await fetchModelUrl();
  if (!modelUrl) {
    return { type: "blk-clear-cache-result", target: "model", ok: false, reason: "No model URL is configured." };
  }
  await clearCachedModel(modelUrl);
  return { type: "blk-clear-cache-result", target: "model", ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isGetCacheStatusCommand(message)) {
    fetchCacheStatus()
      .then(sendResponse)
      .catch(error => {
        logger.error("failed to read cache status", error);
      });
    return true;
  }

  if (isClearStemCacheCommand(message)) {
    clearStemCache()
      .then(sendResponse)
      .catch(error => {
        logger.error("failed to clear the stem cache", error);
      });
    return true;
  }

  if (isClearModelCacheCommand(message)) {
    clearModelCache()
      .then(sendResponse)
      .catch(error => {
        logger.error("failed to clear the model cache", error);
      });
    return true;
  }

  return undefined;
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

chrome.runtime.onMessage.addListener(message => {
  if (!isProbeCacheCommand(message)) return undefined;
  trackPipeline.probeCache(message.videoId).catch(error => {
    logger.error("cache probe failed", error);
  });
  return undefined;
});

(self as unknown as Record<string, unknown>).blkAnalyseCachedStems = analyseCachedStems;

// -- Synthetic pipeline bisect --------------------------------------------
//
// Runs the real separation path over a generated signal, so the capture and
// decode stages can be ruled in or out without waiting on a track to buffer.

async function runSelfTest(forceWasm = false): Promise<unknown> {
  const { runPipelineSelfTest } = await import("./pipeline-selftest.js");
  const modelUrl = await fetchModelUrl();
  if (!modelUrl) return { verdict: "FAILED: no separation model URL is configured" };
  return runPipelineSelfTest(separationHost, modelUrl, forceWasm);
}

(self as unknown as Record<string, unknown>).blkRunPipelineSelfTest = runSelfTest;
