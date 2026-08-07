import type { PlasmoCSConfig } from "plasmo";
import { DEFAULT_MAX_RETAINED_BYTES, createCaptureAccumulator } from "@/capture/accumulator";
import { AD_PLAYING_CLASS, MOVIE_PLAYER_ELEMENT_ID, isAdPlayingElement } from "@/capture/ad-guard";
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

let listenedElement: HTMLVideoElement | null = null;

function ensureEndedListener(): void {
  const element = currentVideoElement();
  if (!element || element === listenedElement) return;
  listenedElement = element;
  element.addEventListener("ended", () => {
    log("track ended, running decode experiment");
    void runDecodeExperiment();
  });
}

setInterval(ensureEndedListener, ENDED_LISTENER_POLL_MS);

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
