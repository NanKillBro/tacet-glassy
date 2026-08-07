// -- Not unit tested ------------------------------------------------------------
// WebCodecs (AudioEncoder, AudioDecoder, AudioData, EncodedAudioChunk) does not
// exist in Node, so this file has no vitest coverage. Every piece of logic worth
// testing (packet framing, duration arithmetic, channel interleaving and
// prefix boundary trimming) lives in pcm-utils.ts, which is fully unit tested.
// This wrapper is intentionally thin: WebCodecs calls and data shuffling only.
// Its own correctness is verified by a browser check, not by this test suite.

import {
  alignToFrameCount,
  concatFrames,
  decodePacketStream,
  deinterleave,
  encodePacketStream,
  interleave,
} from "@/cache/pcm-utils";
import type { EncodedPacket } from "@/cache/pcm-utils";

const OPUS_CODEC = "opus";
const OPUS_BITRATE = 96_000;
const LOG_PREFIX = "[OpusCodec]";

async function encodePcmToOpus(channels: Float32Array[], sampleRate: number): Promise<Blob> {
  const numberOfChannels = channels.length;
  const numberOfFrames = channels[0]?.length ?? 0;
  const packets: EncodedPacket[] = [];

  const encoder = new AudioEncoder({
    output: chunk => {
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

  const encoded = encodePacketStream({ sampleRate, numberOfChannels, totalFrames: numberOfFrames, packets });
  return new Blob([encoded], { type: "application/octet-stream" });
}

async function decodeOpusToPcm(blob: Blob): Promise<Float32Array[]> {
  const buffer = await blob.arrayBuffer();
  const { sampleRate, numberOfChannels, totalFrames, packets } = decodePacketStream(buffer);

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

  decoder.configure({ codec: OPUS_CODEC, sampleRate, numberOfChannels });

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

  const assembled = concatFrames(decodedChunks, numberOfChannels);
  return alignToFrameCount(assembled, totalFrames);
}

export { encodePcmToOpus, decodeOpusToPcm };
