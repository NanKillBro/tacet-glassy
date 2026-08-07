// Runs inside a hidden worker frame: drives that frame's own player across one
// slice of the track, then hands the captured bytes up to the opener.
//
// The player is muted and played fast across its own slice, then paused at the
// slice boundary. Two measured constraints shape that: a paused player seeked
// mid-track barely buffers at all (23-66 KB against 1.68 MB for the slice that
// started at 0), and a player allowed to reach the end of the track hands the
// frame to the autoplay queue and loses the slice. See src/capture/edge-hopper.ts
// for the stall and completion logic.

import type { CaptureAccumulator } from "@/capture/accumulator";
import { isAdPlayingElement, MOVIE_PLAYER_ELEMENT_ID } from "@/capture/ad-guard";
import type { SliceCapturedMessage } from "@/capture/bridge-protocol";
import { concatenateChunks, planNaiveConcat } from "@/capture/decode-plan";
import { bufferedRangeStart, decideHop } from "@/capture/edge-hopper";
import { log, logError } from "@/capture/log";
import { getVideoIdFromSearch } from "@/capture/video-id";
import { callSafely, getYtPlayer, suppressAutoAdvance } from "@/capture/yt-player";
import type { WorkerAssignment } from "@/capture/worker-frame";

const POLL_MS = 300;
const PLAYER_READY_TIMEOUT_MS = 60_000;
const PLAYER_POLL_MS = 500;

// Fast enough that a slice is pulled well ahead of the playhead, and muted, so
// nothing is audible. YouTube paces delivery per session, which is why the
// speed comes from running several of these at once rather than from this rate.
const SLICE_PLAYBACK_RATE = 16;

// Never play into the final seconds: reaching the end fires "ended" and hands
// control to the autoplay queue, which navigates the frame to the next track
// and loses the slice entirely (observed live: a worker reset onto a different
// videoId and never reported). The guard has to be measured in media time, not
// wall clock, because one poll at 16x covers 4.8 s of the track: a flat 5 s
// guard let two workers step straight over the end between polls.
const END_OF_TRACK_GUARD_S = Math.max(5, (SLICE_PLAYBACK_RATE * POLL_MS * 3) / 1000);

// How long to let playback establish before seeking, and how hard to insist
// the seek actually took.
const PLAYBACK_INIT_TIMEOUT_MS = 8000;
const SEEK_CONFIRM_ATTEMPTS = 6;
const SEEK_TOLERANCE_S = 5;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isAdPlaying(doc: Document): boolean {
  return isAdPlayingElement(doc.getElementById(MOVIE_PLAYER_ELEMENT_ID));
}

// The element that decodes audio, not merely the first <video>: YouTube Music
// runs a second, silent one when Better Lyrics Shaders' animated art is on.
function audibleVideo(doc: Document): HTMLVideoElement | null {
  const candidates = Array.from(doc.querySelectorAll("video"));
  return (
    candidates.find(
      candidate =>
        ((candidate as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0) >
        0
    ) ??
    candidates[0] ??
    null
  );
}

async function waitForPlayer(): Promise<HTMLVideoElement | null> {
  const deadline = Date.now() + PLAYER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(PLAYER_POLL_MS);
    if (isAdPlaying(document)) continue;
    const video = audibleVideo(document);
    if (video && Number.isFinite(video.duration) && video.duration > 0) return video;
  }
  return null;
}

async function runSliceCapture(
  accumulator: CaptureAccumulator,
  assignment: WorkerAssignment,
  videoId: string
): Promise<void> {
  const video = await waitForPlayer();
  if (!video) {
    logError(`worker slice ${assignment.index} gave up: no usable player`, new Error("player never became ready"));
    return;
  }

  video.muted = true;
  video.loop = true;

  // Everything below goes through YTM's own player where possible. Driving the
  // element directly lost both ways: mid-track workers had their play()
  // interrupted by a pause the player issued, and frames were navigated onto
  // the next queue item regardless of video.loop.
  const player = getYtPlayer(document);
  if (player) suppressAutoAdvance(player);

  const duration = video.duration;
  const sliceEnd = Math.min(assignment.toSeconds, duration);
  const seekTo = (seconds: number): void => {
    const target = Math.max(0, Math.min(seconds, duration - 0.1));
    if (player && typeof player.seekTo === "function") {
      callSafely("seekTo", () => player.seekTo?.(target, true));
      return;
    }
    try {
      video.currentTime = target;
    } catch {
      // The player can reject a seek while re-initialising; the next poll retries.
    }
  };
  const startPlayback = (): void => {
    video.playbackRate = SLICE_PLAYBACK_RATE;
    if (player && typeof player.playVideo === "function") {
      callSafely("setPlaybackRate", () => player.setPlaybackRate?.(SLICE_PLAYBACK_RATE));
      callSafely("playVideo", () => player.playVideo?.());
      return;
    }
    void video.play().catch(() => {
      // Autoplay can refuse transiently; the next poll retries.
    });
  };
  const stopPlayback = (): void => {
    if (player && typeof player.pauseVideo === "function") {
      callSafely("pauseVideo", () => player.pauseVideo?.());
      return;
    }
    try {
      video.pause();
    } catch {
      // Not fatal: the loop only needs the buffered edge to keep growing.
    }
  };

  // Play BEFORE seeking. Seeking straight after load, while the player is still
  // wiring up its MediaSource, left mid-track workers in a state where they
  // fetched nothing at all: they stalled out having captured zero chunks, while
  // the slice starting at 0 always worked. Letting playback establish first and
  // then seeking is the sequence the player itself follows.
  startPlayback();
  const initDeadline = Date.now() + PLAYBACK_INIT_TIMEOUT_MS;
  while (Date.now() < initDeadline && video.buffered.length === 0) await sleep(200);

  if (assignment.fromSeconds > 0) {
    seekTo(assignment.fromSeconds);
    // Confirm the seek landed. An ignored seek leaves the worker capturing the
    // opening of the track instead of its own slice, which looks like success
    // right up until the slices are assembled.
    for (let attempt = 0; attempt < SEEK_CONFIRM_ATTEMPTS; attempt++) {
      await sleep(300);
      if (Math.abs(video.currentTime - assignment.fromSeconds) < SEEK_TOLERANCE_S) break;
      seekTo(assignment.fromSeconds);
    }
    startPlayback();
  }
  await sleep(400);

  const startSeconds = bufferedRangeStart(video.buffered, assignment.fromSeconds);
  let cursor = assignment.fromSeconds;
  let stalls = 0;

  while (true) {
    await sleep(POLL_MS);

    // If the frame navigated, the autoplay queue took it and this player is on
    // a different track. Stop immediately and report whatever was captured
    // rather than hanging until the pool's timeout.
    if (getVideoIdFromSearch(window.location.search) !== videoId) {
      log(`worker slice ${assignment.index} lost its frame to a navigation, sending what it has`);
      break;
    }

    // A worker never needs to play past its own slice, and the last slice must
    // stop short of the track end so "ended" never fires.
    const playCeiling = Math.min(sliceEnd, duration - END_OF_TRACK_GUARD_S);
    const beyondCeiling = video.currentTime >= playCeiling;
    if (beyondCeiling && !video.paused) stopPlayback();
    else if (!beyondCeiling && video.paused) startPlayback();

    // Progress is what the player has PLAYED THROUGH, not what it reports as
    // buffered. A seek can leave video.buffered advertising a range whose end
    // already passes sliceEnd, so a buffered-based test declared slices done
    // having captured almost nothing (66 KB and 19 KB against 1.4 MB). Anything
    // played has necessarily been fetched, and therefore captured.
    const playedTo = Math.max(cursor, video.currentTime);
    const decision = decideHop({
      bufferedEnd: playedTo,
      cursor,
      sliceEnd,
      trackDuration: duration,
      stalls,
    });

    if (decision.action === "done" || decision.action === "give-up") {
      if (decision.action === "give-up") {
        log(`worker slice ${assignment.index} stalled short of ${sliceEnd.toFixed(1)}s, sending what it has`);
      }
      break;
    }

    if (decision.action === "seek") {
      // Playback advances the position on its own; only the bookkeeping moves.
      cursor = decision.cursor;
      stalls = 0;
    } else if (decision.action === "nudge") {
      stalls++;
      seekTo(decision.to);
    } else {
      stalls++;
    }
  }

  // Always report, even empty. A silent worker leaves the pool waiting out its
  // whole timeout, which both delays the caller and makes the elapsed time
  // meaningless as a measurement.
  const chunks = accumulator.getChunks();
  if (chunks.length === 0) logError(`worker slice ${assignment.index} captured nothing`, new Error("no chunks"));

  const bytes = chunks.length === 0 ? new Uint8Array(0) : concatenateChunks(planNaiveConcat(chunks));
  const message: SliceCapturedMessage = {
    type: "blk-slice-captured",
    videoId,
    index: assignment.index,
    startSeconds,
    mimeType: accumulator.getStats().mimeTypes[0] ?? "audio/webm",
    bytes: bytes.buffer,
  };
  // Read the size before posting: transferring the buffer detaches it, so
  // logging afterwards reports 0 and makes a good capture look like a failure.
  const byteLength = bytes.byteLength;
  window.parent.postMessage(message, window.location.origin, [bytes.buffer]);
  log(`worker slice ${assignment.index} sent ${byteLength} bytes starting at ${startSeconds.toFixed(1)}s`);
}

export { runSliceCapture };
