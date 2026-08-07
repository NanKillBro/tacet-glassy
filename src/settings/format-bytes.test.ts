import { describe, expect, it } from "vitest";
import { formatBytes } from "@/settings/format-bytes";

describe("formatBytes", () => {
  it("formats zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats a plain byte count under 1024", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("formats exactly 1023 bytes without converting", () => {
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats exactly 1024 bytes as one kilobyte", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("formats exactly one megabyte", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });

  it("formats the default cache budget", () => {
    expect(formatBytes(250 * 1024 * 1024)).toBe("250.0 MB");
  });

  it("formats a fractional kilobyte value", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("formats a gigabyte value", () => {
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
  });

  it("caps at terabytes rather than overflowing the unit table", () => {
    expect(formatBytes(1024 ** 5)).toBe("1024.0 TB");
  });

  describe("edge cases", () => {
    it("treats a negative byte count as zero", () => {
      expect(formatBytes(-100)).toBe("0 B");
    });

    it("treats NaN as zero", () => {
      expect(formatBytes(Number.NaN)).toBe("0 B");
    });

    it("treats Infinity as zero", () => {
      expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
    });

    it("rounds a fractional byte count under 1 KB to the nearest whole byte", () => {
      expect(formatBytes(500.6)).toBe("501 B");
    });
  });
});
