import { DEFAULT_MODEL_BASE_URL, MODEL_FILENAME, getModelUrl } from "@/cache/model-url";
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
    // Behaviour changed deliberately: this used to return null when unset.
    // Plasmo leaves an unresolved "$VAR/*" in host_permissions and Chrome then
    // ignores the malformed entry without a diagnostic, so an unset variable
    // produced a permissionless fetch that failed silently. Falling back to the
    // same host that host_permissions names keeps the two in agreement.
    it("falls back to the default host when the env var is unset", () => {
      delete process.env[ENV_KEY];
      expect(getModelUrl()).toBe(`${DEFAULT_MODEL_BASE_URL}/${MODEL_FILENAME}`);
    });

    it("falls back to the default host for an empty string", () => {
      process.env[ENV_KEY] = "";
      expect(getModelUrl()).toBe(`${DEFAULT_MODEL_BASE_URL}/${MODEL_FILENAME}`);
    });

    it("falls back to the default host for a whitespace-only value", () => {
      process.env[ENV_KEY] = "   ";
      expect(getModelUrl()).toBe(`${DEFAULT_MODEL_BASE_URL}/${MODEL_FILENAME}`);
    });

    it("uses a default host that host_permissions actually grants", () => {
      expect(DEFAULT_MODEL_BASE_URL).toMatch(/^https:\/\//);
      expect(DEFAULT_MODEL_BASE_URL.endsWith("/")).toBe(false);
    });
  });
});
