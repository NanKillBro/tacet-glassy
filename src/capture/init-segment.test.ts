import { looksLikeInitSegment } from "@/capture/init-segment";
import { describe, expect, it } from "vitest";

function bytesFromBoxType(boxType: string, padding = 0): Uint8Array {
  const chars = boxType.split("").map(char => char.charCodeAt(0));
  return new Uint8Array([0, 0, 0, 24, ...chars, ...new Array(padding).fill(0)]);
}

describe("looksLikeInitSegment", () => {
  it("recognizes an ISOBMFF init segment by its leading ftyp box", () => {
    expect(looksLikeInitSegment(bytesFromBoxType("ftyp"))).toBe(true);
  });

  it("rejects a media fragment leading with a moof box", () => {
    expect(looksLikeInitSegment(bytesFromBoxType("moof"))).toBe(false);
  });

  it("rejects a media fragment leading with an styp box", () => {
    expect(looksLikeInitSegment(bytesFromBoxType("styp"))).toBe(false);
  });

  describe("edge cases", () => {
    it("rejects an empty buffer", () => {
      expect(looksLikeInitSegment(new Uint8Array(0))).toBe(false);
    });

    it("rejects a buffer shorter than the box type field", () => {
      expect(looksLikeInitSegment(new Uint8Array([0, 0, 0]))).toBe(false);
    });

    it("rejects a buffer that ends exactly at the box type boundary but is truncated inside it", () => {
      expect(looksLikeInitSegment(new Uint8Array([0, 0, 0, 24, 0x66, 0x74]))).toBe(false);
    });

    it("accepts the minimum length buffer that fully contains the box type", () => {
      expect(looksLikeInitSegment(bytesFromBoxType("ftyp", 0))).toBe(true);
    });

    it("is unaffected by trailing bytes after the box type", () => {
      expect(looksLikeInitSegment(bytesFromBoxType("ftyp", 100))).toBe(true);
    });
  });

  describe("invariants", () => {
    it("is a pure function: identical input produces identical output", () => {
      const bytes = bytesFromBoxType("ftyp");
      expect(looksLikeInitSegment(bytes)).toBe(looksLikeInitSegment(bytes));
    });

    it("does not mutate the input buffer", () => {
      const bytes = bytesFromBoxType("ftyp");
      const snapshot = Uint8Array.from(bytes);
      looksLikeInitSegment(bytes);
      expect(bytes).toEqual(snapshot);
    });
  });
});
