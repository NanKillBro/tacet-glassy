// -- Capture (MAIN world) to fader (ISOLATED world) bridge protocol --------
//
// window.postMessage between src/contents/capture-spike.ts (MAIN, owns the
// SourceBuffer.appendBuffer capture) and src/contents/karaoke-pipeline.ts
// (ISOLATED, drives the fader). Structured clone, so blk-captured-audio's
// bytes cross as a transferable, unlike the chrome.runtime leg further
// down the pipeline (see src/relay/chunk-transfer.ts), which is JSON-only.

export interface RequestCapturedAudioMessage {
  type: "blk-request-captured-audio";
  videoId: string;
}

export interface CapturedAudioMessage {
  type: "blk-captured-audio";
  videoId: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

export interface CapturedAudioUnavailableMessage {
  type: "blk-captured-audio-unavailable";
  videoId: string;
  reason: string;
}

export interface CaptureReadyMessage {
  type: "blk-capture-ready";
  videoId: string;
}

export interface DownloadProgressMessage {
  type: "blk-download-progress";
  videoId: string;
  fraction: number;
}

// Sent from a hidden worker frame up to its opener. startSeconds is where the
// slice's audio really begins, which is a segment boundary at or before the
// point the worker was asked to start from, so slices overlap and have to be
// placed by offset rather than concatenated.
export interface SliceCapturedMessage {
  type: "blk-slice-captured";
  videoId: string;
  index: number;
  startSeconds: number;
  mimeType: string;
  bytes: ArrayBuffer;
}

export function isSliceCapturedMessage(data: unknown): data is SliceCapturedMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-slice-captured" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    Number.isInteger((data as { index?: unknown }).index) &&
    typeof (data as { startSeconds?: unknown }).startSeconds === "number" &&
    typeof (data as { mimeType?: unknown }).mimeType === "string" &&
    (data as { bytes?: unknown }).bytes instanceof ArrayBuffer
  );
}

export function isRequestCapturedAudioMessage(data: unknown): data is RequestCapturedAudioMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-request-captured-audio" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isCapturedAudioMessage(data: unknown): data is CapturedAudioMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-captured-audio" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { mimeType?: unknown }).mimeType === "string" &&
    (data as { bytes?: unknown }).bytes instanceof ArrayBuffer
  );
}

export function isCapturedAudioUnavailableMessage(data: unknown): data is CapturedAudioUnavailableMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-captured-audio-unavailable" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { reason?: unknown }).reason === "string"
  );
}

export function isCaptureReadyMessage(data: unknown): data is CaptureReadyMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-capture-ready" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isDownloadProgressMessage(data: unknown): data is DownloadProgressMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-download-progress" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { fraction?: unknown }).fraction === "number"
  );
}
