import { describe, expect, it } from "vitest";
import {
  alignToFrameCount,
  concatFrames,
  decodePacketStream,
  deinterleave,
  encodePacketStream,
  framesToMicroseconds,
  interleave,
  microsecondsToFrames,
} from "@/cache/pcm-utils";
import type { EncodedPacket } from "@/cache/pcm-utils";

// -- Test helpers -----------------------------------------------------------------

function makeRamp(length: number, offset = 0): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = i + offset;
  return out;
}

function makePacket(byte: number, length: number, timestampUs: number, durationUs: number): EncodedPacket {
  return { data: new Uint8Array(length).fill(byte), timestampUs, durationUs };
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
      const encoded = encodePacketStream({ sampleRate: 44100, numberOfChannels: 2, totalFrames: 1764, packets });
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
      const encoded = encodePacketStream({ sampleRate: 48000, numberOfChannels: 1, totalFrames: 960, packets });
      const arrayBuffer = new ArrayBuffer(encoded.byteLength);
      new Uint8Array(arrayBuffer).set(encoded);
      const decoded = decodePacketStream(arrayBuffer);
      expect(decoded.packets.length).toBe(1);
      expect(decoded.totalFrames).toBe(960);
    });
  });

  describe("edge cases", () => {
    it("round-trips zero packets and zero totalFrames", () => {
      const encoded = encodePacketStream({ sampleRate: 44100, numberOfChannels: 2, totalFrames: 0, packets: [] });
      const decoded = decodePacketStream(encoded);
      expect(decoded.packets).toEqual([]);
      expect(decoded.sampleRate).toBe(44100);
      expect(decoded.numberOfChannels).toBe(2);
      expect(decoded.totalFrames).toBe(0);
    });

    it("round-trips a zero-length packet", () => {
      const packets = [makePacket(0, 0, 0, 0)];
      const encoded = encodePacketStream({ sampleRate: 44100, numberOfChannels: 2, totalFrames: 0, packets });
      const decoded = decodePacketStream(encoded);
      expect(decoded.packets[0].data.length).toBe(0);
    });
  });

  describe("error paths", () => {
    it("throws when the buffer is shorter than the header", () => {
      expect(() => decodePacketStream(new Uint8Array(4))).toThrow(/truncated|short/i);
    });

    it("throws when a packet's declared length runs past the buffer", () => {
      const encoded = encodePacketStream({
        sampleRate: 44100,
        numberOfChannels: 2,
        totalFrames: 5,
        packets: [makePacket(1, 5, 0, 1000)],
      });
      const truncated = encoded.slice(0, encoded.length - 2);
      expect(() => decodePacketStream(truncated)).toThrow(/truncated|short/i);
    });
  });
});
