import { describe, expect, it } from "vitest";
import {
  dockCouplingCardClosed,
  dockCouplingCardOpened,
  dockCouplingShouldCloseCard,
  initialDockCouplingState,
} from "@/ui/fader-dock-coupling";

describe("initialDockCouplingState", () => {
  it("starts believing it did not expand the dock", () => {
    expect(initialDockCouplingState()).toEqual({ weExpandedDock: false });
  });
});

describe("dockCouplingCardOpened", () => {
  it("adds the expanded class when the dock is not already expanded", () => {
    const result = dockCouplingCardOpened(false);
    expect(result.addExpandedClass).toBe(true);
    expect(result.state.weExpandedDock).toBe(true);
  });

  it("does not add the class, and does not claim credit, when the dock is already expanded", () => {
    const result = dockCouplingCardOpened(true);
    expect(result.addExpandedClass).toBe(false);
    expect(result.state.weExpandedDock).toBe(false);
  });
});

describe("dockCouplingCardClosed", () => {
  it("removes the class it added", () => {
    const opened = dockCouplingCardOpened(false);
    const closed = dockCouplingCardClosed(opened.state);
    expect(closed.removeExpandedClass).toBe(true);
    expect(closed.state).toEqual(initialDockCouplingState());
  });

  describe("edge cases", () => {
    it("is a no-op on a state that never expanded anything", () => {
      const closed = dockCouplingCardClosed(initialDockCouplingState());
      expect(closed.removeExpandedClass).toBe(false);
      expect(closed.state).toEqual(initialDockCouplingState());
    });
  });

  describe("regressions", () => {
    it("closing the card does not condense a dock the user is still hovering", () => {
      const opened = dockCouplingCardOpened(true);
      const closed = dockCouplingCardClosed(opened.state);
      expect(closed.removeExpandedClass).toBe(false);
    });
  });
});

describe("dockCouplingShouldCloseCard", () => {
  it("closes the card once the dock loses its expanded class", () => {
    expect(dockCouplingShouldCloseCard(true, false)).toBe(true);
  });

  describe("edge cases", () => {
    it("leaves an open card alone while the dock is still expanded", () => {
      expect(dockCouplingShouldCloseCard(true, true)).toBe(false);
    });

    it("does nothing for a card that was never open", () => {
      expect(dockCouplingShouldCloseCard(false, false)).toBe(false);
    });

    it("does nothing for a closed card even if the dock is not expanded", () => {
      expect(dockCouplingShouldCloseCard(false, true)).toBe(false);
    });
  });
});

describe("invariants", () => {
  it("a full open/close cycle returns to the initial state", () => {
    const opened = dockCouplingCardOpened(false);
    const closed = dockCouplingCardClosed(opened.state);
    expect(closed.state).toEqual(initialDockCouplingState());
  });

  it("opening while already expanded then closing never touches the class", () => {
    const opened = dockCouplingCardOpened(true);
    expect(opened.addExpandedClass).toBe(false);
    const closed = dockCouplingCardClosed(opened.state);
    expect(closed.removeExpandedClass).toBe(false);
  });
});

describe("pointer on the card", () => {
  it("keeps the card open while the pointer is on it", () => {
    expect(dockCouplingShouldCloseCard(true, false, true)).toBe(false);
  });

  it("closes once the pointer has left the card and the dock is collapsed", () => {
    expect(dockCouplingShouldCloseCard(true, false, false)).toBe(true);
  });

  it("defaults to the old behaviour when the caller does not track the pointer", () => {
    expect(dockCouplingShouldCloseCard(true, false)).toBe(true);
  });

  describe("invariants", () => {
    it("never closes a card that is not open", () => {
      for (const expanded of [true, false]) {
        for (const onCard of [true, false]) {
          expect(dockCouplingShouldCloseCard(false, expanded, onCard)).toBe(false);
        }
      }
    });

    it("never closes while the dock is expanded, pointer or not", () => {
      for (const onCard of [true, false]) {
        expect(dockCouplingShouldCloseCard(true, true, onCard)).toBe(false);
      }
    });
  });
});
