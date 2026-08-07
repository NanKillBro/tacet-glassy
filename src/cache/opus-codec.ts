// -- Not unit tested ------------------------------------------------------------
// WebCodecs (AudioEncoder, AudioDecoder, AudioData, EncodedAudioChunk) does not
// exist in Node, so this file has no vitest coverage. Every piece of logic worth
// testing (packet framing, duration arithmetic, sample-rate frame conversion,
// channel interleaving and prefix boundary trimming) lives in pcm-utils.ts,
// which is fully unit tested. This wrapper is intentionally thin: WebCodecs
// calls and data shuffling only, plus reading the decoder config Chrome hands
// back through the encoder's output callback (Opus encodes at 48kHz
// regardless of the configured input rate, so that callback is the only
// place the true decoder sampleRate is available).
// Its own correctness is verified by a browser check, not by this test suite.

import {
  alignToFrameCount,
  concatFrames,
  convertFrameCount,
  decodePacketStream,
  deinterleave,
  encodePacketStream,
  interleave,
} from "@/cache/pcm-utils";
import type { DecoderConfig, EncodedPacket } from "@/cache/pcm-utils";

const OPUS_CODEC = "opus";
const OPUS_BITRATE = 96_000;
const LOG_PREFIX = "[OpusCodec]";

function toDecoderConfig(config: AudioDecoderConfig): DecoderConfig {
  const source = config.description;
  const description = source
    ? ArrayBuffer.isView(source)
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice()
      : new Uint8Array(source).slice()
    : new Uint8Array(0);
  return { sampleRate: config.sampleRate, numberOfChannels: config.numberOfChannels, description };
}

async function encodePcmToOpus(channels: Float32Array[], sampleRate: number): Promise<Blob> {
  const numberOfChannels = channels.length;
  const numberOfFrames = channels[0]?.length ?? 0;
  const packets: EncodedPacket[] = [];
  let decoderConfig: DecoderConfig | null = null;

  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      if (!decoderConfig && metadata?.decoderConfig) {
        decoderConfig = toDecoderConfig(metadata.decoderConfig);
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ data, timestampUs: chunk.timestamp, durationUs: chunk.duration ?? 0 });
    },
    error: error => console.warn(`${LOG_PREFIX} encoder error`, error),
  });

  encoder.configure({
    codec: OPUS_CODEC,
    sampleRate,
    numberOfChannels,
    bitrate: OPUS_BITRATE,
    opus: { format: "opus" },
  });

  if (numberOfFrames > 0) {
    const audioData = new AudioData({
      format: "f32",
      sampleRate,
      numberOfChannels,
      numberOfFrames,
      timestamp: 0,
      data: interleave(channels),
    });
    encoder.encode(audioData);
    audioData.close();
  }

  await encoder.flush();
  encoder.close();

  if (numberOfFrames > 0 && !decoderConfig) {
    throw new Error(`${LOG_PREFIX} encoder produced packets but never emitted a decoder config`);
  }

  const resolvedDecoderConfig: DecoderConfig = decoderConfig ?? {
    sampleRate,
    numberOfChannels,
    description: new Uint8Array(0),
  };

  const encoded = encodePacketStream({
    sampleRate,
    numberOfChannels,
    totalFrames: numberOfFrames,
    decoderConfig: resolvedDecoderConfig,
    packets,
  });
  return new Blob([encoded], { type: "application/octet-stream" });
}

interface DecodedOpus {
  channels: Float32Array<ArrayBuffer>[];
  sampleRate: number;
}

async function decodeOpusToPcm(blob: Blob): Promise<DecodedOpus> {
  const buffer = await blob.arrayBuffer();
  const { sampleRate: inputSampleRate, totalFrames, decoderConfig, packets } = decodePacketStream(buffer);
  const targetFrames = convertFrameCount(totalFrames, inputSampleRate, decoderConfig.sampleRate);

  if (packets.length === 0) {
    const emptyChannels = Array.from({ length: decoderConfig.numberOfChannels }, () => new Float32Array(0));
    return { channels: alignToFrameCount(emptyChannels, targetFrames), sampleRate: decoderConfig.sampleRate };
  }

  const decodedChunks: Float32Array[][] = [];

  const decoder = new AudioDecoder({
    output: audioData => {
      const interleaved = new Float32Array(audioData.numberOfFrames * audioData.numberOfChannels);
      audioData.copyTo(interleaved, { planeIndex: 0, format: "f32" });
      decodedChunks.push(deinterleave(interleaved, audioData.numberOfChannels));
      audioData.close();
    },
    error: error => console.warn(`${LOG_PREFIX} decoder error`, error),
  });

  decoder.configure({
    codec: OPUS_CODEC,
    sampleRate: decoderConfig.sampleRate,
    numberOfChannels: decoderConfig.numberOfChannels,
    description: decoderConfig.description,
  });

  for (const packet of packets) {
    decoder.decode(
      new EncodedAudioChunk({
        type: "key",
        timestamp: packet.timestampUs,
        duration: packet.durationUs,
        data: packet.data,
      })
    );
  }

  await decoder.flush();
  decoder.close();

  const assembled = concatFrames(decodedChunks, decoderConfig.numberOfChannels);
  return { channels: alignToFrameCount(assembled, targetFrames), sampleRate: decoderConfig.sampleRate };
}

export { encodePcmToOpus, decodeOpusToPcm };
export type { DecodedOpus };
