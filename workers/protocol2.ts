// -- Spike 2 message protocol -----------------------------------------------
//
// Shared by contents/spike2.ts (isolated world), background.ts (service
// worker), and workers/offscreen.ts (offscreen document). Step messages carry
// the offscreen document's progress over chrome.runtime messaging (Path B).

export type Spike2Path = "B";

export interface StartPathBMessage {
  type: "blk-spike2-start-pathb";
}

export interface RunPathBCommand {
  type: "blk-spike2-run-pathb";
}

export interface StepMessage {
  type: "blk-spike2-step";
  path: Spike2Path;
  step: string;
  ok: boolean;
  error?: string;
}

export interface LogMessage {
  type: "blk-spike2-log";
  path: Spike2Path;
  line: string;
}

export function isStartPathBMessage(data: unknown): data is StartPathBMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-spike2-start-pathb";
}

export function isRunPathBCommand(data: unknown): data is RunPathBCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-spike2-run-pathb";
}

export function isStepMessage(data: unknown): data is StepMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-spike2-step" &&
    typeof (data as { step?: unknown }).step === "string" &&
    typeof (data as { ok?: unknown }).ok === "boolean"
  );
}

export function isLogMessage(data: unknown): data is LogMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-spike2-log" &&
    typeof (data as { line?: unknown }).line === "string"
  );
}

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

export type TrackStage = "checking-cache" | "decoding" | "downloading-model" | "separating" | "encoding";

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
  | TrackStageMessage
  | TrackProgressMessage
  | StemChunkMessage
  | TrackDoneMessage
  | TrackErrorMessage;
