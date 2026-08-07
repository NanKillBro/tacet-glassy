// Runs inside a hidden worker frame: drives that frame's own player across one
// slice of the track, then hands the captured bytes up to the opener.
//
// The player stays PAUSED and the scrubber is hopped to the buffered edge on
// every poll, which makes it fetch the next window at once. Measured cold on
// the same 246 s track: hopping buffered 235.8 s in 6 s, which is 39x realtime,
// against 18 s for playing through at 16x. Playing is strictly worse, because
// the playhead both consumes the buffer and caps the fetch rate at whatever it
// can traverse, and YouTube Music's own API refuses any rate above 2 anyway.
//
// The player must also never reach the end of the track: that fires "ended" and
// hands the frame to the autoplay queue, which loses the slice. See
// src/capture/edge-hopper.ts for the stall and completion logic.

import type { CaptureAccumulator } from "@/capture/accumulator";
import { isAdPlayingElement, isPlayingSomethingElse, MOVIE_PLAYER_ELEMENT_ID } from "@/capture/ad-guard";
import type { SliceCapturedMessage } from "@/capture/bridge-protocol";
import { concatenateChunks, countInitSegments, planFirstPlusMedia } from "@/capture/decode-plan";
import { bufferedRangeEnd, bufferedRangeStart, decideHop } from "@/capture/edge-hopper";
import { log, logError } from "@/capture/log";
import { getVideoIdFromSearch } from "@/capture/video-id";
import { callSafely, getYtPlayer, readVideoData, suppressAutoAdvance } from "@/capture/yt-player";
import type { WorkerAssignment } from "@/capture/worker-frame";

const POLL_MS = 300;
const PLAYER_READY_TIMEOUT_MS = 60_000;
const PLAYER_POLL_MS = 500;

// Never seek into the final seconds: reaching the end fires "ended" and hands
// control to the autoplay queue, which navigates the frame to the next track
// and loses the slice entirely (observed live: a worker reset onto a different
// videoId and never reported).
const END_OF_TRACK_GUARD_S = 15;

// A change this large means the element is playing different media, not that
// the player refined its estimate.
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

function isAdPlaying(doc: Document): boolean {
  const requested = getVideoIdFromSearch(doc.defaultView?.location.search ?? "");
  if (isPlayingSomethingElse(readVideoData(getYtPlayer(doc)), requested)) return true;
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

  // Not const: a preroll's element reports the ad's length, and the track that
  // replaces it is a different length entirely. A worker that keeps the first
  // number it saw captures the ad and reports it as a complete track, which is
  // how a 20 s "track" of 335,510 bytes came back for a 245.9 s song.
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

  // Establish the stream, then stop playing. Everything after this is seeking:
  // see the header for why hopping beats playing through.
  void video.play().catch(() => {
    // Autoplay can refuse transiently; the loop below does not depend on it.
  });
  const initDeadline = Date.now() + PLAYBACK_INIT_TIMEOUT_MS;
  while (Date.now() < initDeadline && video.buffered.length === 0) await sleep(200);
  stopPlayback();

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
  }
  await sleep(400);

  const startSeconds = bufferedRangeStart(video.buffered, assignment.fromSeconds);
  let cursor = assignment.fromSeconds;
  let stalls = 0;

  while (true) {
    await sleep(POLL_MS);
    // Never let it play. A playing player consumes the buffer it is trying to
    // build, and caps the fetch rate at whatever the playhead can traverse.
    if (!video.paused) stopPlayback();

    // If the frame navigated, the autoplay queue took it and this player is on
    // a different track. Stop immediately and report whatever was captured
    // rather than hanging until the pool's timeout.
    if (getVideoIdFromSearch(window.location.search) !== videoId) {
      log(`worker slice ${assignment.index} lost its frame to a navigation, sending what it has`);
      break;
    }

    // The media under us changed length, so everything captured so far belongs
    // to something else, almost always a preroll. Throw it away and start over
    // against the real track rather than reporting the ad as the song.
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

    // Progress is the contiguous buffered edge reached from where the playhead
    // sits. This is honest here in a way it was not while playing: the playhead
    // only ever moves into bytes this worker has already pulled, so the range
    // containing it cannot advertise audio nobody fetched. Reading the whole of
    // video.buffered instead is what declared slices done having captured
    // 65 KB against a 1.17 MB sibling.
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
      // The hop itself: jump the scrubber to the edge of what is buffered,
      // which is what makes the player fetch the next window immediately
      // instead of waiting for a playhead to arrive there.
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

  // The final slice cannot play through its own end: the ceiling above stops
  // it short so "ended" never fires and the autoplay queue never takes the
  // frame, which left every track missing its last seconds (measured: slice 3
  // gave up short of 210.0s on a 210.4s track). A player paused near the end
  // keeps filling ahead of its playhead, so waiting is enough to capture the
  // tail. Only this slice needs it; the rest really do play through.
  if (sliceEnd >= duration - END_OF_TRACK_GUARD_S) {
    log(`worker slice ${assignment.index} waiting ${TAIL_SETTLE_MS}ms for the track's tail to buffer`);
    await sleep(TAIL_SETTLE_MS);
  }

  // Always report, even empty. A silent worker leaves the pool waiting out its
  // whole timeout, which both delays the caller and makes the elapsed time
  // meaningless as a measurement.
  const chunks = accumulator.getChunks();
  if (chunks.length === 0) logError(`worker slice ${assignment.index} captured nothing`, new Error("no chunks"));

  // Keep the first initialization and drop any later one. A worker plays at
  // 16x with delivery constantly behind it, which is exactly when YouTube
  // switches audio quality, and a second WebM header spliced into the middle of
  // the bytes makes the whole capture undecodable.
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
  // Read the size before posting: transferring the buffer detaches it, so
  // logging afterwards reports 0 and makes a good capture look like a failure.
  const byteLength = bytes.byteLength;
  window.parent.postMessage(message, window.location.origin, [bytes.buffer]);
  log(`worker slice ${assignment.index} sent ${byteLength} bytes starting at ${startSeconds.toFixed(1)}s`);
}

export { runSliceCapture };
