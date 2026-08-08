import { decideCacheLookup } from "../src/orchestrator/cache-lookup.js";
import { decideSeparationStart } from "../src/orchestrator/separation-gate.js";
import { createRegionAccumulator } from "../src/orchestrator/region-accumulator.js";
import { base64ToBytes, bytesToBase64 } from "../src/relay/base64.js";
import { type ChunkAssembler, createChunkAssembler, splitIntoChunks } from "../src/relay/chunk-transfer.js";
import { computeContentKey, deleteVideoIdAlias, getContentKeyForVideoId, setVideoIdAlias } from "../src/cache/keys.js";
import { hasCachedModel } from "../src/cache/model-cache.js";
import { encodePcmToOpus } from "../src/cache/opus-codec.js";
import { deleteEntries, getStemRecord, putStemRecord } from "../src/cache/stem-store.js";
import type { StemRecord } from "../src/cache/stem-store.js";
import { decodeFileToFloat32 } from "../src/separation/audio-codec.js";

// -- Signal tracing -------------------------------------------------------
// Every stage reports the right frame COUNT even when the samples are all
// zero, so shape-based checks pass while the audio is silent. Amplitude is
// the only thing that catches that.
function stageRms(channel: Float32Array | undefined): string {
  if (!channel || channel.length === 0) return "no-data";
  let sum = 0;
  for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
  return Math.sqrt(sum / channel.length).toExponential(3);
}
import {
  type CaptureChunkMessage,
  type StemChunkMessage,
  type StemName,
  type TrackPipelineOutboundMessage,
  type TrackStage,
  isModelUrlMessage,
} from "./protocol2.js";
import { SeparationHost } from "./separation-host.js";
import { createLogger } from "../src/shared/logger.js";

const logger = createLogger("pipeline");

// -- Offscreen-side track pipeline -------------------------------------------
//
// Owns exactly one job at a time, keyed by videoId: capture chunks -> cache
// lookup (videoId alias, then content key) -> decode -> separate -> encode
// to Opus -> cache -> chunked delivery back to the tab. A message tagged
// with a videoId other than the one currently active is either the start of
// a new job (capture chunks) or stale (everything else), never merged into
// the active job.
//
// Batch only: SeparationHost.process() already emits region events for a
// future progressive-playback path (see src/orchestrator/region-accumulator.ts),
// but nothing here reads a region before the whole track has landed.

const TARGET_CHANNEL_COUNT = 2;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function post(message: TrackPipelineOutboundMessage): void {
  chrome.runtime.sendMessage(message).catch(error => {
    logger.error("failed to send", message.type, error);
  });
}

async function fetchModelUrl(): Promise<string | null> {
  const response: unknown = await chrome.runtime.sendMessage({ type: "blk-get-model-url" });
  return isModelUrlMessage(response) ? response.modelUrl : null;
}

async function sendStemChunks(videoId: string, stem: StemName, blob: Blob): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks = splitIntoChunks(bytesToBase64(bytes));
  for (let index = 0; index < chunks.length; index++) {
    const message: StemChunkMessage = {
      type: "blk-stem-chunk",
      videoId,
      stem,
      index,
      total: chunks.length,
      data: chunks[index],
    };
    try {
      await chrome.runtime.sendMessage(message);
    } catch (error) {
      // Propagated, not swallowed: a dropped chunk leaves the receiving
      // assembler permanently incomplete, and blk-track-done would still
      // follow if this were ignored, so the pipeline would hang forever
      // with no visible error instead of surfacing one here.
      logger.error("failed to send stem chunk", stem, index, error);
      throw error instanceof Error ? error : new Error(toErrorMessage(error));
    }
  }
}

interface DecodedTrack {
  channels: Float32Array[];
  sampleRate: number;
  numFrames: number;
}

class TrackPipeline {
  private activeVideoId: string | null = null;
  private runningVideoId: string | null = null;
  private captureAssembler: ChunkAssembler | null = null;
  private captureMimeType = "";

  // The SeparationHost is owned by the caller (one Worker for the whole
  // offscreen document's lifetime, shared with the existing cancel-command
  // handler in workers/offscreen.ts), not created here. getCacheBudgetBytes
  // is likewise owned by the caller: workers/offscreen.ts keeps the live
  // value of the cacheBudgetBytes setting in memory and hands it over here on
  // every put, so a budget change applies to the very next write without this
  // class needing to know anything about chrome.storage.
  constructor(
    private separationHost: SeparationHost,
    private getCacheBudgetBytes: () => number
  ) {}

  private isStale(videoId: string): boolean {
    return videoId !== this.activeVideoId;
  }

  private sendStage(videoId: string, stage: TrackStage): void {
    if (this.isStale(videoId)) return;
    post({ type: "blk-track-stage", videoId, stage });
  }

  private sendError(videoId: string, code: string, message: string): void {
    post({ type: "blk-track-error", videoId, code, message });
  }

  handleCaptureChunk(message: CaptureChunkMessage): void {
    if (message.videoId !== this.activeVideoId) {
      this.separationHost.cancel();
      this.activeVideoId = message.videoId;
      this.captureAssembler = null;
      this.captureMimeType = "";
    }
    if (!this.captureAssembler) {
      this.captureAssembler = createChunkAssembler();
      this.captureMimeType = message.mimeType;
    }

    try {
      this.captureAssembler.addChunk(message.index, message.total, message.data);
    } catch (error) {
      this.sendError(message.videoId, "chunk-transfer-failed", toErrorMessage(error));
      return;
    }

    if (!this.captureAssembler.isComplete()) return;

    const base64 = this.captureAssembler.assemble();
    const mimeType = this.captureMimeType;
    this.captureAssembler = null;
    this.captureMimeType = "";

    const decision = decideSeparationStart(this.runningVideoId, message.videoId);
    if (decision === "ignore") {
      logger.log(`already separating ${message.videoId}, ignoring a second capture of it`);
      return;
    }
    if (decision === "supersede") this.separationHost.cancel();

    this.runningVideoId = message.videoId;
    this.run(message.videoId, mimeType, base64ToBytes(base64))
      .catch(error => {
        if (isAbortError(error)) return;
        this.sendError(message.videoId, "unknown", toErrorMessage(error));
      })
      .finally(() => {
        if (this.runningVideoId === message.videoId) this.runningVideoId = null;
      });
  }

  // Called for an explicit cancel command (track change while a job is in
  // flight), not just a superseding capture chunk. Clearing activeVideoId
  // here, not only in handleCaptureChunk, is what makes every isStale()
  // check downstream see the cancellation immediately, even mid-decode
  // where SeparationHost.cancel() alone has nothing to abort.
  // Answers "are there already stems for this videoId" without needing the
  // audio. The alias lookup is keyed by videoId alone, so it costs one
  // Drops a track's stems and its alias, so the next probe misses and the track
  // is acquired again.
  async forgetTrack(videoId: string): Promise<void> {
    const contentKey = await getContentKeyForVideoId(videoId);
    await deleteVideoIdAlias(videoId);
    if (contentKey) await deleteEntries([contentKey]);
    logger.log(`forgot ${videoId}${contentKey ? ` and its stems under ${contentKey.slice(0, 12)}` : ""}`);
  }

  // IndexedDB read and can run the moment a track starts, long before any
  // capture exists. Returns true when stems were delivered.
  async probeCache(videoId: string): Promise<boolean> {
    this.activeVideoId = videoId;

    // Every path out of here answers, so the tab can start acquiring the moment
    // the lookup comes back empty instead of guessing at how long it will take.
    const miss = (): boolean => {
      if (!this.isStale(videoId)) post({ type: "blk-cache-miss", videoId });
      return false;
    };

    const contentKey = await getContentKeyForVideoId(videoId);
    if (!contentKey) return miss();
    if (this.isStale(videoId)) return false;

    const record = await getStemRecord(contentKey);
    if (!record) return miss();
    if (this.isStale(videoId)) return false;
    if (decideCacheLookup(record, null) !== "alias-hit") return miss();

    // Before the stems, not after: the tab is waiting on a capture that is
    // never going to be needed, and only this moves it over to taking delivery.
    post({ type: "blk-cache-hit", videoId });
    this.sendStage(videoId, "checking-cache");
    await this.deliver(videoId, record);
    return true;
  }

  cancelActive(): void {
    this.separationHost.cancel();
    this.activeVideoId = null;
    this.runningVideoId = null;
    this.captureAssembler = null;
    this.captureMimeType = "";
  }

  private async run(videoId: string, mimeType: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    this.sendStage(videoId, "checking-cache");
    const aliasContentKey = await getContentKeyForVideoId(videoId);
    if (this.isStale(videoId)) return;

    const aliasRecord = aliasContentKey ? await getStemRecord(aliasContentKey) : null;
    if (this.isStale(videoId)) return;

    if (aliasRecord && decideCacheLookup(aliasRecord, null) === "alias-hit") {
      await this.deliver(videoId, aliasRecord);
      return;
    }

    this.sendStage(videoId, "decoding");
    const decoded = await decodeFileToFloat32(new Blob([bytes], { type: mimeType }));
    logger.log(
      `decoded input: frames=${decoded.numFrames}, rate=${decoded.sampleRate}, rms=${stageRms(decoded.channels[0])}`
    );
    if (this.isStale(videoId)) return;

    if (decoded.channels.length !== TARGET_CHANNEL_COUNT) {
      this.sendError(
        videoId,
        "decode-failed",
        `Expected ${TARGET_CHANNEL_COUNT} decoded channels, got ${decoded.channels.length}.`
      );
      return;
    }

    const contentKey = await computeContentKey(bytes);
    if (this.isStale(videoId)) return;

    const contentRecord = await getStemRecord(contentKey);
    if (this.isStale(videoId)) return;

    if (contentRecord && decideCacheLookup(aliasRecord, contentRecord) === "content-hit") {
      await setVideoIdAlias(videoId, contentKey);
      if (this.isStale(videoId)) return;
      await this.deliver(videoId, contentRecord);
      return;
    }

    await this.separate(videoId, contentKey, decoded);
  }

  private async separate(videoId: string, contentKey: string, decoded: DecodedTrack): Promise<void> {
    const modelUrl = await fetchModelUrl();
    if (this.isStale(videoId)) return;
    if (!modelUrl) {
      this.sendError(videoId, "no-base-url", "No separation model URL is configured.");
      return;
    }

    this.sendStage(videoId, (await hasCachedModel(modelUrl)) ? "loading-model" : "downloading-model");

    await this.separationHost.init({ modelUrl });
    if (this.isStale(videoId)) return;

    this.sendStage(videoId, "separating");
    const accumulator = createRegionAccumulator(decoded.numFrames, decoded.channels.length);
    let loggedRegions = 0;

    await this.separationHost.process({
      channels: decoded.channels,
      totalFrames: decoded.numFrames,
      onProgress: (processed, total) => {
        if (this.isStale(videoId)) return;
        post({ type: "blk-track-progress", videoId, processed, total });
      },
      onRegion: region => {
        if (loggedRegions < 3) {
          loggedRegions++;
          logger.log(
            `region @${region.regionStart}: vocals=${stageRms(region.vocals[0])}, instrumental=${stageRms(
              region.instrumental[0]
            )}, frames=${region.vocals[0]?.length ?? 0}`
          );
        }
        accumulator.addRegion(region.regionStart, region.vocals, region.instrumental);
      },
    });
    if (this.isStale(videoId)) return;

    this.sendStage(videoId, "encoding");
    logger.log(
      `accumulated: vocals=${stageRms(accumulator.vocals[0])}, instrumental=${stageRms(accumulator.instrumental[0])}`
    );
    const [vocalsBlob, instrumentalBlob] = await Promise.all([
      encodePcmToOpus(accumulator.vocals, decoded.sampleRate),
      encodePcmToOpus(accumulator.instrumental, decoded.sampleRate),
    ]);
    if (this.isStale(videoId)) return;

    await putStemRecord(
      contentKey,
      {
        vocals: vocalsBlob,
        instrumental: instrumentalBlob,
        framesDone: decoded.numFrames,
        totalFrames: decoded.numFrames,
      },
      this.getCacheBudgetBytes()
    );
    await setVideoIdAlias(videoId, contentKey);
    if (this.isStale(videoId)) return;

    await this.deliverBlobs(videoId, vocalsBlob, instrumentalBlob);
  }

  private async deliver(videoId: string, record: Pick<StemRecord, "vocals" | "instrumental">): Promise<void> {
    await this.deliverBlobs(videoId, record.vocals, record.instrumental);
  }

  private async deliverBlobs(videoId: string, vocals: Blob, instrumental: Blob): Promise<void> {
    await sendStemChunks(videoId, "vocals", vocals);
    if (this.isStale(videoId)) return;
    await sendStemChunks(videoId, "instrumental", instrumental);
    if (this.isStale(videoId)) return;
    post({ type: "blk-track-done", videoId });
  }
}

export { TrackPipeline, fetchModelUrl };
