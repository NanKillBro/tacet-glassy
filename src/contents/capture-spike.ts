import type { PlasmoCSConfig } from "plasmo";
import { DEFAULT_MAX_RETAINED_BYTES, createCaptureAccumulator } from "@/capture/accumulator";
import { isAdPlaying } from "@/capture/ad-state";
import type {
  CaptureReadyMessage,
  CapturedAudioMessage,
  CapturedAudioUnavailableMessage,
  DownloadProgressMessage,
} from "@/capture/bridge-protocol";
import {
  isCaptureStandDownMessage,
  isRequestCapturedAudioMessage,
  isRequestPrefetchMessage,
} from "@/capture/bridge-protocol";
import { computeBufferedFraction } from "@/capture/buffered-fraction";
import type { DownloadSource } from "@/orchestrator/download-tooltip";
import { concatenateChunks, countInitSegments, planFirstPlusMedia } from "@/capture/decode-plan";
import { runCaptureDecodeExperiment } from "@/capture/decode-experiment";
import { log, logError } from "@/capture/log";
import { FRAME_ID_PREFIX, type CapturedSlice, captureTrackInSlices } from "@/capture/frame-pool";
import { installForcedSilence, silenceMediaIn } from "@/capture/silence-frame";
import { runSliceCapture } from "@/capture/slice-runner";
import { DEFAULT_WORKER_COUNT, planSlices, planWholeTrack } from "@/capture/slice-plan";
import { decidePrefetch } from "@/capture/prefetch-gate";
import { installSourceBufferCapture } from "@/capture/sourcebuffer-patch";
import { getVideoIdFromSearch } from "@/capture/video-id";
import { readWorkerAssignment } from "@/capture/worker-frame";
import { selectPlaybackElement } from "@/pageworld/select-media-element";

// -- Track capture (MAIN world) ----------------------------------------------
//
// Patches SourceBuffer.appendBuffer at document_start, before YouTube's own
// player script runs, so capture rides the player's own fetch and inherits its
// PO token, signature and n-descrambling rather than re-deriving any of it.
//
// all_frames, so this also runs inside the hidden worker frames from
// frame-pool.ts. Patching a child frame from its parent would be a poll against
// the child player's boot; document_start is the only race-free option.
export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_start",
  all_frames: true,
  world: "MAIN",
};

const ENDED_LISTENER_POLL_MS = 2000;
const FULLY_BUFFERED_EPSILON_S = 0.5;

const accumulator = createCaptureAccumulator();

// Stems already cached: retaining bytes and announcing readiness would
// re-upload and re-separate a track that is already done.
const stoodDownVideoIds = new Set<string>();

function onAudioChunk(mimeType: string, bytes: Uint8Array): void {
  const videoId = getVideoIdFromSearch(window.location.search);
  if (videoId !== null && accumulator.setActiveVideoId(videoId)) {
    log(`capture reset for videoId=${videoId}`);
    // A reset re-arms retention, so a stood-down track stands down again.
    if (stoodDownVideoIds.has(videoId)) accumulator.standDown();
  }

  const result = accumulator.addChunk(mimeType, bytes);
  if (result === "cap-hit") {
    log(
      `capture cap hit at ${DEFAULT_MAX_RETAINED_BYTES} bytes; further chunks are dropped from decode input but still counted in totals`
    );
  }
}

const isAdPlayingHere = (): boolean => isAdPlaying(document);

const capture = installSourceBufferCapture({ isAdPlaying: isAdPlayingHere, onAudioChunk });

// -- Worker frame mode -------------------------------------------------------
//
// A frame carrying a slice marker is one of our own hidden players: it drives
// its own slice, reports to the opener, and runs no orchestration.

const workerAssignment = readWorkerAssignment(window.location.search);

// Catches an element autoplaying from its attribute without calling play().
const SILENCE_SWEEP_MS = 250;

if (workerAssignment) {
  // Before anything else: muting only once an element exists let everything up
  // to that point, preroll ads included, reach the listener's speakers.
  if (!installForcedSilence(HTMLMediaElement.prototype)) {
    logError("worker frame could not be silenced, refusing to capture in it", new Error("no media setters"));
  }
  silenceMediaIn(document);
  setInterval(() => silenceMediaIn(document), SILENCE_SWEEP_MS);

  const workerVideoId = getVideoIdFromSearch(window.location.search);
  log(
    `worker frame for slice ${workerAssignment.index} [${workerAssignment.fromSeconds.toFixed(1)}s, ${workerAssignment.toSeconds.toFixed(1)}s)`
  );
  if (workerVideoId) {
    void runSliceCapture(accumulator, workerAssignment, workerVideoId).catch(error => {
      logError(`worker slice ${workerAssignment.index} crashed`, error);
    });
  }
}

// Top-frame orchestration only: all_frames also puts this script in YouTube's
// own iframes, which must never announce captures or spawn workers.
const isTopFrame = window.top === window;
const runsOrchestration = isTopFrame && !workerAssignment;

// -- Capture completion ------------------------------------------------------

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

// Keyed by duration too: a preroll reuses the page's videoId with its own much
// shorter duration, and used to consume the track's one announcement.
function announceKey(videoId: string, durationSeconds: number): string {
  return `${videoId}:${Math.round(durationSeconds)}`;
}

function announceIfCaptureComplete(element: HTMLVideoElement): void {
  const stats = accumulator.getStats();
  if (!stats.videoId || stats.retainedChunkCount === 0) return;
  if (stoodDownVideoIds.has(stats.videoId)) return;
  // A hidden player owns this track. Announcing here races it with whatever the
  // listener happened to play, which is partial and may not even decode.
  if (prefetchStateByVideoId.get(stats.videoId) === "running") return;
  if (isAdPlayingHere()) return;
  if (!Number.isFinite(element.duration)) return;

  const key = announceKey(stats.videoId, element.duration);
  if (announcedKeys.has(key)) return;
  announcedKeys.add(key);
  announceCaptureReady(stats.videoId);
}

// Waiting for "ended" would make a track singable only on a second listen.
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
  if (!videoId || stoodDownVideoIds.has(videoId) || isAdPlayingHere()) return;
  const prefetching = prefetchStateByVideoId.get(videoId) === "running";
  const source: DownloadSource = prefetching ? "hidden-player" : "listener-playback";
  const fraction = prefetching
    ? hiddenPlayerProgress()
    : computeBufferedFraction(bufferedEndSeconds(element), element.duration);
  const message: DownloadProgressMessage = { type: "blk-download-progress", videoId, fraction, source };
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

if (runsOrchestration) setInterval(pollCaptureCompletion, ENDED_LISTENER_POLL_MS);

// -- Hidden-player prefetch --------------------------------------------------
//
// Acquires the whole track through a hidden worker player instead of waiting on
// the listener's own playback.

let slicedPrefetch: Promise<CapturedSlice[]> | null = null;
// Which track the in-flight capture belongs to. Without it the promise was
// handed to whichever track asked next.
let slicedPrefetchVideoId: string | null = null;

// One worker, not four: every worker that seeks mid-track stalls within
// seconds, while one starting at zero never seeks and takes the whole track in
// about ten seconds. DEFAULT_WORKER_COUNT stays reachable from the console.
const PRODUCTION_WORKER_COUNT = 1;

// The request now only arrives once the cache lookup has answered "no stems",
// so the old six second head start is pure latency. Kept short rather than zero
// so a rapid skip through several tracks does not spawn a player per track.
const PREFETCH_DELAY_MS = 800;

interface PrefetchedTrack {
  mimeType: string;
  bytes: Uint8Array;
}

const prefetchedByVideoId = new Map<string, PrefetchedTrack>();

// running: a hidden player owns acquisition and nothing else may announce.
// unavailable: it produced nothing, so the listener's playback may announce.
type PrefetchState = "running" | "done" | "unavailable";
const prefetchStateByVideoId = new Map<string, PrefetchState>();

// Reported instead of the listener's buffered fraction while a prefetch owns
// the track, since that number describes work nobody is waiting on.
function hiddenPlayerProgress(): number {
  try {
    const frame = document.querySelector<HTMLIFrameElement>(`iframe[id^="${FRAME_ID_PREFIX}"]`);
    const video = frame?.contentDocument?.querySelector("video");
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return Number.NaN;
    return computeBufferedFraction(video.currentTime, video.duration);
  } catch (error) {
    logError("could not read the hidden player's progress", error);
    return Number.NaN;
  }
}

function prefetchTrackInSlices(workerCount = DEFAULT_WORKER_COUNT): Promise<CapturedSlice[]> {
  const videoId = getVideoIdFromSearch(window.location.search);
  if (!videoId) {
    log("sliced prefetch skipped: no videoId yet");
    return Promise.resolve([]);
  }

  const decision = decidePrefetch(slicedPrefetchVideoId, videoId);
  if (decision === "reuse" && slicedPrefetch) return slicedPrefetch;
  if (decision === "refuse") {
    log(`sliced prefetch for videoId=${videoId} refused: still capturing ${slicedPrefetchVideoId}`);
    return Promise.resolve([]);
  }

  // One worker needs no duration at all, which is what makes it immune to a
  // preroll: the opener cannot tell an ad's duration from the track's, and
  // planning against the ad produced a 20 s capture that reported complete.
  const element = currentVideoElement();
  const duration = element && Number.isFinite(element.duration) ? element.duration : 0;
  const slices = workerCount <= 1 ? planWholeTrack() : planSlices(duration, workerCount);
  if (slices.length === 0) {
    log("sliced prefetch skipped: no duration yet for a multi-worker plan");
    return Promise.resolve([]);
  }
  log(`sliced prefetch: ${slices.length} worker(s) for videoId=${videoId}`);

  slicedPrefetchVideoId = videoId;
  slicedPrefetch = captureTrackInSlices({
    videoId,
    slices,
    onSliceDone: (done, total) => log(`sliced prefetch progress ${done}/${total}`),
  }).finally(() => {
    slicedPrefetch = null;
    slicedPrefetchVideoId = null;
  });
  return slicedPrefetch;
}

// Riding the listener's playback only completes if they sit through the whole
// track, since YouTube buffers a limited window ahead of the playhead.

function startPrefetchFor(videoId: string): void {
  if (prefetchStateByVideoId.has(videoId) || stoodDownVideoIds.has(videoId)) return;
  prefetchStateByVideoId.set(videoId, "running");

  window.setTimeout(() => {
    // The cache probe answers in this window; a hit needs no player at all.
    if (stoodDownVideoIds.has(videoId)) {
      log(`prefetch skipped for videoId=${videoId}, its stems are already cached`);
      prefetchStateByVideoId.set(videoId, "done");
      return;
    }
    if (getVideoIdFromSearch(window.location.search) !== videoId) {
      prefetchStateByVideoId.set(videoId, "unavailable");
      return;
    }

    log(`prefetching videoId=${videoId} in a hidden player`);
    void prefetchTrackInSlices(PRODUCTION_WORKER_COUNT)
      .then(slices => {
        const captured = slices[0];
        if (!captured || captured.bytes.byteLength === 0) {
          log(`prefetch for videoId=${videoId} captured nothing, falling back to the listener's own playback`);
          prefetchStateByVideoId.set(videoId, "unavailable");
          return;
        }
        prefetchedByVideoId.set(videoId, {
          mimeType: captured.mimeType,
          bytes: new Uint8Array(captured.bytes),
        });
        prefetchStateByVideoId.set(videoId, "done");
        log(`prefetch complete for videoId=${videoId}, ${captured.bytes.byteLength} bytes`);
        if (stoodDownVideoIds.has(videoId)) return;
        announceCaptureReady(videoId);
      })
      .catch(error => {
        prefetchStateByVideoId.set(videoId, "unavailable");
        logError(`prefetch failed for videoId=${videoId}`, error);
      });
  }, PREFETCH_DELAY_MS);
}

// -- Handing the bytes over --------------------------------------------------

function respondToCapturedAudioRequest(videoId: string): void {
  // The hidden worker's bytes win: they cover the whole track, where the
  // accumulator holds only what the listener played through.
  const prefetched = prefetchedByVideoId.get(videoId);
  if (prefetched) {
    const bytes = prefetched.bytes.slice();
    const message: CapturedAudioMessage = {
      type: "blk-captured-audio",
      videoId,
      mimeType: prefetched.mimeType,
      bytes: bytes.buffer,
    };
    const byteLength = bytes.byteLength;
    window.postMessage(message, window.location.origin, [bytes.buffer]);
    log(`prefetched audio sent for videoId=${videoId}, bytes=${byteLength}`);
    return;
  }

  const stats = accumulator.getStats();

  if (stats.videoId !== videoId || stats.retainedChunkCount === 0) {
    const reason = stats.videoId !== videoId ? "captured audio is for a different track" : "no audio captured yet";
    const message: CapturedAudioUnavailableMessage = { type: "blk-captured-audio-unavailable", videoId, reason };
    window.postMessage(message, window.location.origin);
    log(`captured-audio-unavailable for videoId=${videoId}: ${reason}`);
    return;
  }

  const chunks = accumulator.getChunks();
  const initSegments = countInitSegments(chunks);
  if (initSegments > 1) log(`capture saw ${initSegments} initializations for videoId=${videoId}, keeping the first`);
  const bytes = concatenateChunks(planFirstPlusMedia(chunks));
  // Read before the transfer detaches the buffer, which otherwise logs 0.
  const byteLength = bytes.byteLength;
  const message: CapturedAudioMessage = {
    type: "blk-captured-audio",
    videoId,
    mimeType: stats.mimeTypes[0] ?? "audio/webm",
    bytes: bytes.buffer,
  };
  window.postMessage(message, window.location.origin, [bytes.buffer]);
  log(`captured-audio sent for videoId=${videoId}, bytes=${byteLength}`);
}

function standDownFor(videoId: string): void {
  if (stoodDownVideoIds.has(videoId)) return;
  stoodDownVideoIds.add(videoId);
  if (accumulator.getStats().videoId !== videoId) return;
  const retainedBefore = accumulator.getStats().retainedChunkCount;
  accumulator.standDown();
  log(`capture stood down for videoId=${videoId}, dropped ${retainedBefore} retained chunk(s)`);
}

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data: unknown = event.data;
  if (isRequestCapturedAudioMessage(data)) respondToCapturedAudioRequest(data.videoId);
  if (isRequestPrefetchMessage(data) && runsOrchestration) startPrefetchFor(data.videoId);
  if (isCaptureStandDownMessage(data)) standDownFor(data.videoId);
});

declare global {
  interface Window {
    blkRunCaptureDecodeExperiment: () => Promise<unknown>;
    blkDisableCapture: () => void;
    blkPrefetchTrackInSlices: (workerCount?: number) => Promise<unknown>;
  }
}

window.blkPrefetchTrackInSlices = async (workerCount?: number) => {
  const started = performance.now();
  const slices = await prefetchTrackInSlices(workerCount);
  return {
    slices: slices.map(slice => ({
      index: slice.index,
      startSeconds: +slice.startSeconds.toFixed(2),
      bytes: slice.bytes.byteLength,
      mimeType: slice.mimeType,
    })),
    totalBytes: slices.reduce((sum, slice) => sum + slice.bytes.byteLength, 0),
    elapsedMs: Math.round(performance.now() - started),
  };
};

window.blkRunCaptureDecodeExperiment = runDecodeExperiment;
window.blkDisableCapture = () => {
  capture.restore();
  log("capture disabled: appendBuffer and addSourceBuffer restored to their originals");
};

log("installed; call window.blkRunCaptureDecodeExperiment() on demand, or let a track finish");
