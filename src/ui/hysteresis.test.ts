import { LEAVE_DELAY_ABSENT_MS, LEAVE_DELAY_VISIBLE_MS, createMountResolver } from "@/ui/hysteresis";
import type { MountResolver, MountTarget } from "@/ui/hysteresis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Harness {
  state: {
    dockPresent: boolean;
    controlOnDock: boolean;
    controlOnBar: boolean;
    controlVisible: boolean;
  };
  mountCalls: MountTarget[];
  resolver: MountResolver;
}

function createHarness(initial: Partial<Harness["state"]> = {}): Harness {
  const state: Harness["state"] = {
    dockPresent: false,
    controlOnDock: false,
    controlOnBar: false,
    controlVisible: false,
    ...initial,
  };
  const mountCalls: MountTarget[] = [];

  const resolver = createMountResolver({
    isDockPresent: () => state.dockPresent,
    isControlMountedToDock: () => state.controlOnDock,
    isControlMountedToBar: () => state.controlOnBar,
    isControlVisible: () => state.controlVisible,
    mountTo: target => {
      mountCalls.push(target);
      state.controlOnDock = target === "dock";
      state.controlOnBar = target === "bar";
    },
  });

  return { state, mountCalls, resolver };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createMountResolver", () => {
  describe("arrival", () => {
    it("mounts to the dock instantly when it is present", () => {
      const { resolver, mountCalls } = createHarness({ dockPresent: true });
      resolver.resolve();
      expect(mountCalls).toEqual(["dock"]);
      expect(resolver.currentTarget()).toBe("dock");
    });

    it("is idempotent: resolving again while already correctly mounted does nothing", () => {
      const { resolver, mountCalls } = createHarness({ dockPresent: true });
      resolver.resolve();
      resolver.resolve();
      resolver.resolve();
      expect(mountCalls).toEqual(["dock"]);
    });
  });

  describe("restoration", () => {
    it("a deleted button is restored on the very next resolve, with no delay", () => {
      const { state, resolver, mountCalls } = createHarness({ dockPresent: true });
      resolver.resolve();
      expect(mountCalls).toEqual(["dock"]);

      state.controlOnDock = false;
      resolver.resolve();
      expect(mountCalls).toEqual(["dock", "dock"]);
    });
  });

  describe("leaving while visible", () => {
    it("waits the full 2000ms before falling back to the bar", () => {
      const { state, resolver, mountCalls } = createHarness({ dockPresent: true });
      resolver.resolve();
      state.dockPresent = false;
      state.controlVisible = true;

      resolver.resolve();
      expect(mountCalls).toEqual(["dock"]);

      vi.advanceTimersByTime(LEAVE_DELAY_VISIBLE_MS - 1);
      expect(mountCalls).toEqual(["dock"]);

      vi.advanceTimersByTime(1);
      expect(mountCalls).toEqual(["dock", "bar"]);
    });
  });

  describe("leaving while absent", () => {
    it("falls back to the bar after the shorter 250ms delay once the control is off screen", () => {
      const { state, resolver, mountCalls } = createHarness({ dockPresent: true });
      resolver.resolve();
      state.dockPresent = false;
      state.controlVisible = false;

      resolver.resolve();
      vi.advanceTimersByTime(LEAVE_DELAY_ABSENT_MS - 1);
      expect(mountCalls).toEqual(["dock"]);

      vi.advanceTimersByTime(1);
      expect(mountCalls).toEqual(["dock", "bar"]);
    });
  });

  describe("regressions", () => {
    it("a 150ms cross-frame re-render does not move the control", () => {
      const { state, resolver, mountCalls } = createHarness({ dockPresent: true });
      resolver.resolve();
      state.dockPresent = false;
      state.controlVisible = false;
      resolver.resolve();

      vi.advanceTimersByTime(150);
      state.dockPresent = true;
      resolver.resolve();

      vi.advanceTimersByTime(1000);
      expect(mountCalls).toEqual(["dock"]);
      expect(resolver.currentTarget()).toBe("dock");
    });

    it("a real removal falls back to the bar once its own delay elapses", () => {
      const { state, resolver, mountCalls } = createHarness({ dockPresent: true });
      resolver.resolve();
      state.dockPresent = false;
      state.controlVisible = false;
      resolver.resolve();

      vi.advanceTimersByTime(LEAVE_DELAY_ABSENT_MS);
      expect(mountCalls).toEqual(["dock", "bar"]);
      expect(resolver.currentTarget()).toBe("bar");
    });
  });

  describe("invariants", () => {
    it("force bypasses the leave delay and resolves to the bar immediately", () => {
      const { state, resolver, mountCalls } = createHarness({ dockPresent: true });
      resolver.resolve();
      state.dockPresent = false;
      resolver.resolve(true);
      expect(mountCalls).toEqual(["dock", "bar"]);
    });

    it("does not start a second leave timer while one is already pending", () => {
      const { state, resolver, mountCalls } = createHarness({ dockPresent: true });
      resolver.resolve();
      state.dockPresent = false;
      state.controlVisible = false;

      resolver.resolve();
      resolver.resolve();
      resolver.resolve();

      vi.advanceTimersByTime(LEAVE_DELAY_ABSENT_MS);
      expect(mountCalls).toEqual(["dock", "bar"]);
    });
  });

  describe("edge cases", () => {
    it("dispose cancels a pending leave timer", () => {
      const { state, resolver, mountCalls } = createHarness({ dockPresent: true });
      resolver.resolve();
      state.dockPresent = false;
      state.controlVisible = false;
      resolver.resolve();

      resolver.dispose();
      vi.advanceTimersByTime(LEAVE_DELAY_VISIBLE_MS + LEAVE_DELAY_ABSENT_MS);
      expect(mountCalls).toEqual(["dock"]);
    });

    it("starts in the bar by default when nothing has resolved yet", () => {
      const { resolver } = createHarness();
      expect(resolver.currentTarget()).toBe("bar");
    });

    it("stays on the bar and does not mount redundantly when the dock never appears", () => {
      const { resolver, mountCalls } = createHarness({ dockPresent: false });
      resolver.resolve();
      resolver.resolve();
      expect(mountCalls).toEqual(["bar"]);
    });
  });
});
