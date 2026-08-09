import { sourceBelongsToBus } from "@/pageworld/audio-bus-wiring";
import { describe, expect, it } from "vitest";

const context = { name: "context" };
const element = { name: "element" };
const coherentSource = { context, mediaElement: element };

describe("sourceBelongsToBus", () => {
  it("accepts a bus whose source was created by its context from its element", () => {
    expect(sourceBelongsToBus({ context, source: coherentSource, element })).toBe(true);
  });

  it("rejects a source that belongs to a different context", () => {
    const otherContext = { name: "other-context" };
    const source = { context: otherContext, mediaElement: element };
    expect(sourceBelongsToBus({ context, source, element })).toBe(false);
  });

  it("rejects a source that captured a different element", () => {
    const otherElement = { name: "other-element" };
    const source = { context, mediaElement: otherElement };
    expect(sourceBelongsToBus({ context, source, element })).toBe(false);
  });

  it("rejects a source that matches neither", () => {
    const source = { context: { name: "x" }, mediaElement: { name: "y" } };
    expect(sourceBelongsToBus({ context, source, element })).toBe(false);
  });

  describe("edge cases", () => {
    it("rejects a source that is not an object", () => {
      expect(sourceBelongsToBus({ context, source: null, element })).toBe(false);
      expect(sourceBelongsToBus({ context, source: undefined, element })).toBe(false);
      expect(sourceBelongsToBus({ context, source: "a string", element })).toBe(false);
      expect(sourceBelongsToBus({ context, source: 42, element })).toBe(false);
    });

    it("rejects a source missing the fields entirely", () => {
      expect(sourceBelongsToBus({ context, source: {}, element })).toBe(false);
    });

    it("does not treat two undefined fields as a match", () => {
      expect(sourceBelongsToBus({ context: undefined, source: {}, element: undefined })).toBe(false);
    });

    it("compares by identity, not by structural equality", () => {
      const twin = { name: "context" };
      const source = { context: twin, mediaElement: element };
      expect(sourceBelongsToBus({ context, source, element })).toBe(false);
    });

    it("reads the fields once, so an accessor-backed source cannot pass a check it later fails", () => {
      let reads = 0;
      const source = {
        get context() {
          reads++;
          return reads === 1 ? context : { name: "swapped" };
        },
        mediaElement: element,
      };
      expect(sourceBelongsToBus({ context, source, element })).toBe(true);
      expect(reads).toBe(1);
    });
  });

  describe("invariants", () => {
    it("does not mutate the bus or its source", () => {
      const bus = { context, source: coherentSource, element };
      const snapshot = JSON.stringify(bus);
      sourceBelongsToBus(bus);
      expect(JSON.stringify(bus)).toBe(snapshot);
    });

    it("is a pure predicate: the same input always yields the same answer", () => {
      const bus = { context, source: coherentSource, element };
      expect(sourceBelongsToBus(bus)).toBe(sourceBelongsToBus(bus));
    });
  });
});
