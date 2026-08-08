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
  type CaptureStandDownMessage,
  type RequestCapturedAudioMessage,
  type RequestNextPrefetchMessage,
  type RequestPrefetchMessage,
  isCaptureReadyMessage,
  isCapturedAudioMessage,
  isCapturedAudioUnavailableMessage,
  isDownloadProgressMessage,
  isNextTrackMessage,
} from "@/capture/bridge-protocol";
import {
  BETTER_LYRICS_PLAYER_EVENT,
  playerStateFromBetterLyrics,
  playerStateFromOwnBridge,
} from "@/orchestrator/player-source";
import { createLogger } from "@/shared/logger";
import { decodeOpusToPcm } from "@/cache/opus-codec";
import { initialKaraokeState, reduceKaraokeState } from "@/orchestrator/karaoke-state";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import type { LoadStemsMessage, SetMixLevelMessage, StopStemsMessage } from "@/pageworld/protocol";
import { loadSettingsFrom } from "@/settings/storage";
import { base64ToBytes, bytesToBase64 } from "@/relay/base64";
import { type ChunkAssembler, createChunkAssembler, splitIntoChunks } from "@/relay/chunk-transfer";
import type {
  CancelSeparationCommand,
  CaptureChunkMessage,
  ProbeCacheCommand,
  StemChunkMessage,
} from "../../workers/protocol2";
import {
  isCacheHitMessage,
  isCacheMissMessage,
  isStemChunkMessage,
  isTrackDoneMessage,
  isTrackErrorMessage,
  isTrackProgressMessage,
  isTrackStageMessage,
} from "../../workers/protocol2";

const CAPTURE_REQUEST_TIMEOUT_MS = 8000;

// k = 1 is the original mix untouched (see src/pageworld/gain-law.ts).
const NEUTRAL_MIX_LEVEL = 1;

const logger = createLogger("orchestrator");

function log(message: string): void {
  logger.log(message);
}

function logError(message: string, error: unknown): void {
  logger.error(message, error);
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

function createKaraokePipeline(options: KaraokePipelineOptions): KaraokePipeline {
  // Empty, not the current videoId: checkTrackChange only fires on a change, so
  // starting at the real one made a page load look like no change at all.
  let state: KaraokeState = initialKaraokeState("");
  let pendingMixLevel = NEUTRAL_MIX_LEVEL;
  // The queue item being warmed ahead of the listener. It never touches the
  // state machine, which belongs to the track actually playing.
  let prefetchVideoId: string | null = null;
  let vocalsAssembler: ChunkAssembler | null = null;
  let instrumentalAssembler: ChunkAssembler | null = null;
  let doneReceived = false;

  // Unlike every later transition, the initial state never reaches setState below, so it is announced here.
  options.onStateChange(state);

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
    message:
      | SetMixLevelMessage
      | LoadStemsMessage
      | StopStemsMessage
      | CaptureStandDownMessage
      | RequestPrefetchMessage
      | RequestNextPrefetchMessage,
    transfer?: Transferable[]
  ): void {
    window.postMessage(message, window.location.origin, transfer);
  }

  // -- Track change polling -----------------------------------------------

  // Driven by whichever bridge is publishing, never by the URL: the player
  // reaches the next track before location.search is read again, and that gap is
  // what let a previous track's stems stay engaged over the new one.
  function onTrackObserved(videoId: string): void {
    if (videoId === state.videoId) return;

    log(`track changed ${state.videoId || "(none)"} -> ${videoId}`);

    if (state.status === "processing") {
      const cancel: CancelSeparationCommand = { type: "blk-cancel-separation" };
      chrome.runtime.sendMessage(cancel).catch(error => logError("failed to send cancel", error));
    }
    if (state.status === "processing" || state.status === "engaged") {
      postToPageWorld({ type: "blk-stop-stems" });
    }

    resetStemAssembly();
    prefetchVideoId = null;
    dispatch({ type: "track-changed", videoId });
    // Acquisition waits for the answer. Starting both at once raced the lookup,
    // and a cold offscreen document loses that race and re-downloads a track
    // whose stems were already cached.
    probeCacheFor(videoId);
  }

  // The cache lookup used to live only in the capture-completion path, so a
  // track had to be fully re-captured before anything would even look.
  function probeCacheFor(videoId: string): void {
    const probe: ProbeCacheCommand = { type: "blk-probe-cache", videoId };
    chrome.runtime.sendMessage(probe).catch(error => logError("failed to send cache probe", error));
  }

  function onBetterLyricsPlayerState(event: Event): void {
    const observed = playerStateFromBetterLyrics((event as CustomEvent).detail);
    if (observed) onTrackObserved(observed.videoId);
  }
  document.addEventListener(BETTER_LYRICS_PLAYER_EVENT, onBetterLyricsPlayerState);

  // -- MAIN world: capture-spike.ts ---------------------------------------

  async function sendCapturedAudioChunks(videoId: string, mimeType: string, bytes: ArrayBuffer): Promise<void> {
    const base64 = bytesToBase64(new Uint8Array(bytes));
    const chunks = splitIntoChunks(base64);
    log(`sending captured audio for ${videoId}: ${bytes.byteLength} bytes as ${chunks.length} chunk(s)`);

    for (let index = 0; index < chunks.length; index++) {
      if (videoId !== state.videoId && videoId !== prefetchVideoId) return; // superseded mid-send
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

    const observed = playerStateFromOwnBridge(data);
    if (observed) {
      onTrackObserved(observed.videoId);
      return;
    }

    if (isNextTrackMessage(data)) {
      if (data.videoId === state.videoId) return;
      prefetchVideoId = data.videoId;
      log(`next up is ${data.videoId}, checking whether it needs separating`);
      probeCacheFor(data.videoId);
      return;
    }

    if (isCaptureReadyMessage(data)) {
      if (data.videoId === prefetchVideoId) {
        log(`next track ${data.videoId} acquired, separating it ahead of time`);
        const request: RequestCapturedAudioMessage = { type: "blk-request-captured-audio", videoId: data.videoId };
        window.postMessage(request, window.location.origin);
        return;
      }
      log(`capture ready for ${data.videoId}`);
      dispatch({ type: "capture-ready", videoId: data.videoId });
      maybeAutoEngage(data.videoId);
      return;
    }

    if (isDownloadProgressMessage(data)) {
      dispatch({ type: "download-progress", videoId: data.videoId, fraction: data.fraction, source: data.source });
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
          videoId,
          vocals: vocals.channels,
          instrumental: instrumental.channels,
          sampleRate: vocals.sampleRate,
        };
        postToPageWorld(message, transfer);
        dispatch({ type: "stems-loaded", videoId });
        postToPageWorld({ type: "blk-set-mix-level", mixLevel: pendingMixLevel });
        log(`karaoke engaged for ${videoId}`);
        // Only now: a separation for the next track would otherwise take the
        // offscreen document's single job away from the one being waited on.
        const nextRequest: RequestNextPrefetchMessage = { type: "blk-request-next-prefetch", videoId };
        postToPageWorld(nextRequest);
      })
      .catch(error => {
        logError("failed to decode stems", error);
        dispatch({ type: "failed", videoId, reason: describeError(error) });
      });
  }

  function onRuntimeMessage(message: unknown): void {
    if (isCacheHitMessage(message)) {
      if (message.videoId === prefetchVideoId) {
        log(`next track ${message.videoId} is already separated`);
        prefetchVideoId = null;
        return;
      }
      log(`cached stems found for ${message.videoId}, capture is not needed`);
      dispatch({ type: "cache-hit", videoId: message.videoId });
      postToPageWorld({ type: "blk-capture-stand-down", videoId: message.videoId });
      // The relay through background does not guarantee ordering, so the stems
      // may already be complete and would otherwise sit assembled and unused.
      finishStemsIfReady(message.videoId);
      return;
    }
    if (isCacheMissMessage(message)) {
      if (message.videoId === prefetchVideoId) {
        log(`next track ${message.videoId} is not separated yet, warming it`);
        postToPageWorld({ type: "blk-request-prefetch", videoId: message.videoId, ahead: true });
        return;
      }
      if (message.videoId !== state.videoId) return;
      log(`no cached stems for ${message.videoId}, acquiring`);
      // From here, not the capture script: this module only exists when the
      // master switch is on, and that script runs for every track regardless.
      postToPageWorld({ type: "blk-request-prefetch", videoId: message.videoId });
      return;
    }
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

  // -- Auto separate -------------------------------------------------------
  //
  // autoSeparateEnabled (src/settings/settings.ts, default on) starts
  // separation the moment capture is ready, without moving the mix level
  // itself, so stems are already cached by the time the user reaches for the
  // fader. Reads the setting fresh per track rather than caching it, since a
  // single pipeline instance lives across many tracks.

  function maybeAutoEngage(videoId: string): void {
    loadSettingsFrom(chrome.storage.sync)
      .then(settings => {
        if (!settings.autoSeparateEnabled) return;
        if (videoId !== state.videoId || state.status !== "ready-to-engage") return;

        log(`auto-separating ${videoId}`);
        dispatch({ type: "engage", videoId });
        requestCapturedAudio(videoId);
      })
      .catch(error => logError("failed to read the auto-separate setting", error));
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
    document.removeEventListener(BETTER_LYRICS_PLAYER_EVENT, onBetterLyricsPlayerState);
    window.removeEventListener("message", onWindowMessage);
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);

    // The page world outlives this module, so stems left engaged would keep the
    // original silenced with nothing able to switch it back.
    postToPageWorld({ type: "blk-stop-stems" });
    if (state.status === "processing") {
      const cancel: CancelSeparationCommand = { type: "blk-cancel-separation" };
      chrome.runtime.sendMessage(cancel).catch(error => logError("failed to send cancel", error));
    }
  }

  return { engage, destroy };
}

export { createKaraokePipeline };
export type { KaraokePipeline, KaraokePipelineOptions };
