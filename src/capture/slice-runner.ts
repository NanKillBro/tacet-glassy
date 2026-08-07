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
import { bufferedRangeEnd, bufferedRangeStart, decideHop } from "@/capture/edge-hopper";
import { log, logError } from "@/capture/log";
import { getVideoIdFromSearch } from "@/capture/video-id";
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
  // Looping makes "ended" unreachable, which is the only event that hands the
  // frame to the autoplay queue. Guarding by pausing near the end raced the
  // poll interval and lost: workers navigated onto unrelated videoIds mid-run
  // and their slices were never reported. This removes the race rather than
  // narrowing it.
  video.loop = true;
  const duration = video.duration;
  const sliceEnd = Math.min(assignment.toSeconds, duration);
  try {
    video.currentTime = Math.min(assignment.fromSeconds, Math.max(0, duration - 0.1));
  } catch (error) {
    logError(`worker slice ${assignment.index} could not seek to its start`, error);
  }
  await sleep(600);

  // Drive playback rather than sitting paused. A paused player keeps buffering
  // only from where it already was: measured cold, a paused worker seeked to
  // its slice mid-track stalled out with 23-66 KB while the slice starting at 0
  // pulled 1.68 MB. Playing fast pulls the whole slice, and because each worker
  // only covers its own span it never reaches the end of the track, which is
  // what would trigger the autoplay queue.
  video.playbackRate = SLICE_PLAYBACK_RATE;
  try {
    await video.play();
  } catch (error) {
    logError(`worker slice ${assignment.index} could not start playback`, error);
  }

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
    if (beyondCeiling && !video.paused) {
      try {
        video.pause();
      } catch {
        // Not fatal: the loop only needs the buffered edge to keep growing.
      }
    } else if (!beyondCeiling && video.paused) {
      video.playbackRate = SLICE_PLAYBACK_RATE;
      void video.play().catch(() => {
        // Autoplay can refuse transiently; the next poll retries.
      });
    }

    cursor = Math.max(cursor, Math.min(video.currentTime, sliceEnd));
    const decision = decideHop({
      bufferedEnd: bufferedRangeEnd(video.buffered, cursor),
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
      try {
        video.currentTime = decision.to;
      } catch {
        // Seeking can throw while the player re-initialises; the next poll retries.
      }
    } else if (decision.action === "nudge") {
      stalls++;
      try {
        video.currentTime = decision.to;
      } catch {
        // Same as above: a failed nudge just means another poll.
      }
    } else {
      stalls++;
    }
  }

  const chunks = accumulator.getChunks();
  if (chunks.length === 0) {
    logError(`worker slice ${assignment.index} captured nothing`, new Error("no chunks"));
    return;
  }

  const bytes = concatenateChunks(planNaiveConcat(chunks));
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
