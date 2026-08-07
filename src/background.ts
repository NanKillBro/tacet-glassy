import { getModelUrl } from "@/cache/model-url";
import { SETTINGS_STORAGE_KEY } from "@/settings/settings";
import { loadSettingsFrom } from "@/settings/storage";
import {
  type ModelUrlMessage,
  type RunPathBCommand,
  type SettingsChangedMessage,
  type SettingsMessage,
  type TrackPipelineOutboundMessage,
  isCaptureChunkMessage,
  isProbeCacheCommand,
  isClearModelCacheCommand,
  isClearStemCacheCommand,
  isGetCacheStatusCommand,
  isGetModelUrlCommand,
  isGetSettingsCommand,
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
  // A cache probe needs the same tab bookkeeping as a capture chunk, since any
  // stems it finds are delivered straight back to that tab.
  if (isProbeCacheCommand(message)) {
    const probeTabId = sender.tab?.id;
    if (probeTabId !== undefined) tabIdByVideoId.set(message.videoId, probeTabId);
    ensureOffscreenDocument()
      .then(() => chrome.runtime.sendMessage(message))
      .catch(error => {
        console.error("[BLK-BACKGROUND] failed to relay a cache probe", error);
      });
    return undefined;
  }

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

// -- Cache status and clearing relay (popup) ---------------------------------
//
// Same shape as the track pipeline relay above: forward to the offscreen
// document once it exists, then hand its answer straight back to whoever
// asked (the popup). The offscreen document is the only one that can answer,
// since it holds the live IndexedDB connection and knows whether a
// separation is running (workers/offscreen.ts). One retry covers the same
// listener-registration race sendRunCommand above already retries around.

async function sendToOffscreenWithRetry(message: unknown): Promise<unknown> {
  await ensureOffscreenDocument();
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    await delay(250);
    return chrome.runtime.sendMessage(message);
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isGetCacheStatusCommand(message) && !isClearStemCacheCommand(message) && !isClearModelCacheCommand(message)) {
    return undefined;
  }

  sendToOffscreenWithRetry(message)
    .then(sendResponse)
    .catch(error => {
      console.error("[BLK-BG] cache command failed", error);
    });
  return true;
});

// -- Settings relay (offscreen has no chrome.storage) --------------------------
//
// An offscreen document is granted chrome.runtime and nothing else: reading
// chrome.storage there throws, even with the permission declared. Background
// answers a settings request from its own chrome.storage.sync access, and
// pushes an update to the offscreen document whenever the settings change,
// so its live cacheBudgetBytes value (see workers/offscreen.ts) never goes
// stale without needing to poll.

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isGetSettingsCommand(message)) return undefined;

  loadSettingsFrom(chrome.storage.sync)
    .then(settings => {
      const response: SettingsMessage = { type: "blk-settings", settings };
      sendResponse(response);
    })
    .catch(error => {
      console.error("[BLK-BG] failed to load settings", error);
    });
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !(SETTINGS_STORAGE_KEY in changes)) return;

  // Only push to an offscreen document that already exists: one that has not
  // been created yet has nothing running to keep in sync, and will fetch the
  // current settings itself (blk-get-settings) the moment it is created.
  chrome.offscreen
    .hasDocument()
    .then(async hasDocument => {
      if (!hasDocument) return;
      const settings = await loadSettingsFrom(chrome.storage.sync);
      const message: SettingsChangedMessage = { type: "blk-settings-changed", settings };
      await chrome.runtime.sendMessage(message);
    })
    .catch(error => {
      console.error("[BLK-BG] failed to broadcast a settings change", error);
    });
});
