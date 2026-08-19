# Tacet in pear-desktop — working notes

This checkout is a git submodule of **pear-desktop** ("Glassy Music"), an Electron
fork of th-ch/youtube-music. Upstream of it is `better-lyrics/tacet`, a Chrome MV3
extension. Everything below is about running that extension inside Electron, which
upstream does not target.

- fork: `NanKillBro/tacet-glassy` (remote `origin`), upstream: `better-lyrics/tacet` (remote `upstream`)
- consumed by: `extensions-src/tacet-glassy` in the parent repo
- host-side Electron code: `src/plugins/tacet/index.ts` in the parent repo (**not** here)
- built by: the parent's `tooling/sync-extensions.mjs`, which runs
  `git submodule update --init --recursive`, then `pnpm run sync:ort`, then
  `pnpm run build` here, then copies `build/chrome-mv3-prod/` to `extensions/tacet/`

## How the local fixes are carried

The Electron fixes live as a **patch series in `patches/electron/`**, applied by
`tooling/apply-patches.mjs`, which the `build` and `dev` scripts run first. The
tracked sources stay upstream-pristine, so `git merge upstream/main` never
conflicts on them — only a patch needs refreshing.

```sh
pnpm apply:patches            # idempotent; says "already applied" and stops
pnpm apply:patches --revert    # back to a pristine tree (do this before committing)
pnpm apply:patches --status     # e.g. "4 of 9 applied"
```

The applier reads each patch's `index a..b` lines — the blob hash of every file
before and after that step — and compares them against `git hash-object` on the
working tree. That is why it can report a partial series, and why it never has to
trial-apply anything. Do **not** replace it with per-patch `git apply --check`: in a
series that answers "does not apply" whatever the tree holds, because 01's context
stops existing the moment 03 edits the same file, and passing the whole series to one
`--check` does not help either (git only carries a patch's result forward to the next
when it is really applying).

**Patch files must stay LF**, which `.gitattributes` here pins (`*.patch text eol=lf`).
This bit once: the generator wrote them with LF, so every local build was green, but a
fresh Windows checkout smudged them to CRLF and the CI build died in the applier's
parser — in a JS regex `.` does not match `\r`, so `(.+)$` on a `diff --git` line quietly
matched nothing and the patch read as empty. The parser normalises line endings now as
well, so either half of that would have been enough; `git apply` itself was never the
problem, it takes a CRLF patch happily. The general lesson for this checkout: anything
whose *bytes* matter needs an attribute, because the working tree here is CRLF while the
blobs are LF.



Consequence to remember: **after any build the working tree is dirty on purpose.**
Only ever commit `patches/`, `tooling/apply-patches.mjs`, `package.json`,
`CLAUDE.md` — never the files a patch touched. `pnpm apply:patches --revert`
first, then commit.

The series, in apply order (order matters where two patches touch one file):

| # | patch | what it fixes |
|---|-------|---------------|
| 01 | `ort-session-reuse-and-release` | the session leak: one session per model, released when superseded, returned after 90 s idle |
| 02 | `superseded-separation-request` | a second request stranding the first caller's promise forever |
| 03 | `zero-probe-opt-in` | four full-segment warmup inferences on every init |
| 04 | `streaming-base64-transfers` | the offscreen-document OOM: base64 stems existing three times over |
| 05 | `one-delivery-per-track` | repeat cache probes each starting their own multi-MB delivery |
| 06 | `probe-traffic-and-warm-once` | 30 000 identical warm requests, plus a census to see traffic like that |
| 07 | `force-wasm-provider` | the host's "Force WASM (CPU) Mode" toggle reaching the worker |
| 08 | `electron-player-tab` | the popup finding the player tab under Electron's `tabs.query` |
| 09 | `windows-test-paths` | two tests that only passed on posix path separators |

## What Electron does not give the extension

Verified against the Electron extensions docs and by running it, not guessed:

- **`chrome.offscreen` does not exist.** The parent's plugin creates a hidden 1×1
  `BrowserWindow` on `chrome-extension://<id>/assets/offscreen.html` instead.
  `contextIsolation` must be `false` there or `chrome.runtime.sendMessage` from the
  page is unavailable; `backgroundThrottling` must be `false` or the hidden window's
  timers and workers get throttled mid-separation.
- **`chrome.tabs.query` honours only `url`, `title`, `audible`, `active`, `muted`.**
  `currentWindow` and `lastFocusedWindow` are silently ignored, so a query for "the
  active tab of this window" answers with *every* active tab — the settings window
  and the offscreen document included. Identify the player by `url`
  (`https://music.youtube.com/*`), which `host_permissions` already covers. This is
  what patch 08 and `src/settings/player-tab.ts` are for.
- **`chrome.storage.sync` and `.managed` are absent**; only `.local` works.
- `chrome.tabs.sendMessage`, `chrome.runtime.sendMessage` / `onMessage` do work.
- **Electron quits only when every `BrowserWindow` is gone.** The hidden offscreen
  window is one, so it kept the whole process alive after the main window closed
  (~2.6 GB resident, one renderer holding the model). Fixed host-side: the plugin
  watches every window's `closed` and tears down its own windows once no app window
  remains. Tray mode and macOS are unaffected because there the main window's
  `close` is prevented, so `closed` never fires.
- The offscreen document has no window anyone can open devtools on, so the plugin
  forwards `console-message` from it and from the settings window into the main
  process log as `[Tacet][offscreen]` / `[Tacet][settings]`. That forwarding is how
  anything in those contexts becomes visible at all — reach for it first.

## The defects, and how they were found

Symptoms as reported: OOM crash, whole-app freeze, 8+ GB of VRAM, and one log line
repeated ~30 000 times.

1. **Session leak / model re-upload.** `handleSeparateInit` assigned over a live
   `InferenceSession`, and nothing else held a handle, so every track uploaded 163 MB
   of fp32 weights again and left the previous copy on the device. On an iGPU that is
   system RAM. Fix: release-before-create, plus a `modelKey`
   (`url#sha256#provider` — the provider matters, wasm weights are not a gpu session)
   so a second track reuses what is already there. `separationSessionModelKey` in the
   worker, `loadedModelKey` in the host.
2. **Idle sessions never returned.** Keeping a session between tracks is right;
   keeping it forever is not. A 90 s idle timer posts `separate-release`. The timer
   lives in `workers/separation-host.ts`, **not** in the worker: the host is the side
   that remembers a session exists, and a worker dropping one on its own stranded the
   next init, which then skipped `separate-init` and failed with "Session not
   initialized". The host clears `loadedModelKey` *before* posting the release so an
   init arriving mid-flight rebuilds instead of trusting a corpse.
3. **`probeWithZeros` on every init.** Four full-segment inferences purely to print
   RMS — minutes of GPU time before the first real chunk, far worse under wasm. This
   was the ">10 minutes stuck on loading-model with the GPU pinned". Now opt-in:
   `blkSetSeparationProbe(true)` from the offscreen console.
4. **One promise slot, two requests.** The worker's replies carry no request id, so
   `SeparationHost` has a single in-flight slot. Overwriting it stranded the earlier
   promise forever, which read downstream as a stage that never advanced. `takeSlot()`
   rejects the loser with an `AbortError` instead.
5. **The OOM.** A stem existed three times at the moment it was sent: as bytes, as one
   full base64 string, and as the array of slices of that string — inside a renderer
   with V8's 4 GB heap ceiling. Base64 spends exactly 4 chars per 3 bytes, so slicing
   the bytes on a 3-byte boundary and encoding each slice concatenates to the same
   string as encoding the whole buffer. `iterateBase64Chunks` yields one 512 KB slice
   at a time; `assembleBytes()` decodes and frees chunk by chunk on the receiving side.
6. **Duplicated deliveries.** A cache probe answered with a hit also re-streams both
   stems, and repeat probes each started their own transfer. `deliveriesInFlight`
   joins the transfer already running for that video id.
7. **The 30 000 log lines.** The next track is announced on a timer and its miss was
   answered every time, each answer asking the page world to warm the same track.
   `warmRequestedFor` sends that request once per target. Alongside it, a rolling
   probe census (see below) so a storm like that shows up as one summary line rather
   than thirty thousand identical ones.

## Diagnostics available

- `setLoggingEnabled(true)` gates `logger.log`/`warn` (`src/shared/logger.ts`);
  `logger.error` always prints. With the plugin's console forwarding, everything
  lands in the Electron terminal.
- **Cache probe census** (`src/orchestrator/karaoke-pipeline.ts`): every 15 s, if at
  least 8 events happened, one `warn` reporting probes sent vs answered and the
  reason breakdown. Answers outnumbering requests means deliveries are being
  duplicated; both climbing together means something is looping.
- `blkSetSeparationProbe(true)` — re-enable the zeros probe for a session producing
  garbage.
- `blkRunPipelineSelfTest()`, `blkAnalyseCachedStems()`, `blkAcquireFromMintedUrl()`
  in `workers/offscreen.ts` — synthetic pipeline bisect and cache inspection.
- The offscreen document reads its execution provider from its own url
  (`?forceWasm=1`): the choice has to be settled before the first session is built,
  and a query parameter is the only channel available that early.

## Verification chain

Run all of it from this directory unless noted; this is the sequence that has been
kept green.

```sh
npx tsc --noEmit                       # app + popup
npx tsc -p workers/tsconfig.json --noEmit
npx vitest run                         # 115 files, 2103 tests as of 2026-08-19
npx biome lint .                        # clean
pnpm build
cd ../.. && node tooling/sync-extensions.mjs
npx tsc --noEmit                       # parent: expect zero errors under src/plugins/tacet
npx oxlint --type-aware src/plugins/tacet
pnpm build
```

`pnpm lint` here is **not** usable: it also runs `biome format`, which fails on ~263
pre-existing files because the working tree is CRLF (`core.autocrlf=true` in the
system gitconfig) while the blobs are LF. `npx biome lint .` alone is clean. Do not
"fix" that by reformatting the tree — it would bury every patch in whitespace.

## Known open items

- Long-term stability is unproven: confirmed working over ~4 tracks per session.
- `PRODUCTION_WORKER_COUNT = 1` (`src/contents/capture-spike.ts`) spawns hidden
  YouTube Music iframes for prefetch. Untouched, and a plausible source of memory
  growth in a long session.
- `DEFAULT_MAX_RETAINED_BYTES = 64 * 1024 * 1024` (`src/capture/accumulator.ts`)
  caps retained capture bytes; chunks past it are dropped from decode input but
  still counted in totals. Untouched.
- VRAM usage was explicitly deprioritised by the user in favour of "it works".
