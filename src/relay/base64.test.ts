import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "@/relay/base64";

describe("bytesToBase64", () => {
  it("encodes known bytes to their known base64 string", () => {
    expect(bytesToBase64(new TextEncoder().encode("foo"))).toBe("Zm9v");
  });

  it("encodes an empty array to an empty string", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });
});

describe("base64ToBytes", () => {
  it("decodes a known base64 string to its known bytes", () => {
    expect(base64ToBytes("Zm9v")).toEqual(new TextEncoder().encode("foo"));
  });

  it("decodes an empty string to an empty array", () => {
    expect(base64ToBytes("")).toEqual(new Uint8Array(0));
  });
});

describe("round trip", () => {
  it("recovers the original bytes for arbitrary content", () => {
    const bytes = new TextEncoder().encode("the quick brown fox jumps over the lazy dog");
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("recovers every byte value 0 to 255", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  describe("edge cases", () => {
    it("round-trips a single byte", () => {
      const bytes = new Uint8Array([42]);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    });

    it("round-trips a buffer large enough to require chunked encoding", () => {
      const bytes = new Uint8Array(500_000);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    });

    it("round-trips lengths that are not multiples of 3", () => {
      for (const length of [1, 2, 3, 4, 5, 6, 7, 8191, 8192, 8193]) {
        const bytes = new Uint8Array(length).map((_, i) => (i * 7) % 256);
        expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
      }
    });
  });

  describe("invariants", () => {
    it("is deterministic", () => {
      const bytes = new TextEncoder().encode("deterministic");
      expect(bytesToBase64(bytes)).toBe(bytesToBase64(bytes));
    });
  });
});
