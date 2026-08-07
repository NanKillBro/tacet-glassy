import { createBypassController } from "@/pageworld/bypass";
import { describe, expect, it, vi } from "vitest";

function createHarness() {
  const reconnectDestination = vi.fn();
  const stopStems = vi.fn();
  const controller = createBypassController({ reconnectDestination, stopStems });
  return { controller, reconnectDestination, stopStems };
}

describe("createBypassController", () => {
  it("starts bypassed: the shared source begins connected and untouched", () => {
    const { controller } = createHarness();
    expect(controller.isBypassed()).toBe(true);
  });

  it("entering bypass from an engaged state reconnects the destination and stops stems", () => {
    const { controller, reconnectDestination, stopStems } = createHarness();
    controller.exitBypass();
    expect(controller.isBypassed()).toBe(false);

    controller.enterBypass();
    expect(controller.isBypassed()).toBe(true);
    expect(reconnectDestination).toHaveBeenCalledTimes(1);
    expect(stopStems).toHaveBeenCalledTimes(1);
  });

  it("entering bypass while already bypassed does nothing (no-op, not a fresh reconnect)", () => {
    const { controller, reconnectDestination, stopStems } = createHarness();
    controller.enterBypass();
    expect(reconnectDestination).not.toHaveBeenCalled();
    expect(stopStems).not.toHaveBeenCalled();
  });

  describe("regressions", () => {
    it("bypass is idempotent: calling enterBypass twice in a row only fires the effects once", () => {
      const { controller, reconnectDestination, stopStems } = createHarness();
      controller.exitBypass();
      controller.enterBypass();
      controller.enterBypass();
      controller.enterBypass();
      expect(reconnectDestination).toHaveBeenCalledTimes(1);
      expect(stopStems).toHaveBeenCalledTimes(1);
    });

    it("a watchdog firing after a user-triggered stop does not double-reconnect", () => {
      const { controller, reconnectDestination } = createHarness();
      controller.exitBypass();
      controller.enterBypass(); // user pressed stop
      controller.enterBypass(); // watchdog observed a dead context moments later
      expect(reconnectDestination).toHaveBeenCalledTimes(1);
    });
  });

  describe("invariants", () => {
    it("exitBypass then enterBypass then exitBypass again re-arms the effects for a second cycle", () => {
      const { controller, reconnectDestination, stopStems } = createHarness();
      controller.exitBypass();
      controller.enterBypass();
      controller.exitBypass();
      controller.enterBypass();
      expect(reconnectDestination).toHaveBeenCalledTimes(2);
      expect(stopStems).toHaveBeenCalledTimes(2);
    });

    it("exitBypass alone never calls the side-effect deps", () => {
      const { controller, reconnectDestination, stopStems } = createHarness();
      controller.exitBypass();
      controller.exitBypass();
      expect(reconnectDestination).not.toHaveBeenCalled();
      expect(stopStems).not.toHaveBeenCalled();
    });
  });
});
