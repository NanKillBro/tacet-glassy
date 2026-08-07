import type { PlasmoCSConfig } from "plasmo";
import { isLogMessage, isStepMessage, type StartPathBMessage } from "../workers/protocol2";

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_start",
  all_frames: false,
};

const LOG_PREFIX = "[BLK-SPIKE2]";
const PATH_A_TIMEOUT_MS = 25000;
const PATH_B_TIMEOUT_MS = 25000;

const PAGE_READY_TYPE = "blk-spike2-page-ready";
const BASE_URL_TYPE = "blk-spike2-base-url";
const PATH_A_DONE_TYPE = "blk-spike2-path-a-done";

const PATH_A_STEPS = [
  "trustedTypesPolicy",
  "workerSourceFetched",
  "blobWorkerConstructed",
  "workerPing",
  "ortWasmLoaded",
  "webgpuSession",
];

const PATH_B_STEPS = [
  "navigatorGpu",
  "ortWasmFetch",
  "ortWasmInstantiate",
  "indexedDbOpen",
  "storageEstimate",
  "workerConstructed",
  "workerOrtLoaded",
  "workerWebgpuSession",
];

type StepValue = true | string;

function log(message: string): void {
  console.log(`${LOG_PREFIX} ${message}`);
}

function toStepValue(ok: boolean, error: string | undefined): StepValue {
  return ok ? true : `ERR: ${error ?? "(no error detail)"}`;
}

function fillUnreported(steps: Record<string, StepValue>, knownSteps: string[], error: string): void {
  for (const step of knownSteps) {
    if (steps[step] === undefined) steps[step] = `ERR: ${error}`;
  }
}

// -- Path A: page-world blob worker ------------------------------------

function runPathA(): Promise<Record<string, StepValue>> {
  return new Promise(resolve => {
    const steps: Record<string, StepValue> = {};
    let settled = false;

    function finish(): void {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      resolve(steps);
    }

    function onMessage(event: MessageEvent): void {
      if (event.source !== window) return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      const type = (data as { type?: unknown }).type;

      if (type === PAGE_READY_TYPE) {
        const baseUrl = chrome.runtime.getURL("");
        window.postMessage({ type: BASE_URL_TYPE, baseUrl }, "*");
        return;
      }

      if (type === PATH_A_DONE_TYPE) {
        finish();
        return;
      }

      if (isStepMessage(data) && data.path === "A") {
        steps[data.step] = toStepValue(data.ok, data.error);
        log(`pathA.${data.step} ${data.ok ? "ok" : steps[data.step]}`);
      }
    }

    window.addEventListener("message", onMessage);

    setTimeout(() => {
      if (settled) return;
      fillUnreported(steps, PATH_A_STEPS, "timed out waiting for page world");
      finish();
    }, PATH_A_TIMEOUT_MS);
  });
}

// -- Path B: offscreen document ------------------------------------------

function runPathB(): Promise<Record<string, StepValue>> {
  return new Promise(resolve => {
    const steps: Record<string, StepValue> = {};
    let settled = false;

    function finish(): void {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(onMessage);
      resolve(steps);
    }

    function onMessage(message: unknown): void {
      if (isLogMessage(message) && message.path === "B") {
        log(`pathB ${message.line}`);
        return;
      }

      if (isStepMessage(message) && message.path === "B") {
        if (message.step === "done") {
          if (!message.ok) fillUnreported(steps, PATH_B_STEPS, message.error ?? "path B failed before finishing");
          finish();
          return;
        }
        steps[message.step] = toStepValue(message.ok, message.error);
        log(`pathB.${message.step} ${message.ok ? "ok" : steps[message.step]}`);
      }
    }

    chrome.runtime.onMessage.addListener(onMessage);

    const startMessage: StartPathBMessage = { type: "blk-spike2-start-pathb" };
    chrome.runtime.sendMessage(startMessage).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      fillUnreported(steps, PATH_B_STEPS, `failed to reach background: ${message}`);
      finish();
    });

    setTimeout(() => {
      if (settled) return;
      fillUnreported(steps, PATH_B_STEPS, "timed out waiting for offscreen document");
      finish();
    }, PATH_B_TIMEOUT_MS);
  });
}

// -- Orchestration ----------------------------------------------------------

async function runSpike2(): Promise<void> {
  const [pathA, pathB] = await Promise.all([runPathA(), runPathB()]);
  console.log(`${LOG_PREFIX} RESULT ${JSON.stringify({ pathA, pathB })}`);
}

runSpike2().catch(error => {
  console.error(`${LOG_PREFIX} spike2 crashed`, error);
});
