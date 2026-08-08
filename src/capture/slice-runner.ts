// Runs inside a hidden worker frame: drives that frame's own player across one
// slice of the track, then hands the captured bytes up to the opener.
//
// The player stays PAUSED and the scrubber hops to the buffered edge on every
// poll, which makes it fetch the next window at once. Measured on a 246 s
// track: 6 s hopping against 18 s playing at 16x, because a playhead both
// consumes the buffer and caps the fetch rate at what it can traverse.
//
// It must never reach the end of the track: that fires "ended" and hands the
// frame to the autoplay queue. See edge-hopper.ts for stalls and completion.

import type { CaptureAccumulator } from "@/capture/accumulator";
import { isAdPlaying } from "@/capture/ad-state";
import type { SliceCapturedMessage } from "@/capture/bridge-protocol";
import { concatenateChunks, countInitSegments, planFirstPlusMedia } from "@/capture/decode-plan";
import { bufferedRangeEnd, bufferedRangeStart, decideHop } from "@/capture/edge-hopper";
import { log, logError } from "@/capture/log";
import { getVideoIdFromSearch } from "@/capture/video-id";
import { callSafely, getYtPlayer, suppressAutoAdvance } from "@/capture/yt-player";
import type { WorkerAssignment } from "@/capture/worker-frame";

const POLL_MS = 300;
// Ad time does not count against this: a measured 60 s ad block spent the whole
// budget and gave up on a track that was about to play fine.
const PLAYER_READY_TIMEOUT_MS = 60_000;
const PLAYER_READY_CAP_MS = 300_000;
const PLAYER_POLL_MS = 500;

// Never seek into the final seconds; see the header for why.
const END_OF_TRACK_GUARD_S = 15;

// Larger than any estimate refinement, so it means different media entirely.
const DURATION_CHANGE_S = 2;

// How long the last slice waits, paused at that guard, for the tail it is not
// allowed to play through to arrive anyway.
const TAIL_SETTLE_MS = 4000;

// How long to let playback establish before seeking, and how hard to insist
// the seek actually took.
const PLAYBACK_INIT_TIMEOUT_MS = 8000;
const SEEK_CONFIRM_ATTEMPTS = 6;
const SEEK_TOLERANCE_S = 5;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// YouTube Music runs a second, silent <video> when Shaders' animated art is on.
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
  const startedAt = Date.now();
  let deadline = startedAt + PLAYER_READY_TIMEOUT_MS;
  while (Date.now() < deadline && Date.now() - startedAt < PLAYER_READY_CAP_MS) {
    await sleep(PLAYER_POLL_MS);
    if (isAdPlaying(document)) {
      deadline = Date.now() + PLAYER_READY_TIMEOUT_MS;
      continue;
    }
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

  // Through YTM's own player where possible: driving the element directly had
  // play() interrupted by the player, and frames navigated onto the next track.
  const player = getYtPlayer(document);
  if (player) suppressAutoAdvance(player);

  // Not const: a preroll reports the ad's length, and keeping that first number
  // captured the ad and reported it as a complete track.
  let duration = video.duration;
  let sliceEnd = Math.min(assignment.toSeconds, duration);
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

  // Establish the stream, then stop playing. Everything after this is seeking.
  void video.play().catch(() => {
    // Autoplay can refuse transiently; the loop below does not depend on it.
  });
  const initDeadline = Date.now() + PLAYBACK_INIT_TIMEOUT_MS;
  while (Date.now() < initDeadline && video.buffered.length === 0) await sleep(200);
  stopPlayback();

  if (assignment.fromSeconds > 0) {
    seekTo(assignment.fromSeconds);
    // An ignored seek captures the opening instead of this slice, and looks
    // like success until the slices are assembled.
    for (let attempt = 0; attempt < SEEK_CONFIRM_ATTEMPTS; attempt++) {
      await sleep(300);
      if (Math.abs(video.currentTime - assignment.fromSeconds) < SEEK_TOLERANCE_S) break;
      seekTo(assignment.fromSeconds);
    }
  }
  await sleep(400);

  const startSeconds = bufferedRangeStart(video.buffered, assignment.fromSeconds);
  let cursor = assignment.fromSeconds;
  let stalls = 0;

  while (true) {
    await sleep(POLL_MS);
    if (!video.paused) stopPlayback();

    // If the frame navigated, the autoplay queue took it and this player is on
    // a different track. Stop immediately and report whatever was captured
    // rather than hanging until the pool's timeout.
    if (getVideoIdFromSearch(window.location.search) !== videoId) {
      log(`worker slice ${assignment.index} lost its frame to a navigation, sending what it has`);
      break;
    }

    // Different length means different media, almost always a preroll: throw
    // away what was captured and start over against the real track.
    if (Number.isFinite(video.duration) && Math.abs(video.duration - duration) > DURATION_CHANGE_S) {
      log(
        `worker slice ${assignment.index} saw the duration change ${duration.toFixed(1)}s to ${video.duration.toFixed(1)}s, restarting`
      );
      accumulator.discardRetained();
      duration = video.duration;
      sliceEnd = Math.min(assignment.toSeconds, duration);
      cursor = assignment.fromSeconds;
      stalls = 0;
      continue;
    }

    // The contiguous edge reached from the playhead, which only ever moves into
    // bytes this worker pulled. Reading all of video.buffered instead declared
    // slices done having captured 65 KB against a 1.17 MB sibling.
    const reach = Math.max(cursor, bufferedRangeEnd(video.buffered, video.currentTime));
    const decision = decideHop({
      bufferedEnd: reach,
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
      cursor = decision.cursor;
      stalls = 0;
      seekTo(Math.min(decision.to, duration - END_OF_TRACK_GUARD_S));
    } else if (decision.action === "nudge") {
      stalls++;
      seekTo(decision.to);
    } else {
      stalls++;
    }
  }

  // The final slice must stop short of the end, so its tail arrives only by
  // waiting: a player parked near the end keeps filling ahead of its playhead.
  if (sliceEnd >= duration - END_OF_TRACK_GUARD_S) {
    log(`worker slice ${assignment.index} waiting ${TAIL_SETTLE_MS}ms for the track's tail to buffer`);
    await sleep(TAIL_SETTLE_MS);
  }

  // Always report, even empty: a silent worker holds the pool to its timeout.
  const chunks = accumulator.getChunks();
  if (chunks.length === 0) logError(`worker slice ${assignment.index} captured nothing`, new Error("no chunks"));

  // Keep the first initialization: a mid-stream quality switch splices a second
  // header in and makes the whole capture undecodable.
  const initSegments = countInitSegments(chunks);
  if (initSegments > 1) {
    log(`worker slice ${assignment.index} saw ${initSegments} initializations, keeping the first`);
  }
  const bytes = chunks.length === 0 ? new Uint8Array(0) : concatenateChunks(planFirstPlusMedia(chunks));
  const message: SliceCapturedMessage = {
    type: "blk-slice-captured",
    videoId,
    index: assignment.index,
    startSeconds,
    mimeType: accumulator.getStats().mimeTypes[0] ?? "audio/webm",
    bytes: bytes.buffer,
  };
  // Read the size before posting: the transfer detaches the buffer.
  const byteLength = bytes.byteLength;
  window.parent.postMessage(message, window.location.origin, [bytes.buffer]);
  log(`worker slice ${assignment.index} sent ${byteLength} bytes starting at ${startSeconds.toFixed(1)}s`);
}

export { runSliceCapture };
