import { describe, expect, it } from "vitest";
import { installForcedSilence } from "@/capture/silence-frame";

function createMediaPrototype(): { prototype: object; create: () => Record<string, unknown> } {
  const state = new WeakMap<object, { muted: boolean; volume: number; playCount: number }>();
  const prototype = {
    play(this: object): Promise<void> {
      const own = state.get(this);
      if (own) own.playCount += 1;
      return Promise.resolve();
    },
  };
  Object.defineProperty(prototype, "muted", {
    configurable: true,
    get(this: object): boolean {
      return state.get(this)?.muted ?? false;
    },
    set(this: object, value: boolean): void {
      const own = state.get(this);
      if (own) own.muted = value;
    },
  });
  Object.defineProperty(prototype, "volume", {
    configurable: true,
    get(this: object): number {
      return state.get(this)?.volume ?? 1;
    },
    set(this: object, value: number): void {
      const own = state.get(this);
      if (own) own.volume = value;
    },
  });

  return {
    prototype,
    create() {
      const element = Object.create(prototype) as Record<string, unknown>;
      state.set(element, { muted: false, volume: 1, playCount: 0 });
      return element;
    },
  };
}

function actuallySilent(element: Record<string, unknown>): boolean {
  return element.muted === true && element.volume === 0;
}

describe("installForcedSilence", () => {
  it("reports success when the prototype exposes real setters", () => {
    const { prototype } = createMediaPrototype();
    expect(installForcedSilence(prototype)).toBe(true);
  });

  it("silences an element the moment play is called", () => {
    const { prototype, create } = createMediaPrototype();
    installForcedSilence(prototype);

    const element = create();
    void (element.play as () => Promise<void>)();

    expect(actuallySilent(element)).toBe(true);
  });

  it("forces a write back to silent instead of honouring it", () => {
    const { prototype, create } = createMediaPrototype();
    installForcedSilence(prototype);

    const element = create();
    element.muted = false;
    element.volume = 1;

    expect(element.muted).toBe(true);
    expect(element.volume).toBe(0);
  });

  it("keeps forcing silence however many times the player tries", () => {
    const { prototype, create } = createMediaPrototype();
    installForcedSilence(prototype);

    const element = create();
    for (let attempt = 0; attempt < 5; attempt++) {
      element.muted = false;
      element.volume = 0.8;
    }

    expect(element.muted).toBe(true);
    expect(element.volume).toBe(0);
  });

  it("still lets playback start", async () => {
    const { prototype, create } = createMediaPrototype();
    installForcedSilence(prototype);

    const element = create();
    await expect((element.play as () => Promise<void>)()).resolves.toBeUndefined();
  });

  describe("edge cases", () => {
    it("refuses rather than faking it when there are no setters to call", () => {
      const readOnly = {};
      Object.defineProperty(readOnly, "muted", { configurable: true, get: () => false });
      Object.defineProperty(readOnly, "volume", { configurable: true, get: () => 1 });

      expect(installForcedSilence(readOnly)).toBe(false);
      expect((readOnly as { muted: boolean }).muted).toBe(false);
    });

    it("refuses on a prototype with no media accessors at all", () => {
      expect(installForcedSilence({})).toBe(false);
    });

    it("survives being installed twice", () => {
      const { prototype, create } = createMediaPrototype();
      installForcedSilence(prototype);
      installForcedSilence(prototype);

      const element = create();
      element.muted = false;

      expect(element.muted).toBe(true);
      expect(element.volume).toBe(0);
    });
  });

  describe("invariants", () => {
    it("silences every element, not just the first", () => {
      const { prototype, create } = createMediaPrototype();
      installForcedSilence(prototype);

      for (let index = 0; index < 3; index++) {
        const element = create();
        void (element.play as () => Promise<void>)();
        expect(actuallySilent(element)).toBe(true);
      }
    });
  });
});
