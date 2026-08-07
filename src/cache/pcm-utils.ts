interface EncodedPacket {
  data: Uint8Array;
  timestampUs: number;
  durationUs: number;
}

interface PacketStream {
  sampleRate: number;
  numberOfChannels: number;
  totalFrames: number;
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

function deinterleave(interleaved: Float32Array, numberOfChannels: number): Float32Array[] {
  if (numberOfChannels <= 0) {
    throw new Error(`pcm-utils: numberOfChannels must be positive, got ${numberOfChannels}`);
  }
  if (interleaved.length % numberOfChannels !== 0) {
    throw new Error(
      `pcm-utils: interleaved buffer length ${interleaved.length} is not divisible by numberOfChannels ${numberOfChannels}`
    );
  }

  const numberOfFrames = interleaved.length / numberOfChannels;
  const out: Float32Array[] = [];
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

// -- Prefix boundary arithmetic -----------------------------------------------------------------

function alignToFrameCount(channels: Float32Array[], frameCount: number): Float32Array[] {
  if (frameCount < 0) throw new Error(`pcm-utils: frameCount must be non-negative, got ${frameCount}`);

  return channels.map(channel => {
    const aligned = new Float32Array(frameCount);
    aligned.set(channel.subarray(0, Math.min(channel.length, frameCount)));
    return aligned;
  });
}

function concatFrames(chunks: Float32Array[][], numberOfChannels: number): Float32Array[] {
  if (numberOfChannels <= 0) {
    throw new Error(`pcm-utils: numberOfChannels must be positive, got ${numberOfChannels}`);
  }
  for (const chunk of chunks) {
    if (chunk.length !== numberOfChannels) {
      throw new Error(`pcm-utils: expected ${numberOfChannels} channels, got ${chunk.length}`);
    }
  }

  const totalFrames = chunks.reduce((sum, chunk) => sum + (chunk[0]?.length ?? 0), 0);
  const out: Float32Array[] = [];
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

const HEADER_BYTES = 16;
const PACKET_HEADER_BYTES = 20;

function encodePacketStream(stream: PacketStream): Uint8Array<ArrayBuffer> {
  let totalBytes = HEADER_BYTES;
  for (const packet of stream.packets) totalBytes += PACKET_HEADER_BYTES + packet.data.length;

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  view.setUint32(0, stream.sampleRate, true);
  view.setUint32(4, stream.numberOfChannels, true);
  view.setUint32(8, stream.totalFrames, true);
  view.setUint32(12, stream.packets.length, true);

  const bytes = new Uint8Array(buffer);
  let offset = HEADER_BYTES;
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
  if (bytes.length < HEADER_BYTES) {
    throw new Error(`pcm-utils: packet stream buffer truncated, expected at least ${HEADER_BYTES} bytes`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleRate = view.getUint32(0, true);
  const numberOfChannels = view.getUint32(4, true);
  const totalFrames = view.getUint32(8, true);
  const packetCount = view.getUint32(12, true);

  const packets: EncodedPacket[] = [];
  let offset = HEADER_BYTES;
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

  return { sampleRate, numberOfChannels, totalFrames, packets };
}

export {
  interleave,
  deinterleave,
  framesToMicroseconds,
  microsecondsToFrames,
  alignToFrameCount,
  concatFrames,
  encodePacketStream,
  decodePacketStream,
};
export type { EncodedPacket, PacketStream };
