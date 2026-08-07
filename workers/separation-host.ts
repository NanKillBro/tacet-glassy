import { fetchAndCacheModel, readCachedModel } from "../src/cache/model-cache.js";
import {
  type SeparateInitCommand,
  type SeparateProcessCommand,
  isSeparateCancelledMessage,
  isSeparateDoneMessage,
  isSeparateErrorMessage,
  isSeparateInitDoneMessage,
  isSeparateProgressMessage,
  isSeparateRegionMessage,
} from "./protocol.js";

// Offscreen-document-side host, analogous to composer's worker-host.ts
// SeparationWorker. It owns the model fetch (host_permissions apply to the
// offscreen document, not the Worker) and the Worker's lifecycle; the Worker
// itself only ever sees an already-fetched modelBytes ArrayBuffer and an
// absolute ortBaseUrl.

interface RegionEvent {
  vocals: Float32Array[];
  instrumental: Float32Array[];
  regionStart: number;
  totalFrames: number;
}

interface InitOptions {
  modelUrl: string;
  forceWasm?: boolean;
  onDownloadProgress?: (loaded: number, total: number) => void;
}

interface ProcessOptions {
  channels: Float32Array[];
  totalFrames: number;
  onProgress?: (processed: number, total: number) => void;
  onRegion?: (region: RegionEvent) => void;
}

const SEPARATOR_WORKER_URL = "assets/workers/separator.js";
const ORT_BASE_PATH = "assets/ort/";

class SeparationHost {
  private worker: Worker | null = null;
  private downloadAbortController: AbortController | null = null;
  private currentResolve: (() => void) | null = null;
  private currentReject: ((error: Error) => void) | null = null;
  private currentProgress: ((processed: number, total: number) => void) | null = null;
  private currentRegion: ((region: RegionEvent) => void) | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(chrome.runtime.getURL(SEPARATOR_WORKER_URL), { type: "module" });
      this.worker.addEventListener("message", event => this.onMessage(event.data));
    }
    return this.worker;
  }

  private onMessage(data: unknown): void {
    if (isSeparateProgressMessage(data)) {
      this.currentProgress?.(data.processed, data.total);
      return;
    }
    if (isSeparateRegionMessage(data)) {
      this.currentRegion?.({
        vocals: data.vocals,
        instrumental: data.instrumental,
        regionStart: data.regionStart,
        totalFrames: data.totalFrames,
      });
      return;
    }
    if (isSeparateInitDoneMessage(data) || isSeparateDoneMessage(data)) {
      this.currentResolve?.();
      this.clearCurrent();
      return;
    }
    if (isSeparateCancelledMessage(data)) {
      this.currentReject?.(new DOMException("Cancelled", "AbortError"));
      this.clearCurrent();
      return;
    }
    if (isSeparateErrorMessage(data)) {
      const error = new Error(data.message) as Error & { code?: string };
      error.code = data.code;
      this.currentReject?.(error);
      this.clearCurrent();
    }
  }

  private clearCurrent(): void {
    this.currentResolve = null;
    this.currentReject = null;
    this.currentProgress = null;
    this.currentRegion = null;
  }

  private post(
    message: SeparateInitCommand | SeparateProcessCommand | { type: "separate-cancel" },
    transfer?: Transferable[]
  ): void {
    this.ensureWorker().postMessage(message, transfer ?? []);
  }

  async init(opts: InitOptions): Promise<void> {
    const cached = await readCachedModel(opts.modelUrl);
    let modelBytes: ArrayBuffer;
    if (cached) {
      modelBytes = cached;
      opts.onDownloadProgress?.(cached.byteLength, cached.byteLength);
    } else {
      this.downloadAbortController = new AbortController();
      try {
        modelBytes = await fetchAndCacheModel(
          opts.modelUrl,
          this.downloadAbortController.signal,
          opts.onDownloadProgress ?? (() => {})
        );
      } finally {
        this.downloadAbortController = null;
      }
    }

    await new Promise<void>((resolve, reject) => {
      this.currentResolve = resolve;
      this.currentReject = reject;
      const ortBaseUrl = chrome.runtime.getURL(ORT_BASE_PATH);
      this.post({ type: "separate-init", ortBaseUrl, modelBytes, forceWasm: opts.forceWasm }, [modelBytes]);
    });
  }

  async process(opts: ProcessOptions): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.currentResolve = resolve;
      this.currentReject = reject;
      this.currentProgress = opts.onProgress ?? null;
      this.currentRegion = opts.onRegion ?? null;

      // Copy each channel into a fresh buffer before transferring. Transferring
      // the caller's original buffers would detach them (length -> 0), which
      // breaks anything else the caller wanted to do with that audio.
      const copies = opts.channels.map(channel => new Float32Array(channel));
      const transfer = copies.map(channel => channel.buffer);
      this.post({ type: "separate-process", channels: copies, totalFrames: opts.totalFrames }, transfer);
    });
  }

  cancel(): void {
    this.downloadAbortController?.abort();
    if (!this.worker) return;
    this.post({ type: "separate-cancel" });
  }

  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.clearCurrent();
  }
}

export { SeparationHost };
export type { InitOptions, ProcessOptions, RegionEvent };
