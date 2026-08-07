// -- ISOLATED-world karaoke pipeline orchestrator ----------------------------
//
// Wired into src/contents/fader-control.ts. Owns: polling the current
// videoId, talking to src/contents/capture-spike.ts (MAIN world) for
// captured bytes over window.postMessage, talking to the offscreen document
// over chrome.runtime (relayed through src/background.ts, see
// workers/protocol2.ts), and talking to src/contents/inject-main-world.ts
// (MAIN world) to load decoded stems and set the mix level. The state
// machine that drives all of this (src/orchestrator/karaoke-state.ts) is
// pure and independently tested; this module is the impure glue around it.

import {
  type RequestCapturedAudioMessage,
  isCaptureReadyMessage,
  isCapturedAudioMessage,
  isCapturedAudioUnavailableMessage,
} from "@/capture/bridge-protocol";
import { getVideoIdFromSearch } from "@/capture/video-id";
import { decodeOpusToPcm } from "@/cache/opus-codec";
import { initialKaraokeState, reduceKaraokeState } from "@/orchestrator/karaoke-state";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import type { LoadStemsMessage, SetMixLevelMessage, StopStemsMessage } from "@/pageworld/protocol";
import { base64ToBytes, bytesToBase64 } from "@/relay/base64";
import { type ChunkAssembler, createChunkAssembler, splitIntoChunks } from "@/relay/chunk-transfer";
import type { CancelSeparationCommand, CaptureChunkMessage, StemChunkMessage } from "../../workers/protocol2";
import {
  isStemChunkMessage,
  isTrackDoneMessage,
  isTrackErrorMessage,
  isTrackProgressMessage,
  isTrackStageMessage,
} from "../../workers/protocol2";

const TRACK_POLL_MS = 1000;
const CAPTURE_REQUEST_TIMEOUT_MS = 8000;

// k = 1 is the original mix untouched (see src/pageworld/gain-law.ts).
const NEUTRAL_MIX_LEVEL = 1;

const LOG_PREFIX = "[BLK]";

function log(message: string): void {
  console.log(`${LOG_PREFIX} ${message}`);
}

function logError(message: string, error: unknown): void {
  console.error(`${LOG_PREFIX} ${message}`, error);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface KaraokePipelineOptions {
  onStateChange(state: KaraokeState): void;
}

interface KaraokePipeline {
  engage(mixLevel: number): void;
  destroy(): void;
}

function currentVideoId(): string | null {
  return getVideoIdFromSearch(window.location.search);
}

function createKaraokePipeline(options: KaraokePipelineOptions): KaraokePipeline {
  let state: KaraokeState = initialKaraokeState(currentVideoId() ?? "");
  let pendingMixLevel = NEUTRAL_MIX_LEVEL;
  let vocalsAssembler: ChunkAssembler | null = null;
  let instrumentalAssembler: ChunkAssembler | null = null;
  let doneReceived = false;

  function setState(next: KaraokeState): void {
    if (next === state) return;
    state = next;
    options.onStateChange(state);
  }

  function dispatch(event: Parameters<typeof reduceKaraokeState>[1]): void {
    setState(reduceKaraokeState(state, event));
  }

  function resetStemAssembly(): void {
    vocalsAssembler = null;
    instrumentalAssembler = null;
    doneReceived = false;
  }

  function postToPageWorld(
    message: SetMixLevelMessage | LoadStemsMessage | StopStemsMessage,
    transfer?: Transferable[]
  ): void {
    window.postMessage(message, window.location.origin, transfer);
  }

  // -- Track change polling ----------------------------------------------
  //
  // ISOLATED-world content scripts share the page's real window.location,
  // so no message from MAIN world is needed to notice a track change; see
  // src/capture/video-id.ts for why polling location.search is how this
  // codebase already detects it.

  function checkTrackChange(): void {
    const videoId = currentVideoId();
    if (!videoId || videoId === state.videoId) return;

    log(`track changed ${state.videoId || "(none)"} -> ${videoId}`);

    if (state.status === "processing") {
      const cancel: CancelSeparationCommand = { type: "blk-cancel-separation" };
      chrome.runtime.sendMessage(cancel).catch(error => logError("failed to send cancel", error));
    }
    if (state.status === "processing" || state.status === "engaged") {
      postToPageWorld({ type: "blk-stop-stems" });
    }

    resetStemAssembly();
    dispatch({ type: "track-changed", videoId });
  }

  const pollTimer = setInterval(checkTrackChange, TRACK_POLL_MS);
  checkTrackChange();

  // -- MAIN world: capture-spike.ts ---------------------------------------

  async function sendCapturedAudioChunks(videoId: string, mimeType: string, bytes: ArrayBuffer): Promise<void> {
    const base64 = bytesToBase64(new Uint8Array(bytes));
    const chunks = splitIntoChunks(base64);
    log(`sending captured audio for ${videoId}: ${bytes.byteLength} bytes as ${chunks.length} chunk(s)`);

    for (let index = 0; index < chunks.length; index++) {
      if (videoId !== state.videoId) return; // superseded by a track change mid-send
      const message: CaptureChunkMessage = {
        type: "blk-capture-chunk",
        videoId,
        mimeType,
        index,
        total: chunks.length,
        data: chunks[index],
      };
      await chrome.runtime.sendMessage(message).catch(error => {
        throw error instanceof Error ? error : new Error(describeError(error));
      });
    }
  }

  function onWindowMessage(event: MessageEvent): void {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data: unknown = event.data;

    if (isCaptureReadyMessage(data)) {
      log(`capture ready for ${data.videoId}`);
      dispatch({ type: "capture-ready", videoId: data.videoId });
      return;
    }

    if (isCapturedAudioMessage(data)) {
      sendCapturedAudioChunks(data.videoId, data.mimeType, data.bytes).catch(error => {
        logError("failed to upload captured audio", error);
        dispatch({ type: "failed", videoId: data.videoId, reason: describeError(error) });
      });
      return;
    }

    if (isCapturedAudioUnavailableMessage(data)) {
      log(`captured audio unavailable for ${data.videoId}: ${data.reason}`);
      dispatch({ type: "failed", videoId: data.videoId, reason: data.reason });
    }
  }
  window.addEventListener("message", onWindowMessage);

  // -- chrome.runtime: relayed from the offscreen document ----------------

  function handleStemChunk(message: StemChunkMessage): void {
    if (message.videoId !== state.videoId) return; // stale: superseded by a track change

    if (message.stem === "vocals") {
      vocalsAssembler ??= createChunkAssembler();
      addChunkSafely(vocalsAssembler, message);
    } else {
      instrumentalAssembler ??= createChunkAssembler();
      addChunkSafely(instrumentalAssembler, message);
    }

    finishStemsIfReady(message.videoId);
  }

  function addChunkSafely(assembler: ChunkAssembler, message: StemChunkMessage): void {
    try {
      assembler.addChunk(message.index, message.total, message.data);
    } catch (error) {
      dispatch({ type: "failed", videoId: message.videoId, reason: describeError(error) });
    }
  }

  function decodeStemBlob(assembler: ChunkAssembler): Blob {
    return new Blob([base64ToBytes(assembler.assemble())]);
  }

  function finishStemsIfReady(videoId: string): void {
    if (!doneReceived || !vocalsAssembler?.isComplete() || !instrumentalAssembler?.isComplete()) return;
    if (videoId !== state.videoId || state.status !== "processing") return;

    const vocalsBlob = decodeStemBlob(vocalsAssembler);
    const instrumentalBlob = decodeStemBlob(instrumentalAssembler);
    resetStemAssembly();

    log(`stems received for ${videoId}, decoding`);
    Promise.all([decodeOpusToPcm(vocalsBlob), decodeOpusToPcm(instrumentalBlob)])
      .then(([vocals, instrumental]) => {
        if (videoId !== state.videoId) return;
        log(`stems decoded for ${videoId}, loading into the playback graph`);
        const transfer = [...vocals.channels, ...instrumental.channels].map(channel => channel.buffer);
        const message: LoadStemsMessage = {
          type: "blk-load-stems",
          vocals: vocals.channels,
          instrumental: instrumental.channels,
          sampleRate: vocals.sampleRate,
        };
        postToPageWorld(message, transfer);
        dispatch({ type: "stems-loaded", videoId });
        postToPageWorld({ type: "blk-set-mix-level", mixLevel: pendingMixLevel });
        log(`karaoke engaged for ${videoId}`);
      })
      .catch(error => {
        logError("failed to decode stems", error);
        dispatch({ type: "failed", videoId, reason: describeError(error) });
      });
  }

  function onRuntimeMessage(message: unknown): void {
    if (isTrackStageMessage(message)) {
      log(`stage for ${message.videoId}: ${message.stage}`);
      dispatch({ type: "stage", videoId: message.videoId, stage: message.stage });
      return;
    }
    if (isTrackProgressMessage(message)) {
      dispatch({ type: "progress", videoId: message.videoId, processed: message.processed, total: message.total });
      return;
    }
    if (isStemChunkMessage(message)) {
      handleStemChunk(message);
      return;
    }
    if (isTrackDoneMessage(message)) {
      log(`all stems delivered for ${message.videoId}`);
      doneReceived = true;
      finishStemsIfReady(message.videoId);
      return;
    }
    if (isTrackErrorMessage(message)) {
      logError(`pipeline failed for ${message.videoId}: ${message.code}`, message.message);
      dispatch({ type: "failed", videoId: message.videoId, reason: message.message });
    }
  }
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  // -- Kicking the pipeline off from the fader -----------------------------

  function requestCapturedAudio(videoId: string): void {
    const message: RequestCapturedAudioMessage = { type: "blk-request-captured-audio", videoId };
    window.postMessage(message, window.location.origin);

    setTimeout(() => {
      if (state.videoId === videoId && state.status === "processing" && state.stage === null) {
        log(`timed out waiting for a response for ${videoId}`);
        dispatch({ type: "failed", videoId, reason: "Timed out waiting for the captured track." });
      }
    }, CAPTURE_REQUEST_TIMEOUT_MS);
  }

  function engage(mixLevel: number): void {
    pendingMixLevel = mixLevel;
    postToPageWorld({ type: "blk-set-mix-level", mixLevel });

    if (mixLevel === NEUTRAL_MIX_LEVEL) return;
    if (state.status !== "ready-to-engage") return;

    const videoId = state.videoId;
    log(`engaging karaoke for ${videoId}`);
    dispatch({ type: "engage", videoId });
    requestCapturedAudio(videoId);
  }

  function destroy(): void {
    clearInterval(pollTimer);
    window.removeEventListener("message", onWindowMessage);
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  }

  return { engage, destroy };
}

export { createKaraokePipeline };
export type { KaraokePipeline, KaraokePipelineOptions };
