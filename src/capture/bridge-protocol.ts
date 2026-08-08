// -- Capture (MAIN world) to fader (ISOLATED world) bridge protocol --------
//
// window.postMessage between src/contents/capture-spike.ts (MAIN, owns the
// SourceBuffer.appendBuffer capture) and src/contents/karaoke-pipeline.ts
// (ISOLATED, drives the fader). Structured clone, so blk-captured-audio's
// bytes cross as a transferable, unlike the chrome.runtime leg further
// down the pipeline (see src/relay/chunk-transfer.ts), which is JSON-only.

import type { DownloadSource } from "@/orchestrator/download-tooltip";

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

// Acquire the track in a hidden player. From the isolated world because only it
// can read the master switch.
export interface RequestPrefetchMessage {
  type: "blk-request-prefetch";
  videoId: string;
  ahead?: boolean;
}

// This track's stems came from the cache. Capture cannot stop the player
// fetching, but it can stop retaining and announcing.
export interface RequestNextPrefetchMessage {
  type: "blk-request-next-prefetch";
  videoId: string;
}

export interface NextTrackMessage {
  type: "blk-next-track";
  videoId: string;
}

export interface CaptureStandDownMessage {
  type: "blk-capture-stand-down";
  videoId: string;
}

export interface DownloadProgressMessage {
  type: "blk-download-progress";
  videoId: string;
  fraction: number;
  // The two are paced by different things and the tooltip must say which.
  source: DownloadSource;
}

// From a worker frame to its opener. startSeconds is the segment boundary at or
// before the requested start, so slices overlap and are placed by offset.
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

export function isRequestPrefetchMessage(data: unknown): data is RequestPrefetchMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-request-prefetch" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isRequestNextPrefetchMessage(data: unknown): data is RequestNextPrefetchMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-request-next-prefetch" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isNextTrackMessage(data: unknown): data is NextTrackMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-next-track" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isCaptureStandDownMessage(data: unknown): data is CaptureStandDownMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-capture-stand-down" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
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
    typeof (data as { fraction?: unknown }).fraction === "number" &&
    ((data as { source?: unknown }).source === "hidden-player" ||
      (data as { source?: unknown }).source === "listener-playback")
  );
}
