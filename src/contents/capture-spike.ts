import type { PlasmoCSConfig } from "plasmo";
import { DEFAULT_MAX_RETAINED_BYTES, createCaptureAccumulator } from "@/capture/accumulator";
import { AD_PLAYING_CLASS, MOVIE_PLAYER_ELEMENT_ID, isAdPlayingElement } from "@/capture/ad-guard";
import type {
  CaptureReadyMessage,
  CapturedAudioMessage,
  CapturedAudioUnavailableMessage,
  DownloadProgressMessage,
} from "@/capture/bridge-protocol";
import { isRequestCapturedAudioMessage } from "@/capture/bridge-protocol";
import { computeBufferedFraction } from "@/capture/buffered-fraction";
import { concatenateChunks, planNaiveConcat } from "@/capture/decode-plan";
import { runCaptureDecodeExperiment } from "@/capture/decode-experiment";
import { log, logError } from "@/capture/log";
import { installSourceBufferCapture } from "@/capture/sourcebuffer-patch";
import { getVideoIdFromSearch } from "@/capture/video-id";
import { selectPlaybackElement } from "@/pageworld/select-media-element";

// -- Phase 6 capture spike -----------------------------------------------
//
// Patches SourceBuffer.appendBuffer in the MAIN world, at document_start,
// before YouTube's own player script runs. This rides the player's own
// fetch of the stream, so capture inherits a valid PO token, signature and
// n-descrambling for free instead of re-deriving any of it. See
// src/capture/sourcebuffer-patch.ts for the patch and src/capture/
// decode-experiment.ts for the decode measurements this spike exists to
// produce.
//
// Kept as a dedicated entry rather than folded into inject-main-world.ts:
// that script builds the stem playback graph, an unrelated concern, and a
// throwaway spike has no business sharing its lifecycle.

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_start",
  all_frames: false,
  world: "MAIN",
};

const ENDED_LISTENER_POLL_MS = 2000;
const FULLY_BUFFERED_EPSILON_S = 0.5;

const accumulator = createCaptureAccumulator();

function isAdPlaying(): boolean {
  return isAdPlayingElement(document.getElementById(MOVIE_PLAYER_ELEMENT_ID));
}

function onAudioChunk(mimeType: string, bytes: Uint8Array): void {
  const videoId = getVideoIdFromSearch(window.location.search);
  if (videoId !== null && accumulator.setActiveVideoId(videoId)) {
    log(`capture reset for videoId=${videoId}`);
  }

  const result = accumulator.addChunk(mimeType, bytes);
  if (result === "cap-hit") {
    log(
      `capture cap hit at ${DEFAULT_MAX_RETAINED_BYTES} bytes; further chunks are dropped from decode input but still counted in totals`
    );
  }
}

const capture = installSourceBufferCapture({ isAdPlaying, onAudioChunk });

// -- Triggers: track end, or a human calling the window function ---------

function currentVideoElement(): HTMLVideoElement | null {
  return selectPlaybackElement(Array.from(document.querySelectorAll("video")));
}

function runDecodeExperiment(): Promise<unknown> {
  const element = currentVideoElement();
  const videoDurationSeconds = element && Number.isFinite(element.duration) ? element.duration : null;
  return runCaptureDecodeExperiment(accumulator, videoDurationSeconds).catch(error => {
    logError("decode experiment crashed", error);
    throw error;
  });
}

function announceCaptureReady(videoId: string): void {
  const message: CaptureReadyMessage = { type: "blk-capture-ready", videoId };
  window.postMessage(message, window.location.origin);
  log(`capture-ready broadcast for videoId=${videoId}`);
}

let listenedElement: HTMLVideoElement | null = null;
const announcedKeys = new Set<string>();

// Keyed by videoId AND duration, not videoId alone. A preroll ad reuses the
// page's videoId with its own much shorter duration, and it fully buffers
// almost immediately. Keying on videoId alone let the ad consume the single
// announcement and left the real track never announcing at all.
function announceKey(videoId: string, durationSeconds: number): string {
  return `${videoId}:${Math.round(durationSeconds)}`;
}

function announceIfCaptureComplete(element: HTMLVideoElement): void {
  const stats = accumulator.getStats();
  if (!stats.videoId || stats.retainedChunkCount === 0) return;
  if (isAdPlaying()) return;
  if (!Number.isFinite(element.duration)) return;

  const key = announceKey(stats.videoId, element.duration);
  if (announcedKeys.has(key)) return;
  announcedKeys.add(key);
  announceCaptureReady(stats.videoId);
}

// Waiting for "ended" would mean a track is only singable on a second listen.
// YouTube buffers ahead of the playhead (measured around 2.2x realtime), so the
// whole track is captured well before it finishes playing and the capture is
// complete as soon as the buffered range covers the duration.
function isFullyBuffered(element: HTMLVideoElement): boolean {
  if (!Number.isFinite(element.duration) || element.duration <= 0) return false;
  if (element.buffered.length === 0) return false;
  return element.buffered.end(element.buffered.length - 1) >= element.duration - FULLY_BUFFERED_EPSILON_S;
}

function bufferedEndSeconds(element: HTMLVideoElement): number {
  return element.buffered.length === 0 ? 0 : element.buffered.end(element.buffered.length - 1);
}

function announceDownloadProgress(element: HTMLVideoElement): void {
  const videoId = getVideoIdFromSearch(window.location.search);
  if (!videoId || isAdPlaying()) return;
  const fraction = computeBufferedFraction(bufferedEndSeconds(element), element.duration);
  const message: DownloadProgressMessage = { type: "blk-download-progress", videoId, fraction };
  window.postMessage(message, window.location.origin);
}

function pollCaptureCompletion(): void {
  const element = currentVideoElement();
  if (!element) return;

  if (element !== listenedElement) {
    listenedElement = element;
    element.addEventListener("ended", () => {
      log("track ended, running decode experiment");
      void runDecodeExperiment();
      announceIfCaptureComplete(element);
    });
  }

  announceDownloadProgress(element);
  if (isFullyBuffered(element)) announceIfCaptureComplete(element);
}

setInterval(pollCaptureCompletion, ENDED_LISTENER_POLL_MS);

// -- Production handoff: captured bytes on request ------------------------
//
// The real karaoke path (src/orchestrator/karaoke-pipeline.ts, ISOLATED
// world, wired in by src/contents/fader-control.ts) asks for the current
// track's captured bytes once it has seen a blk-capture-ready broadcast.
// Naive concatenation is what the spike measured as decodable end to end
// (see decode-experiment.ts); the first+media fallback in decode-plan.ts
// stays spike-only for now.

function respondToCapturedAudioRequest(videoId: string): void {
  const stats = accumulator.getStats();

  if (stats.videoId !== videoId || stats.retainedChunkCount === 0) {
    const reason = stats.videoId !== videoId ? "captured audio is for a different track" : "no audio captured yet";
    const message: CapturedAudioUnavailableMessage = { type: "blk-captured-audio-unavailable", videoId, reason };
    window.postMessage(message, window.location.origin);
    log(`captured-audio-unavailable for videoId=${videoId}: ${reason}`);
    return;
  }

  const bytes = concatenateChunks(planNaiveConcat(accumulator.getChunks()));
  const message: CapturedAudioMessage = {
    type: "blk-captured-audio",
    videoId,
    mimeType: stats.mimeTypes[0] ?? "audio/webm",
    bytes: bytes.buffer,
  };
  window.postMessage(message, window.location.origin, [bytes.buffer]);
  log(`captured-audio sent for videoId=${videoId}, bytes=${bytes.byteLength}`);
}

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data: unknown = event.data;
  if (isRequestCapturedAudioMessage(data)) respondToCapturedAudioRequest(data.videoId);
});

declare global {
  interface Window {
    blkRunCaptureDecodeExperiment: () => Promise<unknown>;
    blkDisableCapture: () => void;
  }
}

window.blkRunCaptureDecodeExperiment = runDecodeExperiment;
window.blkDisableCapture = () => {
  capture.restore();
  log("capture disabled: appendBuffer and addSourceBuffer restored to their originals");
};

log(
  `installed (ad-skip class=${AD_PLAYING_CLASS}); call window.blkRunCaptureDecodeExperiment() on demand, or let a track finish`
);
