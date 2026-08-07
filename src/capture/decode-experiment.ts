// Runs the three measurements this spike exists to produce: does capture
// work, does a naive concatenation decode, and if not, does trimming later
// re-initializations to just the first buffer plus media segments decode.
// Needs OfflineAudioContext.decodeAudioData, so it is a browser-only module
// like sourcebuffer-patch.ts; the byte-layout logic it calls into
// (decode-plan.ts) is what carries the tested part.

import type { CaptureAccumulator } from "@/capture/accumulator";
import { concatenateChunks, countInitSegments, planFirstPlusMedia, planNaiveConcat } from "@/capture/decode-plan";
import { LOG_PREFIX, log } from "@/capture/log";

interface CaptureCounters {
  videoId: string | null;
  appendCount: number;
  totalBytes: number;
  mimeTypes: string[];
  retainedChunkCount: number;
  hitCap: boolean;
}

interface DecodeAttempt {
  attempted: boolean;
  success: boolean | null;
  rms?: number | null;
  durationSeconds: number | null;
  channelCount: number | null;
  sampleRate: number | null;
  error: string | null;
  reason: string | null;
}

interface CaptureExperimentResult {
  capture: CaptureCounters;
  videoDurationSeconds: number | null;
  naiveConcat: DecodeAttempt;
  firstPlusMedia: DecodeAttempt;
  multipleInitSegments: boolean;
}

function describeError(error: unknown): string {
  if (error instanceof DOMException) return `${error.name}: ${error.message}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function decodeBytes(
  bytes: Uint8Array
): Promise<{ durationSeconds: number; channelCount: number; sampleRate: number; rms: number }> {
  const context = new OfflineAudioContext(1, 1, 44100);
  const audioBuffer = await context.decodeAudioData(toOwnedArrayBuffer(bytes));
  // Duration alone cannot tell a real decode from a silent one, and a silent
  // decode is exactly what produced empty stems while every stage reported
  // success.
  const first = audioBuffer.getChannelData(0);
  let sumOfSquares = 0;
  for (let i = 0; i < first.length; i++) sumOfSquares += first[i] * first[i];
  const rms = Math.sqrt(sumOfSquares / Math.max(1, first.length));
  return {
    durationSeconds: audioBuffer.duration,
    rms,
    channelCount: audioBuffer.numberOfChannels,
    sampleRate: audioBuffer.sampleRate,
  };
}

async function attemptDecode(bytes: Uint8Array): Promise<DecodeAttempt> {
  try {
    const decoded = await decodeBytes(bytes);
    return {
      attempted: true,
      success: true,
      rms: decoded.rms,
      durationSeconds: decoded.durationSeconds,
      channelCount: decoded.channelCount,
      sampleRate: decoded.sampleRate,
      error: null,
      reason: null,
    };
  } catch (error) {
    return {
      attempted: true,
      success: false,
      durationSeconds: null,
      channelCount: null,
      sampleRate: null,
      error: describeError(error),
      reason: null,
    };
  }
}

function notAttempted(reason: string): DecodeAttempt {
  return {
    attempted: false,
    success: null,
    durationSeconds: null,
    channelCount: null,
    sampleRate: null,
    error: null,
    reason,
  };
}

function describeAttempt(attempt: DecodeAttempt): string {
  if (!attempt.attempted) return `skipped (${attempt.reason})`;
  if (attempt.success) {
    return `success duration=${attempt.durationSeconds}s channels=${attempt.channelCount} sampleRate=${attempt.sampleRate}`;
  }
  return `failed: ${attempt.error}`;
}

async function runCaptureDecodeExperiment(
  accumulator: CaptureAccumulator,
  videoDurationSeconds: number | null
): Promise<CaptureExperimentResult> {
  const stats = accumulator.getStats();
  const chunks = accumulator.getChunks();

  const capture: CaptureCounters = {
    videoId: stats.videoId,
    appendCount: stats.appendCount,
    totalBytes: stats.totalBytes,
    mimeTypes: stats.mimeTypes,
    retainedChunkCount: stats.retainedChunkCount,
    hitCap: stats.hitCap,
  };
  log(
    `capture stats: appendCount=${stats.appendCount} totalBytes=${stats.totalBytes} mimeTypes=${stats.mimeTypes.join(",") || "(none)"}`
  );
  log(`video.duration = ${videoDurationSeconds === null ? "unknown" : `${videoDurationSeconds}s`}`);

  const naiveConcat = await attemptDecode(concatenateChunks(planNaiveConcat(chunks)));
  log(`naive concat decode: ${describeAttempt(naiveConcat)}`);

  const firstPlusMedia = naiveConcat.success
    ? notAttempted("naive concat already succeeded")
    : await attemptDecode(concatenateChunks(planFirstPlusMedia(chunks)));
  log(`first+media decode: ${describeAttempt(firstPlusMedia)}`);

  const multipleInitSegments = countInitSegments(chunks) > 1;
  log(`multiple init segments observed: ${multipleInitSegments}`);

  const result: CaptureExperimentResult = {
    capture,
    videoDurationSeconds,
    naiveConcat,
    firstPlusMedia,
    multipleInitSegments,
  };

  console.log(`${LOG_PREFIX} RESULT ${JSON.stringify(result)}`);
  return result;
}

export { runCaptureDecodeExperiment };
export type { CaptureCounters, CaptureExperimentResult, DecodeAttempt };
