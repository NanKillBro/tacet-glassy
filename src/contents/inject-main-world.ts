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
// Nothing feeds blk-load-stems yet: audio acquisition and separation are a
// later phase. This graph is built and wired regardless, so that phase only
// has to post a message, not touch Web Audio.

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_start",
  all_frames: false,
  world: "MAIN",
};

let cachedGraph: PlaybackGraph | null = null;
let acquiring: Promise<PlaybackGraph | null> | null = null;

function buildGraph(): Promise<PlaybackGraph | null> {
  return acquireAudioBus().then(bus => {
    if (!bus) return null;

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
    ensureGraph().then(graph => graph?.setMixLevel(data.mixLevel));
    return;
  }

  if (isLoadStemsMessage(data)) {
    ensureGraph().then(graph => graph?.loadStems(data.vocals, data.instrumental, data.sampleRate));
    return;
  }

  if (isStopStemsMessage(data)) {
    ensureGraph().then(graph => graph?.stopStems());
  }
});
