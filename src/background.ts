import { getModelUrl } from "@/cache/model-url";
import {
  type ModelUrlMessage,
  type RunPathBCommand,
  type TrackPipelineOutboundMessage,
  isCaptureChunkMessage,
  isGetModelUrlCommand,
  isLogMessage,
  isStartPathBMessage,
  isStemChunkMessage,
  isStepMessage,
  isTrackDoneMessage,
  isTrackErrorMessage,
  isTrackProgressMessage,
  isTrackStageMessage,
} from "../workers/protocol2";

// -- Path B offscreen document lifecycle and message relay ------------------
//
// The content script kicks Path B off with a single message. This worker
// creates the offscreen document if needed, tells it to start, then relays
// every step and log message it emits to the tab that asked for the run.
// Offscreen documents can only reach chrome.runtime, not chrome.tabs, so this
// relay is the only path back to the content script's console.

const OFFSCREEN_URL = "assets/offscreen.html";
const OFFSCREEN_JUSTIFICATION = "Spike: measure whether the ONNX worker can run inside an offscreen document.";
const ALREADY_EXISTS_MESSAGE = "single offscreen document";

let activeTabId: number | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  const hasDocument = await chrome.offscreen.hasDocument();
  if (hasDocument) return;

  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL(OFFSCREEN_URL),
      reasons: ["WORKERS", "AUDIO_PLAYBACK"],
      justification: OFFSCREEN_JUSTIFICATION,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(ALREADY_EXISTS_MESSAGE)) throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendRunCommand(): Promise<void> {
  const runCommand: RunPathBCommand = { type: "blk-spike2-run-pathb" };
  try {
    await chrome.runtime.sendMessage(runCommand);
  } catch {
    // The offscreen document's own onMessage listener may not be registered
    // yet even though createDocument() has resolved. One retry covers it.
    await delay(250);
    await chrome.runtime.sendMessage(runCommand);
  }
}

function relayToActiveTab(message: unknown): void {
  if (activeTabId === null) return;
  chrome.tabs.sendMessage(activeTabId, message).catch(error => {
    console.error("[BLK-SPIKE2-BG] relay failed", error);
  });
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isGetModelUrlCommand(message)) {
    const response: ModelUrlMessage = { type: "blk-model-url", modelUrl: getModelUrl() };
    sendResponse(response);
    return;
  }

  if (isStartPathBMessage(message)) {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return;
    activeTabId = tabId;

    ensureOffscreenDocument()
      .then(sendRunCommand)
      .catch(error => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        relayToActiveTab({
          type: "blk-spike2-step",
          path: "B",
          step: "offscreenDocument",
          ok: false,
          error: errorMessage,
        });
      });
    return;
  }

  if (isStepMessage(message) || isLogMessage(message)) {
    relayToActiveTab(message);
  }
});

// -- Track pipeline relay --------------------------------------------------
//
// Content script to background to offscreen for capture chunks (background
// forwards after ensuring the offscreen document exists, mirroring
// sendRunCommand above); offscreen to background to content script for
// everything else, routed by videoId since offscreen cannot call
// chrome.tabs itself. tabIdByVideoId is cleared once a job finishes, so it
// never grows across a long browsing session.

const tabIdByVideoId = new Map<string, number>();

function isTrackPipelineOutboundMessage(message: unknown): message is TrackPipelineOutboundMessage {
  return (
    isTrackStageMessage(message) ||
    isTrackProgressMessage(message) ||
    isStemChunkMessage(message) ||
    isTrackDoneMessage(message) ||
    isTrackErrorMessage(message)
  );
}

function relayToTabForVideo(videoId: string, message: unknown): void {
  const tabId = tabIdByVideoId.get(videoId);
  if (tabId === undefined) return;
  chrome.tabs.sendMessage(tabId, message).catch(error => {
    console.error("[BLK-TRACK-PIPELINE-BG] relay failed", error);
  });
}

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (isCaptureChunkMessage(message)) {
    const tabId = sender.tab?.id;
    if (tabId !== undefined) tabIdByVideoId.set(message.videoId, tabId);

    ensureOffscreenDocument()
      .then(() => chrome.runtime.sendMessage(message))
      .catch(error => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        relayToTabForVideo(message.videoId, {
          type: "blk-track-error",
          videoId: message.videoId,
          code: "unknown",
          message: `Failed to reach the offscreen document: ${errorMessage}`,
        });
      });
    return;
  }

  if (isTrackPipelineOutboundMessage(message)) {
    relayToTabForVideo(message.videoId, message);
    if (message.type === "blk-track-done" || message.type === "blk-track-error") {
      tabIdByVideoId.delete(message.videoId);
    }
  }
});
