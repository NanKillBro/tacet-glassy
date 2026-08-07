// Two AudioBufferSourceNodes (vocals, instrumental) into two GainNodes into
// the shared bus's destination, plus a third gain that carries the original
// and is turned down to silence it. The bypass controller is the one path
// back to safety, used by both an explicit stop and the watchdog.
//
// The original is silenced with a gain of zero and never by disconnecting it
// from the destination. Web Audio only pulls samples through nodes that reach
// the destination, so a disconnected MediaElementAudioSourceNode stops being
// read and the media element stalls behind it: measured on YouTube Music as
// currentTime frozen and webkitAudioDecodedByteCount stuck, followed by the
// player discarding the element and building another one, over and over. A
// zero gain keeps the graph pulling and the element playing while
// contributing nothing audible.
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
  originalGain: number;
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

  // Re-route the original through a gain of our own. Only the source's own
  // destination edge is replaced, so any other edge a sibling extension put
  // there (its own analyser, for instance) survives untouched. Unity gain
  // until something asks for the stems, so building the graph is inaudible.
  const originalGainNode = context.createGain();
  originalGainNode.gain.value = 1;
  source.disconnect(context.destination);
  source.connect(originalGainNode);
  originalGainNode.connect(context.destination);

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
    restoreOriginal() {
      originalGainNode.gain.value = 1;
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

    originalGainNode.gain.value = 0;
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

    // Hand the source back exactly as the bus handed it over. A discarded
    // graph that leaves its own gain in place is a second path to the
    // destination, so the next graph built on the same bus plays the original
    // twice over, once through each.
    originalGainNode.gain.value = 1;
    source.disconnect(originalGainNode);
    originalGainNode.disconnect();
    vocalsGainNode.disconnect();
    instrumentalGainNode.disconnect();
    source.connect(context.destination);

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
      originalGain: originalGainNode.gain.value,
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
