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
let acquiring: Promise<PlaybackGraph | null> | null = null;
let pendingMixLevel = 1;

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

    // Watchdog: any context state other than "running" is treated as a
    // failure and forces the hard bypass, whether that is the tab being
    // backgrounded, the context erroring out, or anything else.
    bus.context.addEventListener("statechange", () => {
      if (bus.context.state !== "running") graph.stopStems();
    });

    cachedGraph = graph;
    return graph;
  });
}

function ensureGraph(): Promise<PlaybackGraph | null> {
  if (cachedGraph) return Promise.resolve(cachedGraph);
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
