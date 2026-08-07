# Separation pipeline (vendored)

This directory is vendored, not authored here. The audio separation pipeline
(chunking, STFT/ISTFT, HTDemucs spectrogram framing, post-processing, derived
stems, channel validation, and codec/decoding) was copied from `composer`,
a sibling app that already runs this pipeline in production.

- Source repo: `composer` (sibling checkout at `/Users/boidu/Developer/composer`)
- Source path: `src/audio/separation/` (plus `src/audio/lame-priming.ts`)
- Commit: `30f0e2e`

Every file carries a `// Vendored from composer <path> @ <sha>` header on its
first line recording where it came from.

## Files vendored

- `types.ts`
- `chunker.ts`
- `stft.ts`
- `demucs-spec.ts`
- `demucs-postprocess.ts`
- `derived-stems.ts`
- `validate-channels.ts`
- `audio-codec.ts`
- `lame-priming.ts` (originally `src/audio/lame-priming.ts`, a dependency of `audio-codec.ts`)
- `chunker.test.ts`
- `stft.test.ts`
- `demucs-spec.test.ts`
- `derived-stems.test.ts`
- `validate-channels.test.ts`
- `lame-priming.test.ts`

Import paths were rewritten from composer's `@/audio/separation/...` and
`@/audio/lame-priming` to this repo's `@/separation/...`. No other changes
were made: logic, formatting (beyond what Biome reformats automatically),
and test bodies are unchanged from the source.

One type annotation in `audio-codec.ts` differs from composer: `sha256Hex`
takes `Uint8Array<ArrayBuffer>` instead of `Uint8Array`. This repo's
TypeScript (5.9.3) is newer than composer's (5.7.3) and enforces stricter
`BufferSource` typing that rejects the wider `Uint8Array<ArrayBufferLike>`,
even though the runtime behavior is identical. Composer will need the same
annotation once it upgrades TypeScript past 5.9.

`lame-priming.ts` has the same class of divergence: `parseLamePriming` takes
`ArrayBufferLike | Uint8Array` instead of `ArrayBuffer | Uint8Array`, needed
once `lame-priming.test.ts` started passing `.buffer` from a bare `Uint8Array`
(typed `ArrayBufferLike`, since it may back a `SharedArrayBuffer`) into a
parameter that only accepted `ArrayBuffer`. Runtime behavior is unchanged;
`new Uint8Array(input)` already accepted `ArrayBufferLike`.

## Deliberately not vendored

- `stem-store.ts`, `model-cache.ts`, `worker.ts`, `worker-host.ts`,
  `scrub-stem-router.ts`, `model-registry.ts`: these depend on composer's
  settings store and persistence layer, or are otherwise out of scope for
  this phase. A different cache and worker host are built in a later phase.
- `audio-codec.browser.test.ts`: needs a real browser via `@vitest/browser`,
  which this repo does not have installed. Skipped rather than ported to
  jsdom, since the test exercises real `OfflineAudioContext` decode behavior
  that jsdom does not implement.
- Composer's `VocalModelVariant` type (from its settings store) is not
  referenced anywhere in the vendored files, so nothing here imports it. If a
  future port from composer needs it (e.g. porting `model-registry.ts` or
  `stem-store.ts`), declare a local `type ModelVariant = "fp16" | "fp32"` in
  `types.ts` instead of importing from composer at runtime.

## Keeping this in sync

If a bug is found in this pipeline, fix it upstream in `composer` first,
then port the fix here with the same minimal-diff approach used for the
initial vendor. Do not let this copy and composer's original drift apart
silently; update the commit SHA in the provenance headers and this file
when you re-sync.
