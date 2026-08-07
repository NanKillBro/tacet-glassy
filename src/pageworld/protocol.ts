// -- Isolated to page world audio bridge protocol -----------------------------
//
// window.postMessage between the fader's ISOLATED-world content script and
// the MAIN-world audio graph script (see src/contents/fader-control.ts and
// src/contents/inject-main-world.ts). Structured clone carries these across,
// including the transferable Float32Array buffers in blk-load-stems, which
// chrome.runtime messaging cannot: that is JSON-only, this is not.
//
// blk-load-stems and blk-stop-stems are not sent by anything yet. They are
// the seam a later phase (audio acquisition and separation) pushes decoded
// stems through: one AudioBufferSourceNode per stem, built from these
// per-channel Float32Arrays at this sampleRate.

export interface SetMixLevelMessage {
  type: "blk-set-mix-level";
  mixLevel: number;
}

// videoId is what binds these stems to an element: the page world asks the
// player which track it is on rather than comparing durations, which cannot
// tell two recordings of the same length apart.
export interface LoadStemsMessage {
  type: "blk-load-stems";
  videoId: string;
  vocals: Float32Array<ArrayBuffer>[];
  instrumental: Float32Array<ArrayBuffer>[];
  sampleRate: number;
}

export interface StopStemsMessage {
  type: "blk-stop-stems";
}

export type AudioBridgeMessage = SetMixLevelMessage | LoadStemsMessage | StopStemsMessage;

function isFloat32ArrayList(value: unknown): value is Float32Array<ArrayBuffer>[] {
  return Array.isArray(value) && value.every(channel => channel instanceof Float32Array);
}

export function isSetMixLevelMessage(data: unknown): data is SetMixLevelMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-set-mix-level" &&
    typeof (data as { mixLevel?: unknown }).mixLevel === "number"
  );
}

export function isLoadStemsMessage(data: unknown): data is LoadStemsMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-load-stems" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    isFloat32ArrayList((data as { vocals?: unknown }).vocals) &&
    isFloat32ArrayList((data as { instrumental?: unknown }).instrumental) &&
    typeof (data as { sampleRate?: unknown }).sampleRate === "number"
  );
}

export function isStopStemsMessage(data: unknown): data is StopStemsMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-stop-stems";
}

export function isAudioBridgeMessage(data: unknown): data is AudioBridgeMessage {
  return isSetMixLevelMessage(data) || isLoadStemsMessage(data) || isStopStemsMessage(data);
}
