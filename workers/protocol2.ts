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
