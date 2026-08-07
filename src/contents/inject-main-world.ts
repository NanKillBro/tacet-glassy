import type { PlasmoCSConfig } from "plasmo";
import { acquireAudioBus } from "@/pageworld/audio-bus";
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
// blk-load-stems is the only message that builds the graph (acquireAudioBus
// claims the media element's MediaElementAudioSourceNode, which can only
// happen once per element, ever). blk-set-mix-level never does: it either
// applies straight to an already-built graph or is remembered as
// pendingMixLevel to apply once loadStems finally builds one. This is what
// keeps "default off" true even while the user is dragging the fader before
// any track has been processed. blk-stop-stems is a no-op with nothing
// built, since there is nothing to bypass yet.

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_start",
  all_frames: false,
  world: "MAIN",
};

let cachedGraph: PlaybackGraph | null = null;
let cachedElement: HTMLMediaElement | null = null;
let acquiring: Promise<PlaybackGraph | null> | null = null;
let pendingMixLevel = 1;

// YouTube Music runs more than one <video>, and only one of them decodes
// audio. A graph built against the silent one routes nothing, so the real
// element keeps playing through its own path and the feature appears to do
// nothing at all while every log still reports success. The cached graph is
// therefore only reusable while its element is still the audible one.
console.log("[BLK-PAGE] karaoke page world ready, build 0.0.2");

function decodedBytes(element: HTMLMediaElement): number {
  return (element as HTMLMediaElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0;
}

function audibleElement(): HTMLMediaElement | null {
  const candidates = Array.from(document.querySelectorAll("video"));
  return candidates.find(candidate => candidate.isConnected && decodedBytes(candidate) > 0) ?? null;
}

function buildGraph(): Promise<PlaybackGraph | null> {
  return acquireAudioBus().then(bus => {
    if (!bus) {
      console.warn("[BLK-PAGE] could not acquire the audio bus, playback is unchanged");
      return null;
    }
    console.log(
      `[BLK-PAGE] audio bus acquired, context=${bus.context.state}, element decoded bytes=${
        (bus.element as HTMLMediaElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0
      }`
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

function ensureGraph(): Promise<PlaybackGraph | null> {
  const audible = audibleElement();

  if (cachedGraph) {
    if (cachedElement === audible) return Promise.resolve(cachedGraph);
    console.warn(
      `[BLK-PAGE] cached graph is bound to the wrong element (decoded bytes=${
        cachedElement ? decodedBytes(cachedElement) : "none"
      }), rebuilding against the audible one`
    );
    cachedGraph.stopStems();
    cachedGraph = null;
    cachedElement = null;
  }

  if (!acquiring) {
    acquiring = buildGraph().finally(() => {
      acquiring = null;
    });
  }
  return acquiring;
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
    console.log(`[BLK-PAGE] load-stems received, sampleRate=${data.sampleRate}, channels=${data.vocals.length}`);
    ensureGraph().then(graph => {
      if (!graph) {
        console.warn("[BLK-PAGE] no graph, stems not loaded, you will still hear the original");
        return;
      }
      graph.loadStems(data.vocals, data.instrumental, data.sampleRate);
      graph.setMixLevel(pendingMixLevel);
      console.log(`[BLK-PAGE] stems playing, mix level ${pendingMixLevel}, original is now disconnected`);
    });
    return;
  }

  if (isStopStemsMessage(data)) {
    cachedGraph?.stopStems();
  }
});
