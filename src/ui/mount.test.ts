import { describe, expect, it } from "vitest";
import { needsDockDivider } from "@/ui/mount";

const button = "our-button";
const divider = "our-divider";
const ours = [button, divider];

describe("needsDockDivider", () => {
  it("divides ours from Better Lyrics' own controls", () => {
    expect(needsDockDivider(["translate", "romanize"], ours)).toBe(true);
  });

  it("leaves an empty dock undivided", () => {
    expect(needsDockDivider([], ours)).toBe(false);
  });

  describe("edge cases", () => {
    it("does not count the control itself as something to divide from", () => {
      expect(needsDockDivider([button], ours)).toBe(false);
    });

    it("does not count a divider left over from an earlier mount", () => {
      expect(needsDockDivider([divider, button], ours)).toBe(false);
    });

    it("still divides when ours are already in place among the others", () => {
      expect(needsDockDivider(["translate", divider, button], ours)).toBe(true);
    });
  });
});
