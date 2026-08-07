// Two AudioBufferSourceNodes (vocals, instrumental) into two GainNodes into
// the shared bus's destination. Engaging disconnects only the destination
// edge off the bus source, preserving any other edges a sibling extension
// put there (its own analyser, for instance). The bypass controller is the
// one path back to safety, used by both an explicit stop and the watchdog.
//
// Real Web Audio calls only, kept thin: the gain law and the bypass state
// machine are pure and tested separately.

import { createBypassController } from "@/pageworld/bypass";
import { gainsForMixLevel } from "@/pageworld/gain-law";

interface PlaybackGraphDeps {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
}

interface GraphState {
  engaged: boolean;
  vocalsGain: number;
  instrumentalGain: number;
  stemsLoaded: boolean;
  stemFrames: number;
  stemSampleRate: number;
  instrumentalRms: number;
  stemsPlaying: boolean;
  elementTime: number;
}

interface PlaybackGraph {
  loadStems(vocals: Float32Array<ArrayBuffer>[], instrumental: Float32Array<ArrayBuffer>[], sampleRate: number): void;
  setMixLevel(mixLevel: number): void;
  stopStems(): void;
  isEngaged(): boolean;
  // Detaches the transport listeners and drops the retained stems. A graph that
  // is discarded without this keeps its listeners on the media element, and each
  // one restarts the stem sources: audible karaoke with no graph to control it.
  dispose(): void;
  // Reports what actually reached Web Audio rather than what the pipeline
  // believes it sent. A bypassed graph and a graph fed silence both present as
  // "karaoke is on" everywhere else; only these numbers tell them apart.
  describe(): GraphState;
}

function createStemBufferSource(
  context: AudioContext,
  channels: Float32Array<ArrayBuffer>[],
  sampleRate: number
): AudioBufferSourceNode {
  if (channels.length === 0) {
    throw new Error("playback-graph: a stem needs at least one channel");
  }
  const buffer = context.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
  const node = context.createBufferSource();
  node.buffer = buffer;
  return node;
}

function createPlaybackGraph(deps: PlaybackGraphDeps): PlaybackGraph {
  const { context, source } = deps;

  const vocalsGainNode = context.createGain();
  const instrumentalGainNode = context.createGain();
  vocalsGainNode.connect(context.destination);
  instrumentalGainNode.connect(context.destination);

  let vocalsSource: AudioBufferSourceNode | null = null;
  let instrumentalSource: AudioBufferSourceNode | null = null;
  let currentMixLevel = 1;
  let transportAttached = false;
  let loadedStems: {
    vocals: Float32Array<ArrayBuffer>[];
    instrumental: Float32Array<ArrayBuffer>[];
    sampleRate: number;
    durationSeconds: number;
  } | null = null;

  // The element behind the bus, so the graph can follow the player's transport
  // rather than being told about it.
  const element = source.mediaElement;

  function stopActiveSources(): void {
    vocalsSource?.stop();
    vocalsSource?.disconnect();
    instrumentalSource?.stop();
    instrumentalSource?.disconnect();
    vocalsSource = null;
    instrumentalSource = null;
  }

  const bypass = createBypassController({
    reconnectDestination() {
      source.connect(context.destination);
    },
    stopStems() {
      stopActiveSources();
    },
  });

  function applyMixLevel(mixLevel: number): void {
    currentMixLevel = mixLevel;
    const gains = gainsForMixLevel(mixLevel);
    vocalsGainNode.gain.value = gains.vocalsGain;
    instrumentalGainNode.gain.value = gains.instrumentalGain;
  }

  // An AudioBufferSourceNode cannot be paused or repositioned once started, so
  // following the player means tearing the pair down and starting a new one at
  // the right offset. Without this the stems always began at 0:00 no matter
  // where the track was, and any pause or seek desynchronised them for good.
  function startSourcesAt(offsetSeconds: number): void {
    if (!loadedStems) return;
    stopActiveSources();

    const offset = Math.max(0, Math.min(offsetSeconds, loadedStems.durationSeconds));
    vocalsSource = createStemBufferSource(context, loadedStems.vocals, loadedStems.sampleRate);
    instrumentalSource = createStemBufferSource(context, loadedStems.instrumental, loadedStems.sampleRate);
    vocalsSource.connect(vocalsGainNode);
    instrumentalSource.connect(instrumentalGainNode);
    vocalsSource.start(0, offset);
    instrumentalSource.start(0, offset);
    applyMixLevel(currentMixLevel);
  }

  function syncToElement(): void {
    if (!loadedStems || bypass.isBypassed()) return;
    if (element.paused) stopActiveSources();
    else startSourcesAt(element.currentTime);
  }

  function attachTransportListeners(): void {
    if (transportAttached) return;
    transportAttached = true;
    element.addEventListener("play", syncToElement);
    element.addEventListener("playing", syncToElement);
    element.addEventListener("pause", stopActiveSources);
    element.addEventListener("seeked", syncToElement);
    element.addEventListener("ratechange", syncToElement);
  }

  function loadStems(
    vocals: Float32Array<ArrayBuffer>[],
    instrumental: Float32Array<ArrayBuffer>[],
    sampleRate: number
  ): void {
    stopActiveSources();
    loadedStems = {
      vocals,
      instrumental,
      sampleRate,
      durationSeconds: (vocals[0]?.length ?? 0) / sampleRate,
    };

    // Preserve any other edge off the source node (a sibling extension's own
    // analyser, for instance): disconnect only the destination edge.
    source.disconnect(context.destination);

    bypass.exitBypass();
    attachTransportListeners();
    // Start where the listener actually is, not at the beginning of the track.
    if (!element.paused) startSourcesAt(element.currentTime);
  }

  function setMixLevel(mixLevel: number): void {
    applyMixLevel(mixLevel);
  }

  function stopStems(): void {
    bypass.enterBypass();
  }

  function dispose(): void {
    stopActiveSources();
    loadedStems = null;
    if (!transportAttached) return;
    transportAttached = false;
    element.removeEventListener("play", syncToElement);
    element.removeEventListener("playing", syncToElement);
    element.removeEventListener("pause", stopActiveSources);
    element.removeEventListener("seeked", syncToElement);
    element.removeEventListener("ratechange", syncToElement);
  }

  function describe(): GraphState {
    // Report the retained stems, not the live source: sources are torn down and
    // rebuilt on every pause and seek, so a paused graph still has stems loaded.
    const samples = loadedStems?.instrumental[0] ?? null;
    let instrumentalRms = 0;
    if (samples) {
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      instrumentalRms = Math.sqrt(sum / samples.length);
    }
    return {
      engaged: !bypass.isBypassed(),
      vocalsGain: vocalsGainNode.gain.value,
      instrumentalGain: instrumentalGainNode.gain.value,
      stemsLoaded: loadedStems !== null,
      stemFrames: samples?.length ?? 0,
      stemSampleRate: loadedStems?.sampleRate ?? 0,
      instrumentalRms,
      stemsPlaying: instrumentalSource !== null,
      elementTime: Number.isFinite(element.currentTime) ? element.currentTime : 0,
    };
  }

  return {
    loadStems,
    setMixLevel,
    stopStems,
    isEngaged: () => !bypass.isBypassed(),
    dispose,
    describe,
  };
}

export { createPlaybackGraph, createStemBufferSource };
export type { GraphState, PlaybackGraph, PlaybackGraphDeps };
