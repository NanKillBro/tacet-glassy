import { createTabRegistry } from "@/orchestrator/tab-registry";
import { describe, expect, it } from "vitest";

describe("createTabRegistry", () => {
  it("remembers the tab that asked about a track", () => {
    const registry = createTabRegistry();
    registry.remember("DJCB1ZlseJ8", 7);
    expect(registry.tabsFor("DJCB1ZlseJ8")).toEqual([7]);
  });

  it("knows nothing about a track nobody asked for", () => {
    expect(createTabRegistry().tabsFor("DJCB1ZlseJ8")).toEqual([]);
  });

  describe("regressions", () => {
    it("regression: keeps every tab playing the same track", () => {
      const registry = createTabRegistry();
      registry.remember("DJCB1ZlseJ8", 7);
      registry.remember("DJCB1ZlseJ8", 9);
      expect(registry.tabsFor("DJCB1ZlseJ8").sort()).toEqual([7, 9]);
    });
  });

  describe("edge cases", () => {
    it("counts a tab that asks twice once", () => {
      const registry = createTabRegistry();
      registry.remember("DJCB1ZlseJ8", 7);
      registry.remember("DJCB1ZlseJ8", 7);
      expect(registry.tabsFor("DJCB1ZlseJ8")).toEqual([7]);
    });

    it("keeps tracks apart", () => {
      const registry = createTabRegistry();
      registry.remember("DJCB1ZlseJ8", 7);
      registry.remember("lYBUbBu4W08", 9);
      expect(registry.tabsFor("DJCB1ZlseJ8")).toEqual([7]);
      expect(registry.tabsFor("lYBUbBu4W08")).toEqual([9]);
    });

    it("forgets a track once its job is done", () => {
      const registry = createTabRegistry();
      registry.remember("DJCB1ZlseJ8", 7);
      registry.forgetVideo("DJCB1ZlseJ8");
      expect(registry.tabsFor("DJCB1ZlseJ8")).toEqual([]);
      expect(registry.videoCount()).toBe(0);
    });

    it("drops a closed tab from every track it was on", () => {
      const registry = createTabRegistry();
      registry.remember("DJCB1ZlseJ8", 7);
      registry.remember("lYBUbBu4W08", 7);
      registry.remember("lYBUbBu4W08", 9);
      registry.forgetTab(7);
      expect(registry.tabsFor("DJCB1ZlseJ8")).toEqual([]);
      expect(registry.tabsFor("lYBUbBu4W08")).toEqual([9]);
    });

    it("shrugs at forgetting things it never knew", () => {
      const registry = createTabRegistry();
      registry.forgetVideo("DJCB1ZlseJ8");
      registry.forgetTab(7);
      expect(registry.videoCount()).toBe(0);
    });
  });

  describe("invariants", () => {
    it("holds no track once its last tab has gone", () => {
      const registry = createTabRegistry();
      registry.remember("DJCB1ZlseJ8", 7);
      registry.remember("DJCB1ZlseJ8", 9);
      registry.forgetTab(7);
      expect(registry.videoCount()).toBe(1);
      registry.forgetTab(9);
      expect(registry.videoCount()).toBe(0);
    });
  });
});
