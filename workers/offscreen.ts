import { isWorkerResultMessage, type LoadCommand } from "./protocol.js";
import { isRunPathBCommand, type LogMessage, type StepMessage } from "./protocol2.js";

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
    sendStep("ortWasmInstantiate", false, message);
    return;
  }

  try {
    await WebAssembly.instantiate(bytes);
    sendStep("ortWasmInstantiate", true);
  } catch (error) {
    sendStep("ortWasmInstantiate", false, toErrorMessage(error));
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
      worker = new Worker(chrome.runtime.getURL("assets/separator.js"), { type: "module" });
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

chrome.runtime.onMessage.addListener(message => {
  if (!isRunPathBCommand(message)) return;
  runPathB().catch(error => {
    sendStep("done", false, toErrorMessage(error));
  });
});
