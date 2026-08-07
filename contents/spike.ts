import type { PlasmoCSConfig } from "plasmo";
import { isWorkerResultMessage, type LoadCommand } from "../workers/protocol";

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_start",
  all_frames: false,
};

const LOG_PREFIX = "[BLK-SPIKE]";
const WORKER_TIMEOUT_MS = 15000;
const TRANSFER_TIMEOUT_MS = 5000;

const PAGE_READY_TYPE = "blk-spike-page-ready";
const TRANSFER_TYPE = "blk-spike-transfer";
const TRANSFER_OK_TYPE = "blk-spike-transfer-ok";

interface SpikeResult {
  workerSpawned: boolean;
  ortLoaded: boolean;
  webgpuSession: boolean;
  transferIntact: boolean;
  errors: Record<string, string>;
}

interface WorkerChecksResult {
  workerSpawned: boolean;
  ortLoaded: boolean;
  webgpuSession: boolean;
}

function log(message: string): void {
  console.log(`${LOG_PREFIX} ${message}`);
}

// -- Worker checks: spawn, load ORT, attempt a webgpu session ------

function runWorkerChecks(errors: Record<string, string>): Promise<WorkerChecksResult> {
  return new Promise(resolve => {
    let worker: Worker;
    try {
      worker = new Worker(chrome.runtime.getURL("assets/separator.js"), { type: "module" });
    } catch (error) {
      errors.workerSpawned = error instanceof Error ? error.message : String(error);
      resolve({ workerSpawned: false, ortLoaded: false, webgpuSession: false });
      return;
    }

    let settled = false;
    const finish = (ortLoaded: boolean, webgpuSession: boolean) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve({ workerSpawned: true, ortLoaded, webgpuSession });
    };

    worker.addEventListener("message", event => {
      const data: unknown = event.data;
      if (!isWorkerResultMessage(data)) return;
      if (data.ortError) errors.ortLoaded = data.ortError;
      if (data.webgpuError) errors.webgpuSession = data.webgpuError;
      finish(data.ortLoaded, data.webgpuSession);
    });

    worker.addEventListener("error", event => {
      errors.ortLoaded = event.message || "worker error event";
      finish(false, false);
    });

    const loadCommand: LoadCommand = { type: "load", ortBaseUrl: chrome.runtime.getURL("assets/ort/") };
    worker.postMessage(loadCommand);

    setTimeout(() => {
      if (settled) return;
      if (!errors.ortLoaded) errors.ortLoaded = "timed out waiting for worker result";
      finish(false, false);
    }, WORKER_TIMEOUT_MS);
  });
}

// -- Page world transfer check --------------------------------------

function runTransferCheck(errors: Record<string, string>): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (intact: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      resolve(intact);
    };

    function sendTransfer(): void {
      const floats = new Float32Array(256);
      for (let i = 0; i < 256; i++) floats[i] = i * 0.5;
      window.postMessage({ type: TRANSFER_TYPE, payload: floats }, "*", [floats.buffer]);
    }

    function onMessage(event: MessageEvent): void {
      if (event.source !== window) return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      const type = (data as { type?: unknown }).type;
      if (type === PAGE_READY_TYPE) {
        sendTransfer();
        return;
      }
      if (type === TRANSFER_OK_TYPE) {
        finish(Boolean((data as { intact?: unknown }).intact));
      }
    }

    window.addEventListener("message", onMessage);

    setTimeout(() => {
      if (settled) return;
      errors.transferIntact = "timed out waiting for page world response";
      finish(false);
    }, TRANSFER_TIMEOUT_MS);
  });
}

// -- Orchestration ----------------------------------------------------

async function runSpike(): Promise<void> {
  const errors: Record<string, string> = {};

  const workerResult = await runWorkerChecks(errors);
  log(`workerSpawned ${workerResult.workerSpawned}`);
  log(`ortLoaded ${workerResult.ortLoaded}`);
  log(`webgpuSession ${workerResult.webgpuSession}`);

  const transferIntact = await runTransferCheck(errors);
  log(`transferIntact ${transferIntact}`);

  const result: SpikeResult = {
    workerSpawned: workerResult.workerSpawned,
    ortLoaded: workerResult.ortLoaded,
    webgpuSession: workerResult.webgpuSession,
    transferIntact,
    errors,
  };

  console.log(`${LOG_PREFIX} RESULT ${JSON.stringify(result)}`);
}

runSpike().catch(error => {
  console.error(`${LOG_PREFIX} spike crashed`, error);
});
