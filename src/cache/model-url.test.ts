import { MODEL_FILENAME, getModelUrl } from "@/cache/model-url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENV_KEY = "PLASMO_PUBLIC_MODEL_BASE_URL";
let original: string | undefined;

beforeEach(() => {
  original = process.env[ENV_KEY];
});

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
});

describe("getModelUrl", () => {
  it("appends the model filename to the configured base url", () => {
    process.env[ENV_KEY] = "https://models.example.com";
    expect(getModelUrl()).toBe(`https://models.example.com/${MODEL_FILENAME}`);
  });

  it("strips a trailing slash from the base url before appending", () => {
    process.env[ENV_KEY] = "https://models.example.com/";
    expect(getModelUrl()).toBe(`https://models.example.com/${MODEL_FILENAME}`);
  });

  it("trims surrounding whitespace", () => {
    process.env[ENV_KEY] = "  https://models.example.com  ";
    expect(getModelUrl()).toBe(`https://models.example.com/${MODEL_FILENAME}`);
  });

  describe("edge cases", () => {
    it("returns null when the env var is unset", () => {
      delete process.env[ENV_KEY];
      expect(getModelUrl()).toBeNull();
    });

    it("returns null for an empty string", () => {
      process.env[ENV_KEY] = "";
      expect(getModelUrl()).toBeNull();
    });

    it("returns null for a whitespace-only value", () => {
      process.env[ENV_KEY] = "   ";
      expect(getModelUrl()).toBeNull();
    });
  });
});
