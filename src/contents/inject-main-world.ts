import type { PlasmoCSConfig } from "plasmo";
import { acquireAudioBus } from "@/pageworld/audio-bus";
import { decideEngagement } from "@/pageworld/engagement";
import type { TargetPosition } from "@/pageworld/engagement";
import { createPlaybackGraph } from "@/pageworld/playback-graph";
import type { PlaybackGraph } from "@/pageworld/playback-graph";
import { isLoadStemsMessage, isSetMixLevelMessage, isStopStemsMessage } from "@/pageworld/protocol";

// -- Page-world audio graph ---------------------------------------------------
//
// Runs in the MAIN world, because only the page world can take a
// MediaElementAudioSourceNode off YouTube's own <video> element and share it
// with a sibling extension over window.__blyricsAudio. The ISOLATED-world
// fader control (src/contents/fader-control.ts) talks to this over
// window.postMessage; see src/pageworld/protocol.ts for the message shapes.
//
// blk-load-stems never builds the graph directly. It hands the stems to
// reconcile() below, which owns the one decision that matters here: which
// element these stems belong to. blk-set-mix-level never builds anything
// either: it either applies straight to an already-built graph or is
// remembered as pendingMixLevel to apply once one exists. This is what keeps
// "default off" true even while the user is dragging the fader before any
// track has been processed. blk-stop-stems drops the stems entirely, so
// nothing re-engages them afterwards.

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_start",
  all_frames: false,
  world: "MAIN",
};

// How often the bound element is re-checked against the loaded stems, and how
// far its duration may sit from theirs and still be the same recording.
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

// YouTube Music runs more than one <video>, and only one of them decodes
// audio. A graph built against the silent one routes nothing, so the real
// element keeps playing through its own path and the feature appears to do
// nothing at all while every log still reports success. The cached graph is
// therefore only reusable while its element is still the audible one.
console.log("[BLK-PAGE] karaoke page world ready, build 0.0.3");

function decodedBytes(element: HTMLMediaElement): number {
  return (element as HTMLMediaElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0;
}

function audibleElement(): HTMLMediaElement | null {
  const candidates = Array.from(document.querySelectorAll("video"));
  return candidates.find(candidate => candidate.isConnected && decodedBytes(candidate) > 0) ?? null;
}

// Duration is what tells the track apart from everything else the same player
// puts through the same element. A preroll ad is audible, connected and
// decoding, so every other test calls it the real thing: stems then engage
// against the ad, play over it on their own clock, and stay bound to that
// element after it is discarded, which is audible karaoke that nothing can
// stop. The stems' own length is the only signal that excludes it.
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
  // dispose, not just stop: a discarded graph's transport listeners keep
  // restarting its stem sources, which plays karaoke that nothing can control.
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

    // Watchdog. A context can leave "running" for entirely recoverable
    // reasons: a backgrounded tab, or the main thread being blocked long
    // enough for the audio thread to be interrupted. Treating every one of
    // those as terminal reconnected the original and left no way back, which
    // read as karaoke switching itself off mid-song. Try to resume first, and
    // only fall back to the hard bypass if the context genuinely will not
    // come back.
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

// The one owner of "are these stems engaged, and against what". Runs on a
// timer rather than only on message arrival because the element the stems
// belong to often does not exist yet when they land (a preroll ad holds the
// player), and because YouTube Music swaps the element out from under a graph
// that is already running.
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
    // The bus picks its own element, and it can disagree with the target while
    // an ad is still decoding alongside the track. Engaging anyway binds the
    // graph to the wrong element, and the binding is permanent. Only a
    // positively identified other element counts: "none" here is the same
    // just-claimed blind spot the hold rule exists for.
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
