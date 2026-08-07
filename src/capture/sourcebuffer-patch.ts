// Patches MediaSource.addSourceBuffer and SourceBuffer.appendBuffer in the
// page world, riding YouTube's own player so capture inherits whatever PO
// token, signature and n-descrambling it already used to fetch the stream.
// Real prototype patching only: not unit-testable without a browser, kept
// thin so the pure predicates (mime filter, ad guard) carry the logic that
// can be tested.
//
// The capture side is wrapped in try/catch and the original method is
// always called after it, so a bug here degrades to "no capture" rather
// than "no playback".

import { isAudioMimeType } from "@/capture/mime-filter";
import { logError } from "@/capture/log";

interface SourceBufferCaptureDeps {
  isAdPlaying(): boolean;
  onAudioChunk(mimeType: string, bytes: Uint8Array): void;
}

interface SourceBufferCaptureHandle {
  restore(): void;
}

function copyBufferSource(data: BufferSource): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

function installSourceBufferCapture(deps: SourceBufferCaptureDeps): SourceBufferCaptureHandle {
  const mimeTypeBySourceBuffer = new WeakMap<SourceBuffer, string>();

  const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
  const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;

  MediaSource.prototype.addSourceBuffer = function (this: MediaSource, mimeType: string): SourceBuffer {
    const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
    try {
      mimeTypeBySourceBuffer.set(sourceBuffer, mimeType);
    } catch (error) {
      logError("failed to record a source buffer's mime type, it will not be captured", error);
    }
    return sourceBuffer;
  };

  SourceBuffer.prototype.appendBuffer = function (this: SourceBuffer, data: BufferSource): void {
    try {
      const mimeType = mimeTypeBySourceBuffer.get(this);
      if (mimeType && isAudioMimeType(mimeType) && !deps.isAdPlaying()) {
        deps.onAudioChunk(mimeType, copyBufferSource(data));
      }
    } catch (error) {
      logError("capture failed for an appendBuffer call, playback continues uncaptured", error);
    }
    originalAppendBuffer.call(this, data);
  };

  function restore(): void {
    MediaSource.prototype.addSourceBuffer = originalAddSourceBuffer;
    SourceBuffer.prototype.appendBuffer = originalAppendBuffer;
  }

  return { restore };
}

export { installSourceBufferCapture };
export type { SourceBufferCaptureDeps, SourceBufferCaptureHandle };
