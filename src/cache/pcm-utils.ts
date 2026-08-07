interface EncodedPacket {
  data: Uint8Array;
  timestampUs: number;
  durationUs: number;
}

interface DecoderConfig {
  sampleRate: number;
  numberOfChannels: number;
  description: Uint8Array;
}

interface PacketStream {
  sampleRate: number;
  numberOfChannels: number;
  totalFrames: number;
  decoderConfig: DecoderConfig;
  packets: EncodedPacket[];
}

// -- Channel interleaving -----------------------------------------------------------------

function interleave(channels: Float32Array[]): Float32Array<ArrayBuffer> {
  const numberOfChannels = channels.length;
  if (numberOfChannels === 0) return new Float32Array(0);

  const numberOfFrames = channels[0].length;
  for (const channel of channels) {
    if (channel.length !== numberOfFrames) {
      throw new Error(`pcm-utils: all channels must have the same length, got ${channel.length} and ${numberOfFrames}`);
    }
  }

  const out = new Float32Array(numberOfFrames * numberOfChannels);
  for (let frame = 0; frame < numberOfFrames; frame++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      out[frame * numberOfChannels + channel] = channels[channel][frame];
    }
  }
  return out;
}

function deinterleave(interleaved: Float32Array, numberOfChannels: number): Float32Array<ArrayBuffer>[] {
  if (numberOfChannels <= 0) {
    throw new Error(`pcm-utils: numberOfChannels must be positive, got ${numberOfChannels}`);
  }
  if (interleaved.length % numberOfChannels !== 0) {
    throw new Error(
      `pcm-utils: interleaved buffer length ${interleaved.length} is not divisible by numberOfChannels ${numberOfChannels}`
    );
  }

  const numberOfFrames = interleaved.length / numberOfChannels;
  const out: Float32Array<ArrayBuffer>[] = [];
  for (let channel = 0; channel < numberOfChannels; channel++) {
    out.push(new Float32Array(numberOfFrames));
  }
  for (let frame = 0; frame < numberOfFrames; frame++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      out[channel][frame] = interleaved[frame * numberOfChannels + channel];
    }
  }
  return out;
}

// -- Duration arithmetic -----------------------------------------------------------------

function framesToMicroseconds(frames: number, sampleRate: number): number {
  if (sampleRate <= 0) throw new Error(`pcm-utils: sampleRate must be positive, got ${sampleRate}`);
  if (frames < 0) throw new Error(`pcm-utils: frames must be non-negative, got ${frames}`);
  return Math.round((frames / sampleRate) * 1_000_000);
}

function microsecondsToFrames(microseconds: number, sampleRate: number): number {
  if (sampleRate <= 0) throw new Error(`pcm-utils: sampleRate must be positive, got ${sampleRate}`);
  if (microseconds < 0) throw new Error(`pcm-utils: microseconds must be non-negative, got ${microseconds}`);
  return Math.round((microseconds / 1_000_000) * sampleRate);
}

function convertFrameCount(frames: number, fromSampleRate: number, toSampleRate: number): number {
  if (fromSampleRate <= 0) throw new Error(`pcm-utils: fromSampleRate must be positive, got ${fromSampleRate}`);
  if (toSampleRate <= 0) throw new Error(`pcm-utils: toSampleRate must be positive, got ${toSampleRate}`);
  if (frames < 0) throw new Error(`pcm-utils: frames must be non-negative, got ${frames}`);
  return Math.round((frames * toSampleRate) / fromSampleRate);
}

// -- Prefix boundary arithmetic -----------------------------------------------------------------

function alignToFrameCount(channels: Float32Array[], frameCount: number): Float32Array<ArrayBuffer>[] {
  if (frameCount < 0) throw new Error(`pcm-utils: frameCount must be non-negative, got ${frameCount}`);

  return channels.map(channel => {
    const aligned = new Float32Array(frameCount);
    aligned.set(channel.subarray(0, Math.min(channel.length, frameCount)));
    return aligned;
  });
}

function concatFrames(chunks: Float32Array[][], numberOfChannels: number): Float32Array<ArrayBuffer>[] {
  if (numberOfChannels <= 0) {
    throw new Error(`pcm-utils: numberOfChannels must be positive, got ${numberOfChannels}`);
  }
  for (const chunk of chunks) {
    if (chunk.length !== numberOfChannels) {
      throw new Error(`pcm-utils: expected ${numberOfChannels} channels, got ${chunk.length}`);
    }
  }

  const totalFrames = chunks.reduce((sum, chunk) => sum + (chunk[0]?.length ?? 0), 0);
  const out: Float32Array<ArrayBuffer>[] = [];
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const merged = new Float32Array(totalFrames);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk[channel], offset);
      offset += chunk[channel].length;
    }
    out.push(merged);
  }
  return out;
}

// -- Packet framing -----------------------------------------------------------------
//
// Fixed header layout (all fields little-endian uint32 unless noted):
//   0  formatVersion
//   4  sampleRate            (encoder input rate)
//   8  numberOfChannels      (encoder input channels)
//   12 totalFrames           (encoder input rate frame count)
//   16 packetCount
//   20 decoderSampleRate
//   24 decoderNumberOfChannels
//   28 descriptionLength
//   32 description bytes (descriptionLength bytes), then packets.
//
// formatVersion lives in the first four bytes specifically so that a
// pre-version buffer (whose first four bytes were the old header's plain
// sampleRate, e.g. 44100) can never collide with PACKET_STREAM_FORMAT_VERSION
// and is rejected instead of misread.

const PACKET_STREAM_FORMAT_VERSION = 2;
const FIXED_HEADER_BYTES = 32;
const PACKET_HEADER_BYTES = 20;

function encodePacketStream(stream: PacketStream): Uint8Array<ArrayBuffer> {
  const description = stream.decoderConfig.description;
  let totalBytes = FIXED_HEADER_BYTES + description.length;
  for (const packet of stream.packets) totalBytes += PACKET_HEADER_BYTES + packet.data.length;

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  view.setUint32(0, PACKET_STREAM_FORMAT_VERSION, true);
  view.setUint32(4, stream.sampleRate, true);
  view.setUint32(8, stream.numberOfChannels, true);
  view.setUint32(12, stream.totalFrames, true);
  view.setUint32(16, stream.packets.length, true);
  view.setUint32(20, stream.decoderConfig.sampleRate, true);
  view.setUint32(24, stream.decoderConfig.numberOfChannels, true);
  view.setUint32(28, description.length, true);

  const bytes = new Uint8Array(buffer);
  bytes.set(description, FIXED_HEADER_BYTES);

  let offset = FIXED_HEADER_BYTES + description.length;
  for (const packet of stream.packets) {
    view.setUint32(offset, packet.data.length, true);
    view.setFloat64(offset + 4, packet.timestampUs, true);
    view.setFloat64(offset + 12, packet.durationUs, true);
    bytes.set(packet.data, offset + PACKET_HEADER_BYTES);
    offset += PACKET_HEADER_BYTES + packet.data.length;
  }

  return bytes;
}

function decodePacketStream(buffer: ArrayBuffer | Uint8Array): PacketStream {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < FIXED_HEADER_BYTES) {
    throw new Error(`pcm-utils: packet stream buffer truncated, expected at least ${FIXED_HEADER_BYTES} bytes`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const formatVersion = view.getUint32(0, true);
  if (formatVersion !== PACKET_STREAM_FORMAT_VERSION) {
    throw new Error(
      `pcm-utils: unsupported packet stream format version ${formatVersion}, expected ${PACKET_STREAM_FORMAT_VERSION}. Stems cached in an older format must be re-separated.`
    );
  }

  const sampleRate = view.getUint32(4, true);
  const numberOfChannels = view.getUint32(8, true);
  const totalFrames = view.getUint32(12, true);
  const packetCount = view.getUint32(16, true);
  const decoderSampleRate = view.getUint32(20, true);
  const decoderNumberOfChannels = view.getUint32(24, true);
  const descriptionLength = view.getUint32(28, true);

  const descriptionStart = FIXED_HEADER_BYTES;
  const descriptionEnd = descriptionStart + descriptionLength;
  if (descriptionEnd > bytes.length) {
    throw new Error(`pcm-utils: packet stream buffer truncated at decoder description`);
  }
  const description = bytes.slice(descriptionStart, descriptionEnd);

  const packets: EncodedPacket[] = [];
  let offset = descriptionEnd;
  for (let i = 0; i < packetCount; i++) {
    if (offset + PACKET_HEADER_BYTES > bytes.length) {
      throw new Error(`pcm-utils: packet stream buffer truncated at packet ${i} header`);
    }
    const byteLength = view.getUint32(offset, true);
    const timestampUs = view.getFloat64(offset + 4, true);
    const durationUs = view.getFloat64(offset + 12, true);
    const dataStart = offset + PACKET_HEADER_BYTES;
    const dataEnd = dataStart + byteLength;
    if (dataEnd > bytes.length) {
      throw new Error(`pcm-utils: packet stream buffer truncated at packet ${i} data`);
    }
    packets.push({ data: bytes.slice(dataStart, dataEnd), timestampUs, durationUs });
    offset = dataEnd;
  }

  return {
    sampleRate,
    numberOfChannels,
    totalFrames,
    decoderConfig: { sampleRate: decoderSampleRate, numberOfChannels: decoderNumberOfChannels, description },
    packets,
  };
}

export {
  interleave,
  deinterleave,
  framesToMicroseconds,
  microsecondsToFrames,
  convertFrameCount,
  alignToFrameCount,
  concatFrames,
  encodePacketStream,
  decodePacketStream,
  PACKET_STREAM_FORMAT_VERSION,
};
export type { EncodedPacket, DecoderConfig, PacketStream };
