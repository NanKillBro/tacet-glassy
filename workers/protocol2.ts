import type { Settings } from "../src/settings/settings.js";

// -- Separation control messages ------------------------------------------------------
//
// Small, JSON-safe messages only: chrome.runtime message passing uses JSON
// serialization in Chrome, not structured clone, so ArrayBuffer/Float32Array
// payloads (model bytes, audio channels, separated stems) never cross this
// layer. Those stay inside the offscreen document and its Worker, which talk
// over Worker postMessage (workers/protocol.ts) instead.

export interface GetModelUrlCommand {
  type: "blk-get-model-url";
}

export interface ModelUrlMessage {
  type: "blk-model-url";
  modelUrl: string | null;
}

export interface CancelSeparationCommand {
  type: "blk-cancel-separation";
}

export function isGetModelUrlCommand(data: unknown): data is GetModelUrlCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-get-model-url";
}

export function isModelUrlMessage(data: unknown): data is ModelUrlMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-model-url" &&
    (typeof (data as { modelUrl?: unknown }).modelUrl === "string" ||
      (data as { modelUrl?: unknown }).modelUrl === null)
  );
}

export function isCancelSeparationCommand(data: unknown): data is CancelSeparationCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-cancel-separation";
}

// -- Track pipeline messages (real karaoke path) ------------------------------
//
// Captured audio and finished stems are binary, and chrome.runtime messaging
// is JSON-only in Chrome, so both cross as base64 text chunked per
// src/relay/chunk-transfer.ts. Everything else here is a small control
// message. Content script to background to offscreen for capture chunks;
// offscreen to background to content script (routed by videoId, since only
// background can target a specific tab) for stage, progress, stem chunks,
// completion and error.

// loading-model and downloading-model are separate because they cost minutes
// apart: the model is 170 MB over the network, and an extension reload throws
// away the session but not the cached bytes, so the common case is a local read.
export type TrackStage =
  | "checking-cache"
  | "decoding"
  | "downloading-model"
  | "loading-model"
  | "separating"
  | "encoding";

export type StemName = "vocals" | "instrumental";

export interface CaptureChunkMessage {
  type: "blk-capture-chunk";
  videoId: string;
  mimeType: string;
  index: number;
  total: number;
  data: string;
}

export interface TrackStageMessage {
  type: "blk-track-stage";
  videoId: string;
  stage: TrackStage;
}

export interface TrackProgressMessage {
  type: "blk-track-progress";
  videoId: string;
  processed: number;
  total: number;
}

export interface StemChunkMessage {
  type: "blk-stem-chunk";
  videoId: string;
  stem: StemName;
  index: number;
  total: number;
  data: string;
}

export interface TrackDoneMessage {
  type: "blk-track-done";
  videoId: string;
}

export interface TrackErrorMessage {
  type: "blk-track-error";
  videoId: string;
  code: string;
  message: string;
}

export function isCaptureChunkMessage(data: unknown): data is CaptureChunkMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-capture-chunk" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { mimeType?: unknown }).mimeType === "string" &&
    typeof (data as { index?: unknown }).index === "number" &&
    typeof (data as { total?: unknown }).total === "number" &&
    typeof (data as { data?: unknown }).data === "string"
  );
}

export function isTrackStageMessage(data: unknown): data is TrackStageMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-track-stage" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { stage?: unknown }).stage === "string"
  );
}

export function isTrackProgressMessage(data: unknown): data is TrackProgressMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-track-progress" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { processed?: unknown }).processed === "number" &&
    typeof (data as { total?: unknown }).total === "number"
  );
}

export function isStemChunkMessage(data: unknown): data is StemChunkMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-stem-chunk" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    ((data as { stem?: unknown }).stem === "vocals" || (data as { stem?: unknown }).stem === "instrumental") &&
    typeof (data as { index?: unknown }).index === "number" &&
    typeof (data as { total?: unknown }).total === "number" &&
    typeof (data as { data?: unknown }).data === "string"
  );
}

export function isTrackDoneMessage(data: unknown): data is TrackDoneMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-track-done" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isTrackErrorMessage(data: unknown): data is TrackErrorMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-track-error" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { code?: unknown }).code === "string" &&
    typeof (data as { message?: unknown }).message === "string"
  );
}

export type TrackPipelineOutboundMessage =
  | CacheHitMessage
  | CacheMissMessage
  | TrackStageMessage
  | TrackProgressMessage
  | StemChunkMessage
  | TrackDoneMessage
  | TrackErrorMessage;

// -- Cache status and clearing (popup) ----------------------------------------
//
// Popup to background to offscreen and back, the same relay shape as
// GetModelUrlCommand above but answered by the offscreen document instead of
// background itself, since only it holds the IndexedDB connection and knows
// whether a separation is running (see workers/offscreen.ts).

export type CacheClearTarget = "stems" | "model";

export interface GetCacheStatusCommand {
  type: "blk-get-cache-status";
}

export interface CacheStatusMessage {
  type: "blk-cache-status";
  stemCacheBytes: number;
  modelCached: boolean;
  modelCacheBytes: number;
}

export interface ClearStemCacheCommand {
  type: "blk-clear-stem-cache";
}

export interface ClearModelCacheCommand {
  type: "blk-clear-model-cache";
}

export interface ClearCacheResultMessage {
  type: "blk-clear-cache-result";
  target: CacheClearTarget;
  ok: boolean;
  reason?: string;
}

export function isGetCacheStatusCommand(data: unknown): data is GetCacheStatusCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-get-cache-status";
}

export function isCacheStatusMessage(data: unknown): data is CacheStatusMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-cache-status" &&
    typeof (data as { stemCacheBytes?: unknown }).stemCacheBytes === "number" &&
    typeof (data as { modelCached?: unknown }).modelCached === "boolean" &&
    typeof (data as { modelCacheBytes?: unknown }).modelCacheBytes === "number"
  );
}

export function isClearStemCacheCommand(data: unknown): data is ClearStemCacheCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-clear-stem-cache";
}

export function isClearModelCacheCommand(data: unknown): data is ClearModelCacheCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-clear-model-cache";
}

export function isClearCacheResultMessage(data: unknown): data is ClearCacheResultMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-clear-cache-result" &&
    ((data as { target?: unknown }).target === "stems" || (data as { target?: unknown }).target === "model") &&
    typeof (data as { ok?: unknown }).ok === "boolean"
  );
}

// -- Settings relay (offscreen has no chrome.storage) --------------------------
//
// An offscreen document is granted chrome.runtime and nothing else: chrome.storage
// is undefined there even with the permission declared in the manifest, and
// reading it throws. The offscreen document asks background for the current
// settings on startup, and background pushes an update whenever they change,
// rather than the offscreen document ever touching chrome.storage itself.

export interface GetSettingsCommand {
  type: "blk-get-settings";
}

export interface SettingsMessage {
  type: "blk-settings";
  settings: Settings;
}

export interface SettingsChangedMessage {
  type: "blk-settings-changed";
  settings: Settings;
}

export function isGetSettingsCommand(data: unknown): data is GetSettingsCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-get-settings";
}

export function isSettingsMessage(data: unknown): data is SettingsMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-settings" &&
    typeof (data as { settings?: unknown }).settings === "object"
  );
}

export function isSettingsChangedMessage(data: unknown): data is SettingsChangedMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-settings-changed" &&
    typeof (data as { settings?: unknown }).settings === "object"
  );
}

// -- Cache probe --------------------------------------------------------------
//
// Does this videoId already have stems, and if so deliver them. Without it the
// cache was write-only: the lookup lived inside the capture-completion path.

export interface ProbeCacheCommand {
  type: "blk-probe-cache";
  videoId: string;
}

export function isProbeCacheCommand(data: unknown): data is ProbeCacheCommand {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-probe-cache" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

// The probe's answer, sent before the stems it found. The tab is waiting for a
// capture, and stem chunks alone do not move it off that.
export interface CacheHitMessage {
  type: "blk-cache-hit";
  videoId: string;
}

// The other answer. Without it the tab cannot tell a finished probe from a slow
// one, so acquisition started on a timer and raced the lookup: a cold offscreen
// document answers well after six seconds and the track downloaded again.
export interface CacheMissMessage {
  type: "blk-cache-miss";
  videoId: string;
}

export function isCacheMissMessage(data: unknown): data is CacheMissMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-cache-miss" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isCacheHitMessage(data: unknown): data is CacheHitMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-cache-hit" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

// -- The relay's guard for everything the offscreen document sends out ---------
//
// Keyed by the union's own type strings, so a message added without a guard is
// a compile error. Hand-maintained, this silently lost blk-cache-miss.

const TRACK_PIPELINE_OUTBOUND_GUARDS: Record<TrackPipelineOutboundMessage["type"], (data: unknown) => boolean> = {
  "blk-cache-hit": isCacheHitMessage,
  "blk-cache-miss": isCacheMissMessage,
  "blk-track-stage": isTrackStageMessage,
  "blk-track-progress": isTrackProgressMessage,
  "blk-stem-chunk": isStemChunkMessage,
  "blk-track-done": isTrackDoneMessage,
  "blk-track-error": isTrackErrorMessage,
};

export function isTrackPipelineOutboundMessage(data: unknown): data is TrackPipelineOutboundMessage {
  return Object.values(TRACK_PIPELINE_OUTBOUND_GUARDS).some(guard => guard(data));
}
