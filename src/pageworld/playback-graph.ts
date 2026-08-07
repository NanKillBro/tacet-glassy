// -- Playback graph ----------------------------------------------------------
//
// The original is silenced with a gain of ZERO, never by disconnecting it. Web
// Audio only pulls through nodes reaching the destination, so a disconnected
// MediaElementAudioSourceNode stalls the element behind it: currentTime freezes
// and YouTube Music discards the element and builds another, repeatedly.

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
  // A graph discarded without this keeps its listeners on the element, and each
  // one restarts the stem sources: audible karaoke nothing can control.
  dispose(): void;
  // What actually reached Web Audio, not what the pipeline believes it sent.
  describe(): GraphState;
}

// Built once per track. A full track is tens of megabytes per stem, and the
// copy runs on the main thread, so rebuilding these per transport event froze
// playback and eventually exhausted memory. An AudioBuffer feeds any number of
// source nodes; only the source node is single use.
function createStemBuffer(
  context: AudioContext,
  channels: Float32Array<ArrayBuffer>[],
  sampleRate: number
): AudioBuffer {
  if (channels.length === 0) {
    throw new Error("playback-graph: a stem needs at least one channel");
  }
  const buffer = context.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
  return buffer;
}

function createPlaybackGraph(deps: PlaybackGraphDeps): PlaybackGraph {
  const { context, source } = deps;

  const vocalsGainNode = context.createGain();
  const instrumentalGainNode = context.createGain();
  vocalsGainNode.connect(context.destination);
  instrumentalGainNode.connect(context.destination);

  // Only the source's own destination edge is replaced, so a sibling
  // extension's analyser survives. Unity gain, so building this is inaudible.
  const originalGainNode = context.createGain();
  originalGainNode.gain.value = 1;
  source.disconnect(context.destination);
  source.connect(originalGainNode);
  originalGainNode.connect(context.destination);

  let vocalsSource: AudioBufferSourceNode | null = null;
  let instrumentalSource: AudioBufferSourceNode | null = null;
  let currentMixLevel = 1;
  let transportAttached = false;
  let loadedStems: { vocals: AudioBuffer; instrumental: AudioBuffer; durationSeconds: number } | null = null;

  // Followed directly, rather than being told about the transport.
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
  // following the player means rebuilding the pair at the right offset.
  function startSourcesAt(offsetSeconds: number): void {
    if (!loadedStems) return;
    stopActiveSources();

    const offset = Math.max(0, Math.min(offsetSeconds, loadedStems.durationSeconds));
    vocalsSource = context.createBufferSource();
    vocalsSource.buffer = loadedStems.vocals;
    instrumentalSource = context.createBufferSource();
    instrumentalSource.buffer = loadedStems.instrumental;
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
    if (vocals.length === 0 || instrumental.length === 0) {
      console.warn("[BLK-PAGE] load-stems carried no channels, staying on the original");
      return;
    }

    const vocalsBuffer = createStemBuffer(context, vocals, sampleRate);
    const instrumentalBuffer = createStemBuffer(context, instrumental, sampleRate);
    loadedStems = {
      vocals: vocalsBuffer,
      instrumental: instrumentalBuffer,
      durationSeconds: vocalsBuffer.duration,
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

    // Hand the source back as the bus gave it: a leftover gain is a second path
    // to the destination, so the next graph plays the original twice.
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
    // The retained stems, not the live source: sources are rebuilt on every
    // pause and seek, so a paused graph still has stems loaded.
    const samples = loadedStems?.instrumental.getChannelData(0) ?? null;
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
      stemSampleRate: loadedStems?.instrumental.sampleRate ?? 0,
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

export { createPlaybackGraph };
export type { GraphState, PlaybackGraph, PlaybackGraphDeps };
