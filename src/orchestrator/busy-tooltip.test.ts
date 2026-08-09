import { describe, expect, it } from "vitest";
import { describeBusy, describeStage } from "@/orchestrator/busy-tooltip";
import { HIDDEN_PLAYER_LABEL, LISTENER_PLAYBACK_LABEL } from "@/orchestrator/download-tooltip";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import { initialKaraokeState } from "@/orchestrator/karaoke-state";
import { ARMED_LABEL } from "@/ui/armed-affordance";

function stateWith(overrides: Partial<KaraokeState>): KaraokeState {
  return { ...initialKaraokeState("dQw4w9WgXcQ"), ...overrides };
}

describe("describeStage", () => {
  it("names each stage of the run", () => {
    const labels = (["checking-cache", "decoding", "downloading-model", "loading-model", "encoding"] as const).map(
      stage => describeStage(stateWith({ stage })).label
    );
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("reports separation as a fraction of the chunks done", () => {
    expect(describeStage(stateWith({ stage: "separating", processed: 3, total: 12 }))).toEqual({
      label: "Separating vocals…",
      percent: 0.25,
    });
  });

  describe("edge cases", () => {
    it("withholds the percentage before the chunk count is known", () => {
      expect(describeStage(stateWith({ stage: "separating", processed: 0, total: 0 })).percent).toBeNull();
    });

    it("falls back to a generic label for a stage it does not know", () => {
      expect(describeStage(stateWith({ stage: null })).label).toBe("Preparing sing-along…");
      expect(describeStage(stateWith({ stage: "teleporting" })).label).toBe("Preparing sing-along…");
    });
  });
});

describe("describeBusy", () => {
  it("reports the download while the capture is still coming in", () => {
    expect(describeBusy(stateWith({ downloadFraction: 0.5, downloadSource: "hidden-player" }), false)).toEqual({
      label: HIDDEN_PLAYER_LABEL,
      percent: 0.5,
      note: null,
    });
  });

  it("reports the stage once the capture is being separated", () => {
    const state = stateWith({ status: "processing", stage: "separating", processed: 1, total: 4 });
    expect(describeBusy(state, false)).toEqual({ label: "Separating vocals…", percent: 0.25, note: null });
  });

  it("adds the armed note without displacing the stage", () => {
    const state = stateWith({ status: "processing", stage: "separating", processed: 1, total: 4 });
    expect(describeBusy(state, true)).toEqual({
      label: "Separating vocals…",
      percent: 0.25,
      note: ARMED_LABEL,
    });
  });

  describe("regressions", () => {
    it("shows the separation stages even though the download source is still on the state", () => {
      const state = stateWith({
        status: "processing",
        stage: "downloading-model",
        downloadFraction: 1,
        downloadSource: "listener-playback",
      });
      const busy = describeBusy(state, false);
      expect(busy.label).toBe("Downloading the separation model…");
      expect(busy.label).not.toBe(LISTENER_PLAYBACK_LABEL);
    });

    it("never renders the download once the state has left the capture phase", () => {
      const downloadLabels = [HIDDEN_PLAYER_LABEL, LISTENER_PLAYBACK_LABEL];
      for (const status of ["processing", "ready-to-engage", "engaged", "failed"] as const) {
        const state = stateWith({ status, downloadFraction: 0.3, downloadSource: "hidden-player" });
        expect(downloadLabels).not.toContain(describeBusy(state, false).label);
      }
    });
  });

  describe("invariants", () => {
    it("keeps the stage identical whether or not the control is armed", () => {
      for (const stage of ["checking-cache", "decoding", "loading-model", "separating", "encoding", null]) {
        const state = stateWith({ status: "processing", stage, processed: 2, total: 5 });
        const { note: _armedNote, ...armed } = describeBusy(state, true);
        const { note: _restNote, ...idle } = describeBusy(state, false);
        expect(armed).toEqual(idle);
      }
    });

    it("carries a note only when armed", () => {
      const state = stateWith({ status: "waiting-for-capture", downloadSource: "hidden-player" });
      expect(describeBusy(state, true).note).toBe(ARMED_LABEL);
      expect(describeBusy(state, false).note).toBeNull();
    });
  });
});
