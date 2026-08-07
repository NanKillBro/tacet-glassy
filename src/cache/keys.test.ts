import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { ALIASES_STORE_NAME, openDB } from "@/cache/idb";
import { computeContentKey, getContentKeyForVideoId, setVideoIdAlias } from "@/cache/keys";

// -- Test helpers -----------------------------------------------------------------

async function putRawAlias(videoId: string, value: unknown): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ALIASES_STORE_NAME, "readwrite");
    tx.objectStore(ALIASES_STORE_NAME).put(value, videoId);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

// -- computeContentKey -----------------------------------------------------------------

describe("computeContentKey", () => {
  it("matches the known SHA-256 hex digest of empty bytes", async () => {
    const key = await computeContentKey(new Uint8Array(0));
    expect(key).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches the known SHA-256 hex digest of ascii bytes", async () => {
    const bytes = new TextEncoder().encode("foo");
    const key = await computeContentKey(bytes);
    expect(key).toBe("2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae");
  });

  it("accepts a plain ArrayBuffer", async () => {
    const bytes = new TextEncoder().encode("foo");
    const arrayBuffer = new ArrayBuffer(bytes.length);
    new Uint8Array(arrayBuffer).set(bytes);
    const key = await computeContentKey(arrayBuffer);
    expect(key).toBe("2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae");
  });

  describe("invariants", () => {
    it("is deterministic for the same bytes", async () => {
      const bytes = new TextEncoder().encode("same input twice");
      const first = await computeContentKey(bytes);
      const second = await computeContentKey(bytes);
      expect(first).toBe(second);
    });

    it("differs for different bytes", async () => {
      const a = await computeContentKey(new TextEncoder().encode("a"));
      const b = await computeContentKey(new TextEncoder().encode("b"));
      expect(a).not.toBe(b);
    });
  });
});

// -- alias resolution -----------------------------------------------------------------

describe("happy path", () => {
  it("set then get round-trips a videoId alias", async () => {
    await setVideoIdAlias("video-1", "content-hash-1");
    expect(await getContentKeyForVideoId("video-1")).toBe("content-hash-1");
  });

  it("overwriting an alias updates the resolved contentKey", async () => {
    await setVideoIdAlias("video-1", "content-hash-1");
    await setVideoIdAlias("video-1", "content-hash-2");
    expect(await getContentKeyForVideoId("video-1")).toBe("content-hash-2");
  });
});

describe("edge cases", () => {
  it("reading a videoId with no alias returns null", async () => {
    expect(await getContentKeyForVideoId("never-seen")).toBeNull();
  });

  it("two different videoIds can resolve to the same contentKey", async () => {
    await setVideoIdAlias("video-1", "shared-hash");
    await setVideoIdAlias("video-2", "shared-hash");
    expect(await getContentKeyForVideoId("video-1")).toBe("shared-hash");
    expect(await getContentKeyForVideoId("video-2")).toBe("shared-hash");
  });
});

describe("error paths", () => {
  it("reads a corrupt alias entry as absent rather than crashing", async () => {
    await putRawAlias("video-corrupt", { unexpected: 123 });
    await expect(getContentKeyForVideoId("video-corrupt")).resolves.toBeNull();
  });
});
