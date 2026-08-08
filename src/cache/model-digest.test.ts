import { bytesToHex, digestsMatch, sha256Hex } from "@/cache/model-digest";
import { describe, expect, it } from "vitest";

describe("bytesToHex", () => {
  it("pads every byte to two digits", () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe("00010f10ff");
  });

  it("returns nothing for nothing", () => {
    expect(bytesToHex(new Uint8Array())).toBe("");
  });
});

describe("sha256Hex", () => {
  it("matches the published digest of an empty input", async () => {
    expect(await sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches the published digest of abc", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  describe("invariants", () => {
    it("changes when a single byte changes", async () => {
      const a = await sha256Hex(new Uint8Array([1, 2, 3]));
      const b = await sha256Hex(new Uint8Array([1, 2, 4]));
      expect(a).not.toBe(b);
    });

    it("changes when bytes are lost, which is the truncation this guards", async () => {
      const whole = await sha256Hex(new Uint8Array([1, 2, 3, 4]));
      const cut = await sha256Hex(new Uint8Array([1, 2, 3]));
      expect(whole).not.toBe(cut);
    });
  });
});

describe("digestsMatch", () => {
  it("accepts the same digest in either case", () => {
    expect(digestsMatch("ABCDEF", "abcdef")).toBe(true);
  });

  it("refuses a different digest", () => {
    expect(digestsMatch("abcdef", "abcdee")).toBe(false);
  });

  describe("edge cases", () => {
    it("refuses a truncated digest", () => {
      expect(digestsMatch("abcde", "abcdef")).toBe(false);
    });

    it("refuses an empty digest", () => {
      expect(digestsMatch("", "abcdef")).toBe(false);
    });
  });
});
