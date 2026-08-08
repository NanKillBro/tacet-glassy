// The one answer to "what track is YouTube Music playing right now, and which
// element is playing it".
//
// Modelled on Better Lyrics' page bridge (../better-lyrics/public/script.js),
// which reads #movie_player rather than inferring anything from the DOM and
// refuses to publish until the player names a video and reports a positive
// duration. Asking the player is exact where every previous test here was a
// proxy: a duration comparison cannot tell two tracks of the same length apart,
// and a document-wide <video> scan cannot tell whose element it found.

import { MOVIE_PLAYER_ELEMENT_ID } from "@/capture/ad-guard";
import { readVideoData } from "@/capture/yt-player";
import type { YtPlayer } from "@/capture/yt-player";
import { selectPlaybackElement } from "@/pageworld/select-media-element";

interface PlayerSnapshot {
  videoId: string;
  durationSeconds: number;
}

function readDuration(player: YtPlayer): number {
  if (typeof player.getDuration !== "function") return 0;
  try {
    const duration = player.getDuration();
    return Number.isFinite(duration) ? duration : 0;
  } catch {
    return 0;
  }
}

// null means "not a track": a player that has not loaded one yet, or one that
// will not answer. Never a guess, and never an ad either, whatever the isAd
// test below implies: it was measured firing 0 times across 87 ad samples, and
// the player goes on naming the track it will return to for the whole break.
// Ads are recognised by isAdPlaying; this is kept only as a free upper bound.
function readPlayerSnapshot(player: YtPlayer | null): PlayerSnapshot | null {
  if (!player) return null;

  const videoData = readVideoData(player);
  if (!videoData || videoData.isAd === true) return null;
  if (typeof videoData.video_id !== "string" || !videoData.video_id) return null;

  const durationSeconds = readDuration(player);
  if (durationSeconds <= 0) return null;

  return { videoId: videoData.video_id, durationSeconds };
}

function currentPlayerSnapshot(doc: Document): PlayerSnapshot | null {
  const player = doc.getElementById(MOVIE_PLAYER_ELEMENT_ID);
  return readPlayerSnapshot(player ? (player as unknown as YtPlayer) : null);
}

// Scoped to the player's own subtree, since a sibling extension's #bls-video
// sits outside it and sorts first in a document-wide query. selectPlaybackElement
// still breaks the tie, because YouTube Music keeps a second element in there.
function playerVideoElement(doc: Document): HTMLVideoElement | null {
  const player = doc.getElementById(MOVIE_PLAYER_ELEMENT_ID);
  if (!player) return null;
  return selectPlaybackElement(Array.from(player.querySelectorAll("video")));
}

export { currentPlayerSnapshot, playerVideoElement, readPlayerSnapshot };
export type { PlayerSnapshot };
