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

interface PlaybackGraph {
  loadStems(vocals: Float32Array<ArrayBuffer>[], instrumental: Float32Array<ArrayBuffer>[], sampleRate: number): void;
  setMixLevel(mixLevel: number): void;
  stopStems(): void;
  isEngaged(): boolean;
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

  function loadStems(
    vocals: Float32Array<ArrayBuffer>[],
    instrumental: Float32Array<ArrayBuffer>[],
    sampleRate: number
  ): void {
    stopActiveSources();

    vocalsSource = createStemBufferSource(context, vocals, sampleRate);
    instrumentalSource = createStemBufferSource(context, instrumental, sampleRate);
    vocalsSource.connect(vocalsGainNode);
    instrumentalSource.connect(instrumentalGainNode);

    // Preserve any other edge off the source node (a sibling extension's own
    // analyser, for instance): disconnect only the destination edge.
    source.disconnect(context.destination);

    vocalsSource.start();
    instrumentalSource.start();
    bypass.exitBypass();
    applyMixLevel(currentMixLevel);
  }

  function setMixLevel(mixLevel: number): void {
    applyMixLevel(mixLevel);
  }

  function stopStems(): void {
    bypass.enterBypass();
  }

  return {
    loadStems,
    setMixLevel,
    stopStems,
    isEngaged: () => !bypass.isBypassed(),
  };
}

export { createPlaybackGraph, createStemBufferSource };
export type { PlaybackGraph, PlaybackGraphDeps };
