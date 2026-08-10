// -- Playback graph ----------------------------------------------------------

import { createBypassController } from "@/pageworld/bypass";
import { gainsForMixLevel, listenerGain } from "@/pageworld/gain-law";
import { playerCurrentTime } from "@/pageworld/player-state";
import { resolveStemStart } from "@/pageworld/stem-offset";
import { shouldRestartStems } from "@/pageworld/stem-restart";
import type { StemStart } from "@/pageworld/stem-offset";
import { createLogger } from "@/shared/logger";

const logger = createLogger("page");

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
  playerTime: number;
  startOffset: number | null;
  startSource: string | null;
  startRefusedBecause: string | null;
  listenerGain: number;
}

interface PlaybackGraph {
  loadStems(vocals: Float32Array<ArrayBuffer>[], instrumental: Float32Array<ArrayBuffer>[], sampleRate: number): void;
  setMixLevel(mixLevel: number): void;
  stopStems(): void;
  resumeStems(): void;
  isEngaged(): boolean;
  dispose(): void;
  // What actually reached Web Audio, not what the pipeline believes it sent.
  describe(): GraphState;
}

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

  // -- Stem path: gains, then the listener's own volume, then out -------------

  const listenerVolumeNode = context.createGain();
  listenerVolumeNode.connect(context.destination);

  const vocalsGainNode = context.createGain();
  const instrumentalGainNode = context.createGain();
  vocalsGainNode.connect(listenerVolumeNode);
  instrumentalGainNode.connect(listenerVolumeNode);

  const originalGainNode = context.createGain();
  originalGainNode.gain.value = 1;
  source.disconnect(context.destination);
  source.connect(originalGainNode);
  originalGainNode.connect(context.destination);

  let vocalsSource: AudioBufferSourceNode | null = null;
  let instrumentalSource: AudioBufferSourceNode | null = null;
  let currentMixLevel = 1;
  let transportAttached = false;
  let lastStart: StemStart | null = null;
  let loadedStems: { vocals: AudioBuffer; instrumental: AudioBuffer; durationSeconds: number } | null = null;

  // Followed directly, rather than being told about the transport.
  const element = source.mediaElement;

  function syncListenerVolume(): void {
    listenerVolumeNode.gain.value = listenerGain(element.volume, element.muted);
  }
  syncListenerVolume();
  element.addEventListener("volumechange", syncListenerVolume);

  function stopActiveSources(): void {
    vocalsSource?.stop();
    vocalsSource?.disconnect();
    instrumentalSource?.stop();
    instrumentalSource?.disconnect();
    vocalsSource = null;
    instrumentalSource = null;
  }

  let startedAtOffsetSeconds = 0;
  let startedAtContextTime = 0;

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

  function startSourcesAtPlayhead(): void {
    if (!loadedStems) return;
    stopActiveSources();

    const start = resolveStemStart({
      playerTimeSeconds: playerCurrentTime(document),
      elementTimeSeconds: element.currentTime,
      stemDurationSeconds: loadedStems.durationSeconds,
    });
    lastStart = start;

    if (start.kind === "bypass") {
      logger.warn(`handing back to the original, ${start.reason}`);
      originalGainNode.gain.value = 1;
      return;
    }

    originalGainNode.gain.value = 0;
    const offset = start.offsetSeconds;
    vocalsSource = context.createBufferSource();
    vocalsSource.buffer = loadedStems.vocals;
    instrumentalSource = context.createBufferSource();
    instrumentalSource.buffer = loadedStems.instrumental;
    vocalsSource.connect(vocalsGainNode);
    instrumentalSource.connect(instrumentalGainNode);
    vocalsSource.start(0, offset);
    instrumentalSource.start(0, offset);
    startedAtOffsetSeconds = offset;
    startedAtContextTime = context.currentTime;
    applyMixLevel(currentMixLevel);
  }

  function stemPositionNow(): number {
    if (instrumentalSource === null) return Number.NaN;
    return startedAtOffsetSeconds + (context.currentTime - startedAtContextTime);
  }

  function syncToElement(): void {
    if (!loadedStems || bypass.isBypassed()) return;
    if (element.paused) {
      stopActiveSources();
      return;
    }
    const restart = shouldRestartStems({
      hasActiveSources: instrumentalSource !== null,
      stemPositionSeconds: stemPositionNow(),
      playerPositionSeconds: playerCurrentTime(document),
    });
    if (restart) startSourcesAtPlayhead();
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
      logger.warn("load-stems carried no channels, staying on the original");
      return;
    }

    const vocalsBuffer = createStemBuffer(context, vocals, sampleRate);
    const instrumentalBuffer = createStemBuffer(context, instrumental, sampleRate);
    loadedStems = {
      vocals: vocalsBuffer,
      instrumental: instrumentalBuffer,
      durationSeconds: vocalsBuffer.duration,
    };

    resumeStems();
  }

  function resumeStems(): void {
    if (!loadedStems) return;
    originalGainNode.gain.value = 0;
    bypass.exitBypass();
    attachTransportListeners();
    // Start where the listener actually is, not at the beginning of the track.
    if (!element.paused) startSourcesAtPlayhead();
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
    element.removeEventListener("volumechange", syncListenerVolume);

    originalGainNode.gain.value = 1;
    source.disconnect(originalGainNode);
    originalGainNode.disconnect();
    vocalsGainNode.disconnect();
    instrumentalGainNode.disconnect();
    listenerVolumeNode.disconnect();
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
      playerTime: playerCurrentTime(document),
      startOffset: lastStart?.kind === "start" ? lastStart.offsetSeconds : null,
      startSource: lastStart?.kind === "start" ? lastStart.source : null,
      startRefusedBecause: lastStart?.kind === "bypass" ? lastStart.reason : null,
      listenerGain: listenerVolumeNode.gain.value,
    };
  }

  return {
    loadStems,
    setMixLevel,
    stopStems,
    resumeStems,
    isEngaged: () => !bypass.isBypassed(),
    dispose,
    describe,
  };
}

export { createPlaybackGraph };
export type { GraphState, PlaybackGraph, PlaybackGraphDeps };
