import { BETTER_LYRICS_PLAYER_EVENT } from "@/orchestrator/player-source";
import { currentPlayerSnapshot } from "@/pageworld/player-state";

// -- Player bridge -----------------------------------------------------------
//
// Publishes what the player is on so the isolated world stops inferring it from
// the URL. Modelled on Better Lyrics' own bridge: a snapshot every second plus
// one on every player and media event, published unconditionally so a listener
// that starts late is served by the next tick rather than waiting for a change.
//
// Stands down the moment Better Lyrics is seen publishing, since it drives the
// same player object and its event reaches the isolated world directly.

const PUBLISH_INTERVAL_MS = 1000;

const MEDIA_EVENTS = [
  "loadedmetadata",
  "durationchange",
  "play",
  "playing",
  "pause",
  "waiting",
  "seeking",
  "seeked",
  "ratechange",
  "ended",
  "emptied",
];

interface PlayerStateMessage {
  type: "blk-player-state";
  videoId: string;
  durationSeconds: number;
}

function startPlayerBridge(): () => void {
  let betterLyricsPublishing = false;

  function publish(): void {
    if (betterLyricsPublishing) return;
    const snapshot = currentPlayerSnapshot(document);
    if (!snapshot) return;
    const message: PlayerStateMessage = {
      type: "blk-player-state",
      videoId: snapshot.videoId,
      durationSeconds: snapshot.durationSeconds,
    };
    window.postMessage(message, window.location.origin);
  }

  function onBetterLyrics(): void {
    if (betterLyricsPublishing) return;
    betterLyricsPublishing = true;
    console.log("[Tacet][page] Better Lyrics is publishing player state, standing our bridge down");
  }

  document.addEventListener(BETTER_LYRICS_PLAYER_EVENT, onBetterLyrics);
  // Media events do not bubble, hence the capture phase.
  for (const event of MEDIA_EVENTS) document.addEventListener(event, publish, true);
  const timer = window.setInterval(publish, PUBLISH_INTERVAL_MS);
  publish();

  return () => {
    clearInterval(timer);
    document.removeEventListener(BETTER_LYRICS_PLAYER_EVENT, onBetterLyrics);
    for (const event of MEDIA_EVENTS) document.removeEventListener(event, publish, true);
  };
}

export { startPlayerBridge };
