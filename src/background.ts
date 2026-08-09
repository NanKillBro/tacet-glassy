import { getModelUrl } from "@/cache/model-url";
import { createTabRegistry } from "@/orchestrator/tab-registry";
import { SETTINGS_STORAGE_KEY } from "@/settings/settings";
import { loadSettingsFrom } from "@/settings/storage";
import {
  type ModelUrlMessage,
  type SettingsChangedMessage,
  type SettingsMessage,
  isCaptureChunkMessage,
  isProbeCacheCommand,
  isClearModelCacheCommand,
  isClearStemCacheCommand,
  isForgetTrackCommand,
  isGetCacheStatusCommand,
  isGetModelUrlCommand,
  isGetSettingsCommand,
  isTrackPipelineOutboundMessage,
} from "../workers/protocol2";
import { createLogger } from "@/shared/logger";

const logger = createLogger("pipeline");

// -- Offscreen document lifecycle -------------------------------------------
//
// The offscreen document is where separation runs. It is created on demand by
// whichever relay below needs it first, since it can only reach chrome.runtime
// and never chrome.tabs, so every answer it produces comes back through here.

const OFFSCREEN_URL = "assets/offscreen.html";
const OFFSCREEN_JUSTIFICATION = "Separating vocals from the track the listener is playing.";
const ALREADY_EXISTS_MESSAGE = "single offscreen document";

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

// -- Model URL --------------------------------------------------------------
//
// The offscreen document has no access to the build-time environment, so it
// asks for the model URL rather than resolving one itself.

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isGetModelUrlCommand(message)) return undefined;
  const response: ModelUrlMessage = { type: "blk-model-url", modelUrl: getModelUrl() };
  sendResponse(response);
  return undefined;
});

// -- Track pipeline relay --------------------------------------------------
//
// Content script to background to offscreen for capture chunks; offscreen to
// background to content script for everything else, routed by videoId since
// offscreen cannot call chrome.tabs itself.

const tabRegistry = createTabRegistry();

function relayToTabForVideo(videoId: string, message: unknown): void {
  for (const tabId of tabRegistry.tabsFor(videoId)) {
    chrome.tabs.sendMessage(tabId, message).catch(() => tabRegistry.forgetTab(tabId));
  }
}

chrome.tabs.onRemoved.addListener(tabId => tabRegistry.forgetTab(tabId));

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  // A cache probe needs the same tab bookkeeping as a capture chunk, since any
  // stems it finds are delivered straight back to that tab.
  if (isProbeCacheCommand(message)) {
    const probeTabId = sender.tab?.id;
    if (probeTabId !== undefined) tabRegistry.remember(message.videoId, probeTabId);
    sendToOffscreenWithRetry(message).catch(error => {
      logger.error("failed to relay a cache probe", error);
    });
    return undefined;
  }

  if (isForgetTrackCommand(message)) {
    sendToOffscreenWithRetry(message).catch(error => {
      logger.error("failed to relay a forget-track command", error);
    });
    return undefined;
  }

  if (isCaptureChunkMessage(message)) {
    const tabId = sender.tab?.id;
    if (tabId !== undefined) tabRegistry.remember(message.videoId, tabId);

    sendToOffscreenWithRetry(message).catch(error => {
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
      tabRegistry.forgetVideo(message.videoId);
    }
  }
});

// -- Cache status and clearing relay (popup) ---------------------------------
//
// Same shape as the track pipeline relay above: forward to the offscreen
// document once it exists, then hand its answer straight back to whoever
// asked (the popup). The offscreen document is the only one that can answer,
// since it holds the live IndexedDB connection and knows whether a
// separation is running (workers/offscreen.ts). The retry covers a document
// whose own onMessage listener has not registered yet, which createDocument
// resolving does not guarantee.

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
      logger.error("cache command failed", error);
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
      logger.error("failed to load settings", error);
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
      logger.error("failed to broadcast a settings change", error);
    });
});
