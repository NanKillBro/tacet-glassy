import type { PlasmoCSConfig } from "plasmo";
import { acquireAudioBus } from "@/pageworld/audio-bus";
import { decideEngagement } from "@/pageworld/engagement";
import type { EngagementAction, TargetPosition } from "@/pageworld/engagement";
import { createPlaybackGraph } from "@/pageworld/playback-graph";
import type { PlaybackGraph } from "@/pageworld/playback-graph";
import { currentPlayerSnapshot, playerVideoElement } from "@/pageworld/player-state";
import { isLoadStemsMessage, isSetMixLevelMessage, isStopStemsMessage } from "@/pageworld/protocol";

// -- Page-world audio graph --------------------------------------------------
//
// MAIN world, because only the page world can take a
// MediaElementAudioSourceNode off YouTube's <video> and share it with a sibling
// extension over window.__blyricsAudio. src/contents/fader-control.ts talks to
// this over window.postMessage; see src/pageworld/protocol.ts for the shapes.

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_start",
  all_frames: false,
  world: "MAIN",
};

const RECONCILE_INTERVAL_MS = 1000;

interface LoadedStems {
  videoId: string;
  vocals: Float32Array<ArrayBuffer>[];
  instrumental: Float32Array<ArrayBuffer>[];
  sampleRate: number;
  durationSeconds: number;
}

let cachedGraph: PlaybackGraph | null = null;
let cachedElement: HTMLMediaElement | null = null;
let acquiring: Promise<PlaybackGraph | null> | null = null;
let pendingMixLevel = 1;
let pendingStems: LoadedStems | null = null;
// The stems the graph is actually playing, which is not the same question as
// whether a graph exists: a track change replaces these and nothing else.
let engagedStems: LoadedStems | null = null;
// Reported by the probe. Both silent outcomes of a failed claim look identical
// from outside, and "holding" versus "trying and failing" is the whole diagnosis.
let lastAction: EngagementAction = "idle";

console.log("[BLK-PAGE] karaoke page world ready, build 0.0.3");

function decodedBytes(element: HTMLMediaElement): number {
  return (element as HTMLMediaElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0;
}

// The player names the track it is on, so a preroll, a queue advance and a
// second recording of the same length are all excluded by the same test.
function elementForStems(stems: LoadedStems): HTMLMediaElement | null {
  const snapshot = currentPlayerSnapshot(document);
  if (!snapshot || snapshot.videoId !== stems.videoId) return null;
  const element = playerVideoElement(document);
  return element?.isConnected ? element : null;
}

// Measured: the player reaches the next track about a second before the message
// to stop does, and syncToElement restarts the old stems at the new track's
// position in the meantime, so the previous song plays over this one with the
// original silenced.
function playerOnOtherTrack(stems: LoadedStems): boolean {
  const snapshot = currentPlayerSnapshot(document);
  return snapshot !== null && snapshot.videoId !== stems.videoId;
}

declare global {
  interface Window {
    blkKaraokeProbe: () => unknown;
  }
}

window.blkKaraokeProbe = () => {
  const snapshot = currentPlayerSnapshot(document);
  const element = playerVideoElement(document);
  return {
    hasGraph: cachedGraph !== null,
    lastAction,
    acquiring: acquiring !== null,
    targetPosition: pendingStems ? targetPosition(pendingStems) : null,
    stemsPending: pendingStems !== null,
    stemsVideoId: pendingStems?.videoId ?? null,
    stemDurationSeconds: pendingStems ? +pendingStems.durationSeconds.toFixed(2) : null,
    playerVideoId: snapshot?.videoId ?? null,
    playerDurationSeconds: snapshot ? +snapshot.durationSeconds.toFixed(2) : null,
    audibleElementDecodedBytes: cachedElement ? decodedBytes(cachedElement) : 0,
    boundToPlayerElement: cachedElement !== null && cachedElement === element,
    graph: cachedGraph?.describe() ?? null,
  };
};

function discardGraph(): void {
  if (!cachedGraph) return;
  cachedGraph.stopStems();
  // dispose, not just stop: the listeners would keep restarting the sources.
  cachedGraph.dispose();
  cachedGraph = null;
  cachedElement = null;
  engagedStems = null;
}

function applyStems(graph: PlaybackGraph, stems: LoadedStems): void {
  graph.loadStems(stems.vocals, stems.instrumental, stems.sampleRate);
  graph.setMixLevel(pendingMixLevel);
  engagedStems = stems;
  console.log(`[BLK-PAGE] stems playing for videoId=${stems.videoId}, mix level ${pendingMixLevel}`);
}

function buildGraph(element: HTMLMediaElement): Promise<PlaybackGraph | null> {
  return acquireAudioBus(element).then(bus => {
    if (!bus) {
      console.warn("[BLK-PAGE] could not acquire the audio bus, playback is unchanged");
      return null;
    }
    console.log(
      `[BLK-PAGE] audio bus acquired, context=${bus.context.state}, element decoded bytes=${decodedBytes(bus.element)}`
    );

    const graph = createPlaybackGraph({ context: bus.context, source: bus.source });
    cachedElement = bus.element;

    // A context leaves "running" for recoverable reasons (a backgrounded tab, a
    // blocked main thread), and treating those as terminal read as karaoke
    // switching itself off mid-song. Resume first, bypass only if it will not.
    bus.context.addEventListener("statechange", () => {
      if (bus.context.state === "running") return;
      bus.context
        .resume()
        .catch(error => console.warn("[BLK-PAGE] context resume failed", error))
        .finally(() => {
          if (bus.context.state === "running") {
            console.log("[BLK-PAGE] context recovered, stems still engaged");
            return;
          }
          console.warn(`[BLK-PAGE] context stuck in "${bus.context.state}", bypassing to the original`);
          graph.stopStems();
        });
    });

    cachedGraph = graph;
    return graph;
  });
}

function targetPosition(stems: LoadedStems): TargetPosition {
  const target = elementForStems(stems);
  if (!target) return "none";
  return target === cachedElement ? "same" : "other";
}

function reconcile(): void {
  const stems = pendingStems;
  if (!stems) return;

  const action = decideEngagement({
    hasStems: true,
    graph: cachedGraph ? "bound" : "none",
    boundElementConnected: cachedElement?.isConnected ?? false,
    target: targetPosition(stems),
    acquiring: acquiring !== null,
    stemsEngaged: engagedStems === stems,
    playerOnOtherTrack: playerOnOtherTrack(stems),
  });
  lastAction = action;

  if (action === "idle" || action === "hold") return;

  if (action === "release") {
    cachedGraph?.stopStems();
    engagedStems = null;
    return;
  }

  // A track change keeps the element, so the graph is reused rather than torn
  // down and rebuilt: rebuilding would re-claim an element that can only ever
  // be claimed once.
  if (action === "load" && cachedGraph) {
    applyStems(cachedGraph, stems);
    return;
  }

  if (action === "rebind") {
    console.warn("[BLK-PAGE] the element these stems belong to changed, tearing the graph down");
    discardGraph();
    return;
  }

  const target = elementForStems(stems);
  if (!target) return;

  acquiring = buildGraph(target).finally(() => {
    acquiring = null;
  });

  void acquiring.then(graph => {
    if (!graph || pendingStems !== stems) return;
    // Binding the wrong element is permanent, so only a positively identified
    // other element counts: "none" is the just-claimed blind spot again.
    if (targetPosition(stems) === "other") {
      console.warn("[BLK-PAGE] the audio bus bound a different element than the stems match, leaving it disengaged");
      discardGraph();
      return;
    }
    applyStems(graph, stems);
  });
}

setInterval(reconcile, RECONCILE_INTERVAL_MS);

// Media events do not bubble, so this listens in the capture phase. A track
// change fires them immediately, which closes the gap the timer alone leaves.
for (const event of ["emptied", "loadstart", "play", "playing"]) {
  document.addEventListener(event, reconcile, true);
}

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data: unknown = event.data;

  if (isSetMixLevelMessage(data)) {
    pendingMixLevel = data.mixLevel;
    cachedGraph?.setMixLevel(data.mixLevel);
    return;
  }

  if (isLoadStemsMessage(data)) {
    const durationSeconds = (data.vocals[0]?.length ?? 0) / data.sampleRate;
    console.log(
      `[BLK-PAGE] load-stems received for videoId=${data.videoId}, sampleRate=${data.sampleRate}, channels=${data.vocals.length}, duration=${durationSeconds.toFixed(1)}s`
    );
    pendingStems = {
      videoId: data.videoId,
      vocals: data.vocals,
      instrumental: data.instrumental,
      sampleRate: data.sampleRate,
      durationSeconds,
    };
    reconcile();
    return;
  }

  if (isStopStemsMessage(data)) {
    pendingStems = null;
    engagedStems = null;
    cachedGraph?.stopStems();
  }
});
