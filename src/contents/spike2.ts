import type { PlasmoCSConfig } from "plasmo";
import { isLogMessage, isStepMessage, type StartPathBMessage } from "../../workers/protocol2";
import { createLogger } from "@/shared/logger";

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_start",
  all_frames: false,
};

const logger = createLogger("spike");
const PATH_B_TIMEOUT_MS = 25000;

const PATH_B_STEPS = [
  "navigatorGpu",
  "ortWasmFetch",
  "ortWasmCompile",
  "indexedDbOpen",
  "storageEstimate",
  "workerConstructed",
  "workerOrtLoaded",
  "workerWebgpuSession",
];

type StepValue = true | string;

function log(message: string): void {
  logger.log(`${message}`);
}

function toStepValue(ok: boolean, error: string | undefined): StepValue {
  return ok ? true : `ERR: ${error ?? "(no error detail)"}`;
}

function fillUnreported(steps: Record<string, StepValue>, knownSteps: string[], error: string): void {
  for (const step of knownSteps) {
    if (steps[step] === undefined) steps[step] = `ERR: ${error}`;
  }
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
  const pathB = await runPathB();
  console.log(`RESULT ${JSON.stringify({ pathB })}`);
}

runSpike2().catch(error => {
  console.error(`spike2 crashed`, error);
});
