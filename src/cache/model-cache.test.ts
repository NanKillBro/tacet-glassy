import "fake-indexeddb/auto";
import { MODEL_STORE_NAME, openDB } from "@/cache/idb";
import {
  clearCachedModel,
  fetchAndCacheModel,
  getCachedModelSize,
  hasCachedModel,
  readCachedModel,
} from "@/cache/model-cache";
import { sha256Hex } from "@/cache/model-digest";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// -- Test helpers -----------------------------------------------------------------

const MODEL_URL = "https://models.example.com/htdemucs_fp16.onnx";

function makeBytes(length: number, fillByte = 7): Uint8Array<ArrayBuffer> {
  return new Uint8Array(length).fill(fillByte);
}

function streamingResponse(bytes: Uint8Array, chunkSize: number, withContentLength = true): Response {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index]);
      index++;
    },
  });
  const headers = new Headers();
  if (withContentLength) headers.set("content-length", String(bytes.length));
  return new Response(body, { status: 200, statusText: "OK", headers });
}

async function putRaw(url: string, value: unknown): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MODEL_STORE_NAME, "readwrite");
    tx.objectStore(MODEL_STORE_NAME).put(value, url);
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

afterEach(() => {
  vi.unstubAllGlobals();
});

// -- hasCachedModel / readCachedModel -----------------------------------------------------------------

describe("hasCachedModel / readCachedModel", () => {
  it("reports absent for a model never fetched", async () => {
    expect(await hasCachedModel(MODEL_URL)).toBe(false);
    expect(await readCachedModel(MODEL_URL)).toBeNull();
  });

  it("reports present after fetchAndCacheModel stores it", async () => {
    const bytes = makeBytes(1000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamingResponse(bytes, 200))
    );

    await fetchAndCacheModel(MODEL_URL, new AbortController().signal, () => {}, await sha256Hex(bytes));

    expect(await hasCachedModel(MODEL_URL)).toBe(true);
    const cached = await readCachedModel(MODEL_URL);
    expect(cached).not.toBeNull();
    expect(new Uint8Array(cached as ArrayBuffer)).toEqual(bytes);
  });

  it("reads a corrupt cache entry as absent rather than crashing", async () => {
    await putRaw(MODEL_URL, { garbage: true });
    expect(await hasCachedModel(MODEL_URL)).toBe(false);
    expect(await readCachedModel(MODEL_URL)).toBeNull();
  });
});

// -- fetchAndCacheModel -----------------------------------------------------------------

describe("fetchAndCacheModel", () => {
  it("reports progress as chunks arrive, ending at the full byte count", async () => {
    const bytes = makeBytes(1000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamingResponse(bytes, 250))
    );

    const progressCalls: Array<[number, number]> = [];
    const result = await fetchAndCacheModel(
      MODEL_URL,
      new AbortController().signal,
      (loaded, total) => {
        progressCalls.push([loaded, total]);
      },
      await sha256Hex(bytes)
    );

    expect(new Uint8Array(result)).toEqual(bytes);
    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls.every(([, total]) => total === 1000)).toBe(true);
    expect(progressCalls.at(-1)?.[0]).toBe(1000);
  });

  it("falls back to a full-buffer read when the response has no reader", async () => {
    const bytes = makeBytes(500);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const response = new Response(bytes.buffer, { status: 200 });
        Object.defineProperty(response, "body", { value: null });
        return response;
      })
    );

    const result = await fetchAndCacheModel(MODEL_URL, new AbortController().signal, () => {}, await sha256Hex(bytes));
    expect(new Uint8Array(result)).toEqual(bytes);
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404, statusText: "Not Found" }))
    );

    await expect(fetchAndCacheModel(MODEL_URL, new AbortController().signal, () => {}, "unused")).rejects.toThrow(
      /404/
    );
  });

  it("aborts mid-download when the signal fires", async () => {
    const bytes = makeBytes(1000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamingResponse(bytes, 100))
    );

    const controller = new AbortController();
    let calls = 0;
    const promise = fetchAndCacheModel(
      MODEL_URL,
      controller.signal,
      () => {
        calls++;
        if (calls === 2) controller.abort();
      },
      await sha256Hex(bytes)
    );

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(await hasCachedModel(MODEL_URL)).toBe(false);
  });

  it("falls back to the approximate byte count when content-length is missing", async () => {
    const bytes = makeBytes(300);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamingResponse(bytes, 100, false))
    );

    const progressCalls: Array<[number, number]> = [];
    await fetchAndCacheModel(
      MODEL_URL,
      new AbortController().signal,
      (loaded, total) => {
        progressCalls.push([loaded, total]);
      },
      await sha256Hex(bytes)
    );

    expect(progressCalls.every(([, total]) => total > 0)).toBe(true);
  });

  it("overwrites a previous cache entry for the same url", async () => {
    const first = makeBytes(100, 1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamingResponse(first, 50))
    );
    await fetchAndCacheModel(MODEL_URL, new AbortController().signal, () => {}, await sha256Hex(first));

    const second = makeBytes(200, 2);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamingResponse(second, 50))
    );
    await fetchAndCacheModel(MODEL_URL, new AbortController().signal, () => {}, await sha256Hex(second));

    const cached = await readCachedModel(MODEL_URL);
    expect(new Uint8Array(cached as ArrayBuffer)).toEqual(second);
  });
});

// -- edge cases -----------------------------------------------------------------

describe("edge cases", () => {
  it("caches a zero-byte model without error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamingResponse(new Uint8Array(0), 100))
    );

    const result = await fetchAndCacheModel(
      MODEL_URL,
      new AbortController().signal,
      () => {},
      await sha256Hex(new Uint8Array(0))
    );
    expect(result.byteLength).toBe(0);
    expect(await hasCachedModel(MODEL_URL)).toBe(true);
  });

  it("two different urls cache independently", async () => {
    const bytesA = makeBytes(10, 1);
    const bytesB = makeBytes(20, 2);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        input === MODEL_URL ? streamingResponse(bytesA, 5) : streamingResponse(bytesB, 5)
      )
    );

    await fetchAndCacheModel(MODEL_URL, new AbortController().signal, () => {}, await sha256Hex(bytesA));
    await fetchAndCacheModel(
      "https://models.example.com/other.onnx",
      new AbortController().signal,
      () => {},
      await sha256Hex(bytesB)
    );

    expect(new Uint8Array((await readCachedModel(MODEL_URL)) as ArrayBuffer)).toEqual(bytesA);
    expect(new Uint8Array((await readCachedModel("https://models.example.com/other.onnx")) as ArrayBuffer)).toEqual(
      bytesB
    );
  });
});

// -- getCachedModelSize -----------------------------------------------------------------

describe("getCachedModelSize", () => {
  it("returns null for a model never fetched", async () => {
    expect(await getCachedModelSize(MODEL_URL)).toBeNull();
  });

  it("returns the byte size after caching", async () => {
    const bytes = makeBytes(1234);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamingResponse(bytes, 200))
    );
    await fetchAndCacheModel(MODEL_URL, new AbortController().signal, () => {}, await sha256Hex(bytes));
    expect(await getCachedModelSize(MODEL_URL)).toBe(1234);
  });

  it("returns null for a corrupt cache entry", async () => {
    await putRaw(MODEL_URL, { garbage: true });
    expect(await getCachedModelSize(MODEL_URL)).toBeNull();
  });
});

// -- clearCachedModel -----------------------------------------------------------------

describe("clearCachedModel", () => {
  it("removes a cached model", async () => {
    const bytes = makeBytes(100);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamingResponse(bytes, 50))
    );
    await fetchAndCacheModel(MODEL_URL, new AbortController().signal, () => {}, await sha256Hex(bytes));
    expect(await hasCachedModel(MODEL_URL)).toBe(true);

    await clearCachedModel(MODEL_URL);

    expect(await hasCachedModel(MODEL_URL)).toBe(false);
    expect(await getCachedModelSize(MODEL_URL)).toBeNull();
  });

  it("is a no-op for a url that was never cached", async () => {
    await expect(clearCachedModel(MODEL_URL)).resolves.toBeUndefined();
  });

  it("clearing one url leaves another untouched", async () => {
    const bytesA = makeBytes(10, 1);
    const bytesB = makeBytes(20, 2);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        input === MODEL_URL ? streamingResponse(bytesA, 5) : streamingResponse(bytesB, 5)
      )
    );
    await fetchAndCacheModel(MODEL_URL, new AbortController().signal, () => {}, await sha256Hex(bytesA));
    await fetchAndCacheModel(
      "https://models.example.com/other.onnx",
      new AbortController().signal,
      () => {},
      await sha256Hex(bytesB)
    );

    await clearCachedModel(MODEL_URL);

    expect(await hasCachedModel(MODEL_URL)).toBe(false);
    expect(await hasCachedModel("https://models.example.com/other.onnx")).toBe(true);
  });
});

describe("digest verification", () => {
  it("refuses bytes that do not hash to the expected digest", async () => {
    const bytes = makeBytes(1000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamingResponse(bytes, 200))
    );

    await expect(
      fetchAndCacheModel(MODEL_URL, new AbortController().signal, () => {}, await sha256Hex(makeBytes(999)))
    ).rejects.toThrow(/hashed to/);
    expect(await hasCachedModel(MODEL_URL)).toBe(false);
  });

  it("regression: refuses a truncated download rather than caching it", async () => {
    const whole = makeBytes(1000);
    const truncated = whole.subarray(0, 600);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamingResponse(truncated, 200))
    );

    await expect(
      fetchAndCacheModel(MODEL_URL, new AbortController().signal, () => {}, await sha256Hex(whole))
    ).rejects.toThrow(/hashed to/);
    expect(await hasCachedModel(MODEL_URL)).toBe(false);
  });
});
