import { describe, expect, it } from "vitest";
import { DEFAULT_CHUNK_CHARS, createChunkAssembler, splitIntoChunks } from "@/relay/chunk-transfer";

describe("splitIntoChunks", () => {
  it("splits a string into chunks of the given size", () => {
    expect(splitIntoChunks("abcdefgh", 3)).toEqual(["abc", "def", "gh"]);
  });

  it("returns a single chunk when the string is shorter than the chunk size", () => {
    expect(splitIntoChunks("abc", 100)).toEqual(["abc"]);
  });

  it("returns exactly-sized chunks with no trailing empty chunk", () => {
    expect(splitIntoChunks("abcdef", 3)).toEqual(["abc", "def"]);
  });

  describe("edge cases", () => {
    it("returns a single empty chunk for an empty string", () => {
      expect(splitIntoChunks("", 10)).toEqual([""]);
    });

    it("throws for a non-positive chunk size", () => {
      expect(() => splitIntoChunks("abc", 0)).toThrow(/chunkSize/i);
      expect(() => splitIntoChunks("abc", -1)).toThrow(/chunkSize/i);
    });
  });

  describe("invariants", () => {
    it("rejoining every chunk recovers the original string", () => {
      const original = "the quick brown fox jumps over the lazy dog";
      for (const size of [1, 2, 3, 7, 100]) {
        expect(splitIntoChunks(original, size).join("")).toBe(original);
      }
    });
  });
});

describe("createChunkAssembler", () => {
  it("assembles chunks added in order", () => {
    const assembler = createChunkAssembler();
    const chunks = splitIntoChunks("abcdefgh", 3);
    chunks.forEach((data, index) => assembler.addChunk(index, chunks.length, data));

    expect(assembler.isComplete()).toBe(true);
    expect(assembler.assemble()).toBe("abcdefgh");
  });

  it("assembles chunks added out of order", () => {
    const assembler = createChunkAssembler();
    const chunks = splitIntoChunks("abcdefgh", 3);

    assembler.addChunk(2, chunks.length, chunks[2]);
    assembler.addChunk(0, chunks.length, chunks[0]);
    assembler.addChunk(1, chunks.length, chunks[1]);

    expect(assembler.isComplete()).toBe(true);
    expect(assembler.assemble()).toBe("abcdefgh");
  });

  it("a duplicate chunk for the same index does not affect completeness or output", () => {
    const assembler = createChunkAssembler();
    const chunks = splitIntoChunks("abcdefgh", 3);

    assembler.addChunk(0, chunks.length, chunks[0]);
    assembler.addChunk(0, chunks.length, chunks[0]);
    assembler.addChunk(1, chunks.length, chunks[1]);
    assembler.addChunk(2, chunks.length, chunks[2]);

    expect(assembler.isComplete()).toBe(true);
    expect(assembler.assemble()).toBe("abcdefgh");
  });

  describe("edge cases", () => {
    it("a single-chunk transfer is complete after one add", () => {
      const assembler = createChunkAssembler();
      assembler.addChunk(0, 1, "solo");
      expect(assembler.isComplete()).toBe(true);
      expect(assembler.assemble()).toBe("solo");
    });

    it("is not complete before any chunk arrives", () => {
      const assembler = createChunkAssembler();
      expect(assembler.isComplete()).toBe(false);
    });

    it("is not complete when a chunk in the middle is missing", () => {
      const assembler = createChunkAssembler();
      assembler.addChunk(0, 3, "a");
      assembler.addChunk(2, 3, "c");
      expect(assembler.isComplete()).toBe(false);
    });

    it("is not complete when the last chunk is missing", () => {
      const assembler = createChunkAssembler();
      assembler.addChunk(0, 3, "a");
      assembler.addChunk(1, 3, "b");
      expect(assembler.isComplete()).toBe(false);
    });
  });

  describe("error paths", () => {
    it("assemble throws while incomplete", () => {
      const assembler = createChunkAssembler();
      assembler.addChunk(0, 2, "a");
      expect(() => assembler.assemble()).toThrow(/incomplete|missing/i);
    });

    it("starts a new assembly when a chunk reports a different total", () => {
      const assembler = createChunkAssembler();
      assembler.addChunk(0, 3, "stale-a");
      assembler.addChunk(1, 3, "stale-b");

      assembler.addChunk(0, 2, "fresh-a");
      expect(assembler.isComplete()).toBe(false);
      assembler.addChunk(1, 2, "fresh-b");

      expect(assembler.isComplete()).toBe(true);
      expect(assembler.assemble()).toBe("fresh-afresh-b");
    });

    it("discards everything on reset", () => {
      const assembler = createChunkAssembler();
      assembler.addChunk(0, 2, "a");
      assembler.reset();
      expect(assembler.isComplete()).toBe(false);
      expect(() => assembler.assemble()).toThrow(/incomplete|missing/i);
    });

    it("throws when a chunk's index is out of range for its total", () => {
      const assembler = createChunkAssembler();
      expect(() => assembler.addChunk(3, 3, "x")).toThrow(/index/i);
      expect(() => assembler.addChunk(-1, 3, "x")).toThrow(/index/i);
    });
  });

  describe("invariants", () => {
    it("round-trips arbitrary strings through split and reassemble regardless of arrival order", () => {
      const original = "0123456789".repeat(50);
      const chunks = splitIntoChunks(original, 17);
      const order = chunks.map((_, index) => index).reverse();

      const assembler = createChunkAssembler();
      for (const index of order) assembler.addChunk(index, chunks.length, chunks[index]);

      expect(assembler.assemble()).toBe(original);
    });
  });
});

describe("DEFAULT_CHUNK_CHARS", () => {
  it("is a positive number", () => {
    expect(DEFAULT_CHUNK_CHARS).toBeGreaterThan(0);
  });
});
