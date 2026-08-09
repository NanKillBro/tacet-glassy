import { describe, expect, it } from "vitest";
import {
  alignToFrameCount,
  concatFrames,
  convertFrameCount,
  decodePacketStream,
  deinterleave,
  encodePacketStream,
  framesToMicroseconds,
  interleave,
  microsecondsToFrames,
  PACKET_STREAM_FORMAT_VERSION,
} from "@/cache/pcm-utils";
import type { DecoderConfig, EncodedPacket, PacketStream } from "@/cache/pcm-utils";

// -- Test helpers -----------------------------------------------------------------

function makeRamp(length: number, offset = 0): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = i + offset;
  return out;
}

function makePacket(byte: number, length: number, timestampUs: number, durationUs: number): EncodedPacket {
  return { data: new Uint8Array(length).fill(byte), timestampUs, durationUs };
}

function makeDecoderConfig(overrides: Partial<DecoderConfig> = {}): DecoderConfig {
  return { sampleRate: 48000, numberOfChannels: 2, description: new Uint8Array([1, 2, 3]), ...overrides };
}

function makeStream(overrides: Partial<PacketStream> = {}): PacketStream {
  return {
    sampleRate: 44100,
    numberOfChannels: 2,
    totalFrames: 0,
    decoderConfig: makeDecoderConfig(),
    packets: [],
    ...overrides,
  };
}

// -- interleave / deinterleave -----------------------------------------------------------------

describe("interleave", () => {
  it("interleaves stereo channels frame-major", () => {
    const left = Float32Array.from([1, 2, 3]);
    const right = Float32Array.from([10, 20, 30]);
    const out = interleave([left, right]);
    expect(Array.from(out)).toEqual([1, 10, 2, 20, 3, 30]);
  });

  it("interleaves mono unchanged", () => {
    const mono = Float32Array.from([1, 2, 3]);
    const out = interleave([mono]);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  describe("edge cases", () => {
    it("returns an empty array for zero channels", () => {
      expect(Array.from(interleave([]))).toEqual([]);
    });

    it("returns an empty array for zero-length channels", () => {
      expect(Array.from(interleave([new Float32Array(0), new Float32Array(0)]))).toEqual([]);
    });
  });

  describe("error paths", () => {
    it("throws when channels have mismatched lengths", () => {
      const left = Float32Array.from([1, 2, 3]);
      const right = Float32Array.from([10, 20]);
      expect(() => interleave([left, right])).toThrow(/length/i);
    });
  });
});

describe("deinterleave", () => {
  it("splits interleaved stereo back into per-channel arrays", () => {
    const interleaved = Float32Array.from([1, 10, 2, 20, 3, 30]);
    const [left, right] = deinterleave(interleaved, 2);
    expect(Array.from(left)).toEqual([1, 2, 3]);
    expect(Array.from(right)).toEqual([10, 20, 30]);
  });

  describe("invariants", () => {
    it("round-trips through interleave for stereo", () => {
      const channels = [makeRamp(50, 0), makeRamp(50, 100)];
      const roundTripped = deinterleave(interleave(channels), 2);
      expect(roundTripped.length).toBe(2);
      expect(Array.from(roundTripped[0])).toEqual(Array.from(channels[0]));
      expect(Array.from(roundTripped[1])).toEqual(Array.from(channels[1]));
    });

    it("round-trips through interleave for mono", () => {
      const channels = [makeRamp(17, 0)];
      const roundTripped = deinterleave(interleave(channels), 1);
      expect(Array.from(roundTripped[0])).toEqual(Array.from(channels[0]));
    });
  });

  describe("edge cases", () => {
    it("returns numberOfChannels empty arrays for empty input", () => {
      const out = deinterleave(new Float32Array(0), 2);
      expect(out.length).toBe(2);
      expect(Array.from(out[0])).toEqual([]);
      expect(Array.from(out[1])).toEqual([]);
    });
  });

  describe("error paths", () => {
    it("throws for zero or negative numberOfChannels", () => {
      expect(() => deinterleave(new Float32Array(4), 0)).toThrow(/channel/i);
      expect(() => deinterleave(new Float32Array(4), -1)).toThrow(/channel/i);
    });

    it("throws when the buffer length is not divisible by numberOfChannels", () => {
      expect(() => deinterleave(new Float32Array(5), 2)).toThrow(/divisible|align/i);
    });
  });
});

// -- duration arithmetic -----------------------------------------------------------------

describe("framesToMicroseconds", () => {
  it("converts a full second at 44100Hz", () => {
    expect(framesToMicroseconds(44100, 44100)).toBe(1_000_000);
  });

  it("converts half a second at 48000Hz", () => {
    expect(framesToMicroseconds(24000, 48000)).toBe(500_000);
  });

  describe("edge cases", () => {
    it("returns zero for zero frames", () => {
      expect(framesToMicroseconds(0, 44100)).toBe(0);
    });
  });

  describe("error paths", () => {
    it("throws for zero or negative sampleRate", () => {
      expect(() => framesToMicroseconds(100, 0)).toThrow(/sampleRate/i);
      expect(() => framesToMicroseconds(100, -44100)).toThrow(/sampleRate/i);
    });

    it("throws for negative frames", () => {
      expect(() => framesToMicroseconds(-1, 44100)).toThrow(/frames/i);
    });
  });
});

describe("microsecondsToFrames", () => {
  it("converts a full second at 44100Hz", () => {
    expect(microsecondsToFrames(1_000_000, 44100)).toBe(44100);
  });

  describe("invariants", () => {
    it("round-trips with framesToMicroseconds for exact multiples", () => {
      const frames = 88200;
      const sampleRate = 44100;
      expect(microsecondsToFrames(framesToMicroseconds(frames, sampleRate), sampleRate)).toBe(frames);
    });
  });

  describe("edge cases", () => {
    it("returns zero for zero microseconds", () => {
      expect(microsecondsToFrames(0, 44100)).toBe(0);
    });
  });

  describe("error paths", () => {
    it("throws for zero or negative sampleRate", () => {
      expect(() => microsecondsToFrames(1000, 0)).toThrow(/sampleRate/i);
    });

    it("throws for negative microseconds", () => {
      expect(() => microsecondsToFrames(-1, 44100)).toThrow(/microseconds/i);
    });
  });
});

describe("convertFrameCount", () => {
  it("converts 44100 input frames at 44100Hz to the 48000Hz target frame count", () => {
    expect(convertFrameCount(44100, 44100, 48000)).toBe(48000);
  });

  it("is the identity when the rates match", () => {
    expect(convertFrameCount(1000, 44100, 44100)).toBe(1000);
  });

  it("scales down when the target rate is lower", () => {
    expect(convertFrameCount(48000, 48000, 44100)).toBe(44100);
  });

  describe("edge cases", () => {
    it("returns zero for zero frames", () => {
      expect(convertFrameCount(0, 44100, 48000)).toBe(0);
    });

    it("rounds to the nearest integer", () => {
      expect(convertFrameCount(1, 44100, 48000)).toBe(Math.round(48000 / 44100));
    });
  });

  describe("error paths", () => {
    it("throws for zero or negative fromSampleRate", () => {
      expect(() => convertFrameCount(100, 0, 48000)).toThrow(/fromSampleRate/i);
      expect(() => convertFrameCount(100, -44100, 48000)).toThrow(/fromSampleRate/i);
    });

    it("throws for zero or negative toSampleRate", () => {
      expect(() => convertFrameCount(100, 44100, 0)).toThrow(/toSampleRate/i);
      expect(() => convertFrameCount(100, 44100, -48000)).toThrow(/toSampleRate/i);
    });

    it("throws for negative frames", () => {
      expect(() => convertFrameCount(-1, 44100, 48000)).toThrow(/frames/i);
    });
  });
});

// -- alignToFrameCount (prefix boundary arithmetic) -----------------------------------------------------------------

describe("alignToFrameCount", () => {
  it("trims channels longer than the target frame count", () => {
    const channels = [makeRamp(10, 0), makeRamp(10, 100)];
    const aligned = alignToFrameCount(channels, 4);
    expect(Array.from(aligned[0])).toEqual([0, 1, 2, 3]);
    expect(Array.from(aligned[1])).toEqual([100, 101, 102, 103]);
  });

  it("zero-pads channels shorter than the target frame count", () => {
    const channels = [makeRamp(3, 0)];
    const aligned = alignToFrameCount(channels, 5);
    expect(Array.from(aligned[0])).toEqual([0, 1, 2, 0, 0]);
  });

  it("returns an equivalent copy when already at the target length", () => {
    const channels = [makeRamp(4, 0)];
    const aligned = alignToFrameCount(channels, 4);
    expect(Array.from(aligned[0])).toEqual([0, 1, 2, 3]);
    expect(aligned[0]).not.toBe(channels[0]);
  });

  describe("edge cases", () => {
    it("returns empty channels for a target frame count of zero", () => {
      const channels = [makeRamp(4, 0)];
      const aligned = alignToFrameCount(channels, 0);
      expect(Array.from(aligned[0])).toEqual([]);
    });

    it("preserves the channel count", () => {
      const channels = [makeRamp(4, 0), makeRamp(4, 1), makeRamp(4, 2)];
      const aligned = alignToFrameCount(channels, 2);
      expect(aligned.length).toBe(3);
    });
  });

  describe("error paths", () => {
    it("throws for a negative frame count", () => {
      expect(() => alignToFrameCount([makeRamp(4, 0)], -1)).toThrow(/frameCount/i);
    });
  });
});

// -- concatFrames -----------------------------------------------------------------

describe("concatFrames", () => {
  it("concatenates sequential chunks per channel in order", () => {
    const chunkA = [Float32Array.from([1, 2]), Float32Array.from([10, 20])];
    const chunkB = [Float32Array.from([3, 4, 5]), Float32Array.from([30, 40, 50])];
    const out = concatFrames([chunkA, chunkB], 2);
    expect(Array.from(out[0])).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(out[1])).toEqual([10, 20, 30, 40, 50]);
  });

  describe("edge cases", () => {
    it("returns numberOfChannels empty arrays for an empty chunk list", () => {
      const out = concatFrames([], 2);
      expect(out.length).toBe(2);
      expect(Array.from(out[0])).toEqual([]);
      expect(Array.from(out[1])).toEqual([]);
    });

    it("handles a single chunk", () => {
      const chunk = [Float32Array.from([1, 2, 3])];
      const out = concatFrames([chunk], 1);
      expect(Array.from(out[0])).toEqual([1, 2, 3]);
    });
  });

  describe("error paths", () => {
    it("throws when a chunk's channel count disagrees with numberOfChannels", () => {
      const chunk = [Float32Array.from([1, 2])];
      expect(() => concatFrames([chunk], 2)).toThrow(/channel/i);
    });

    it("throws for zero or negative numberOfChannels", () => {
      expect(() => concatFrames([], 0)).toThrow(/channel/i);
    });
  });
});

// -- packet framing -----------------------------------------------------------------

describe("encodePacketStream / decodePacketStream", () => {
  describe("happy path", () => {
    it("round-trips sampleRate, numberOfChannels, totalFrames and packet bytes", () => {
      const packets = [makePacket(0xaa, 5, 0, 20_000), makePacket(0xbb, 3, 20_000, 20_000)];
      const encoded = encodePacketStream(makeStream({ totalFrames: 1764, packets }));
      const decoded = decodePacketStream(encoded);

      expect(decoded.sampleRate).toBe(44100);
      expect(decoded.numberOfChannels).toBe(2);
      expect(decoded.totalFrames).toBe(1764);
      expect(decoded.packets.length).toBe(2);
      expect(Array.from(decoded.packets[0].data)).toEqual(Array.from(packets[0].data));
      expect(decoded.packets[0].timestampUs).toBe(0);
      expect(decoded.packets[0].durationUs).toBe(20_000);
      expect(Array.from(decoded.packets[1].data)).toEqual(Array.from(packets[1].data));
      expect(decoded.packets[1].timestampUs).toBe(20_000);
    });

    it("accepts the encoded buffer as a plain ArrayBuffer too", () => {
      const packets = [makePacket(0x01, 2, 0, 20_000)];
      const encoded = encodePacketStream(
        makeStream({ sampleRate: 48000, numberOfChannels: 1, totalFrames: 960, packets })
      );
      const arrayBuffer = new ArrayBuffer(encoded.byteLength);
      new Uint8Array(arrayBuffer).set(encoded);
      const decoded = decodePacketStream(arrayBuffer);
      expect(decoded.packets.length).toBe(1);
      expect(decoded.totalFrames).toBe(960);
    });

    it("round-trips the decoder config: sampleRate, numberOfChannels and description bytes", () => {
      const decoderConfig = makeDecoderConfig({
        sampleRate: 48000,
        numberOfChannels: 2,
        description: new Uint8Array([
          0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2, 0, 128, 187, 0, 0, 0, 0, 0, 0,
        ]),
      });
      const encoded = encodePacketStream(makeStream({ decoderConfig }));
      const decoded = decodePacketStream(encoded);

      expect(decoded.decoderConfig.sampleRate).toBe(48000);
      expect(decoded.decoderConfig.numberOfChannels).toBe(2);
      expect(Array.from(decoded.decoderConfig.description)).toEqual(Array.from(decoderConfig.description));
    });
  });

  describe("edge cases", () => {
    it("round-trips zero packets and zero totalFrames", () => {
      const encoded = encodePacketStream(makeStream());
      const decoded = decodePacketStream(encoded);
      expect(decoded.packets).toEqual([]);
      expect(decoded.sampleRate).toBe(44100);
      expect(decoded.numberOfChannels).toBe(2);
      expect(decoded.totalFrames).toBe(0);
    });

    it("round-trips a zero-length packet", () => {
      const packets = [makePacket(0, 0, 0, 0)];
      const encoded = encodePacketStream(makeStream({ packets }));
      const decoded = decodePacketStream(encoded);
      expect(decoded.packets[0].data.length).toBe(0);
    });

    it("round-trips an empty description", () => {
      const encoded = encodePacketStream(
        makeStream({ decoderConfig: makeDecoderConfig({ description: new Uint8Array(0) }) })
      );
      const decoded = decodePacketStream(encoded);
      expect(decoded.decoderConfig.description.length).toBe(0);
    });

    it("round-trips an arbitrary-length description", () => {
      const description = new Uint8Array(257).map((_, i) => i % 256);
      const encoded = encodePacketStream(makeStream({ decoderConfig: makeDecoderConfig({ description }) }));
      const decoded = decodePacketStream(encoded);
      expect(Array.from(decoded.decoderConfig.description)).toEqual(Array.from(description));
    });
  });

  describe("error paths", () => {
    it("throws when the buffer is shorter than the header", () => {
      expect(() => decodePacketStream(new Uint8Array(4))).toThrow(/truncated|short/i);
    });

    it("throws when a packet's declared length runs past the buffer", () => {
      const encoded = encodePacketStream(makeStream({ totalFrames: 5, packets: [makePacket(1, 5, 0, 1000)] }));
      const truncated = encoded.slice(0, encoded.length - 2);
      expect(() => decodePacketStream(truncated)).toThrow(/truncated|short/i);
    });

    it("throws when the declared description length runs past the buffer", () => {
      const encoded = encodePacketStream(
        makeStream({ decoderConfig: makeDecoderConfig({ description: new Uint8Array([1, 2, 3, 4, 5]) }) })
      );
      const truncated = encoded.slice(0, encoded.length - 3);
      expect(() => decodePacketStream(truncated)).toThrow(/truncated|short/i);
    });

    it("rejects a buffer from an older, pre-versioned packet stream format", () => {
      const legacyHeaderBytes = 16;
      const packetData = new Uint8Array(30).fill(9);
      const buffer = new ArrayBuffer(legacyHeaderBytes + 20 + packetData.length);
      const view = new DataView(buffer);
      view.setUint32(0, 44100, true);
      view.setUint32(4, 2, true);
      view.setUint32(8, 0, true);
      view.setUint32(12, 1, true);
      view.setUint32(legacyHeaderBytes, packetData.length, true);
      view.setFloat64(legacyHeaderBytes + 4, 0, true);
      view.setFloat64(legacyHeaderBytes + 12, 0, true);
      new Uint8Array(buffer).set(packetData, legacyHeaderBytes + 20);

      expect(() => decodePacketStream(buffer)).toThrow(/version/i);
    });

    it("rejects a buffer declaring an unknown future version", () => {
      const encoded = encodePacketStream(makeStream());
      const withBogusVersion = encoded.slice();
      new DataView(withBogusVersion.buffer).setUint32(0, PACKET_STREAM_FORMAT_VERSION + 1, true);
      expect(() => decodePacketStream(withBogusVersion)).toThrow(/version/i);
    });
  });
});
