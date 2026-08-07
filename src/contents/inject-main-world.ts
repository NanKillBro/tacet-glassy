import type { PlasmoCSConfig } from "plasmo";
import { acquireAudioBus } from "@/pageworld/audio-bus";
import { decideEngagement } from "@/pageworld/engagement";
import type { TargetPosition } from "@/pageworld/engagement";
import { createPlaybackGraph } from "@/pageworld/playback-graph";
import type { PlaybackGraph } from "@/pageworld/playback-graph";
import { isLoadStemsMessage, isSetMixLevelMessage, isStopStemsMessage } from "@/pageworld/protocol";

// -- Page-world audio graph --------------------------------------------------
//
// MAIN world, because only the page world can take a
// MediaElementAudioSourceNode off YouTube's <video> and share it with a sibling
// extension over window.__blyricsAudio. src/contents/fader-control.ts talks to
// this over window.postMessage; see src/pageworld/protocol.ts for the shapes.
//
// Only reconcile() builds the graph, because it owns the one decision that
// matters: which element these stems belong to. blk-set-mix-level applies to an
// existing graph or waits as pendingMixLevel, which is what keeps "default off"
// true while the fader is dragged before any track is ready.

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_start",
  all_frames: false,
  world: "MAIN",
};

// How often the binding is re-checked, and how far a duration may sit from the
// stems' and still be the same recording.
const RECONCILE_INTERVAL_MS = 1000;
const DURATION_TOLERANCE_S = 2;

interface LoadedStems {
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

// YouTube Music runs more than one <video> and only one decodes audio. A graph
// on the silent one routes nothing while every log still reports success.
console.log("[BLK-PAGE] karaoke page world ready, build 0.0.3");

function decodedBytes(element: HTMLMediaElement): number {
  return (element as HTMLMediaElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0;
}

function audibleElement(): HTMLMediaElement | null {
  const candidates = Array.from(document.querySelectorAll("video"));
  return candidates.find(candidate => candidate.isConnected && decodedBytes(candidate) > 0) ?? null;
}

// A preroll is audible, connected and decoding, so every other test calls it
// the real thing. The stems' own length is what excludes it.
function elementForStems(stems: LoadedStems): HTMLMediaElement | null {
  const audible = audibleElement();
  if (!audible || !Number.isFinite(audible.duration)) return null;
  return Math.abs(audible.duration - stems.durationSeconds) <= DURATION_TOLERANCE_S ? audible : null;
}

declare global {
  interface Window {
    blkKaraokeProbe: () => unknown;
  }
}

window.blkKaraokeProbe = () => {
  const audible = audibleElement();
  return {
    hasGraph: cachedGraph !== null,
    stemsPending: pendingStems !== null,
    stemDurationSeconds: pendingStems ? +pendingStems.durationSeconds.toFixed(2) : null,
    audibleDurationSeconds: audible && Number.isFinite(audible.duration) ? +audible.duration.toFixed(2) : null,
    audibleElementDecodedBytes: cachedElement ? decodedBytes(cachedElement) : 0,
    boundToAudibleElement: cachedElement !== null && cachedElement === audible,
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

// The one owner of "are these stems engaged, and against what". On a timer
// because the element often does not exist yet when the stems land, and because
// YouTube Music swaps it out from under a running graph.
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
  });

  if (action === "idle" || action === "hold") return;

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
    graph.loadStems(stems.vocals, stems.instrumental, stems.sampleRate);
    graph.setMixLevel(pendingMixLevel);
    console.log(`[BLK-PAGE] stems playing, mix level ${pendingMixLevel}, original is now silenced`);
  });
}

setInterval(reconcile, RECONCILE_INTERVAL_MS);

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
      `[BLK-PAGE] load-stems received, sampleRate=${data.sampleRate}, channels=${data.vocals.length}, duration=${durationSeconds.toFixed(1)}s`
    );
    pendingStems = {
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
    cachedGraph?.stopStems();
  }
});
