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
| 10 | `early-staged-decode` | crossfades lost at the last second to a staged decode that started too late |
| 11 | `host-owns-offscreen-document` | `chrome.offscreen` exists after all, so this side created a second copy of the page on top of the host's window and every track was separated twice |
| 12 | `reject-software-adapter-and-thread-wasm` | ORT ran htdemucs on a SwiftShader WebGPU adapter, which is slower than its own wasm provider; a software adapter is now refused by name, and wasm gets more than the one hardcoded thread |

Two mechanical notes about generating a new patch, both of which cost time here:

- **A patch for a file an earlier patch already touches needs a temp baseline index**,
  or `git diff` folds the earlier patches into it. Stage the fully-patched content into
  a scratch index first, then diff against that:

  ```sh
  export GIT_INDEX_FILE="$TEMP/patch12-index"    # NOT inside this repo
  git read-tree HEAD && git add workers/separator.ts
  git diff --stat                                 # must be empty before you edit
  # ...edit, then:
  git diff -- workers/separator.ts > patches/electron/12-....patch
  ```

  `GIT_INDEX_FILE` must live **outside** the checkout: in a submodule `.git` is a file,
  not a directory, so `.git/<name>.lock` cannot be created and git fails with
  `fatal: Unable to create '.../.git/patch12-index.lock': No such file or directory`.
- **To check a patch for stray CRs, use `tr -dc '\r' < f | wc -c`.** `od -c f | grep -c
  '\r'` is not a CR check — it matches the two-character sequence `\` `r` that `od`
  prints for *other* things, and reported 265 on files with zero CR bytes. That false
  positive was hit twice in one session.

### Refreshing the series after an upstream merge

Done once, for upstream v1.3.0 (2026-08-25). Four lessons, in the order they bit:

- **"Applies cleanly" does not mean "does not need regenerating."** `git apply` matches
  by context and will happily land a patch on a moved file, but `tooling/apply-patches.mjs`
  validates by the `index a..b` blob hashes, so a patch whose file changed upstream reads
  as *out of step* even after applying. Patches 09 and 10 both applied clean and both still
  had to be regenerated. **Pick the set to refresh by which files upstream touched, not by
  which patches conflicted:**

  ```sh
  CHANGED=$(git diff --name-only <pre-merge> upstream/master)
  for p in patches/electron/*.patch; do
    grep '^diff --git' "$p" | sed 's|^diff --git a/||; s| b/.*$||' \
      | grep -qFx -f <(printf '%s\n' $CHANGED) && echo "refresh $(basename $p)"
  done
  ```

- **Regenerate by replaying the whole series from the merge commit**, capturing each target
  patch's diff at its own point in the chain — a patch is a delta on top of the ones before
  it, so there is no way to recover it from the final tree alone. Reset to the merge commit,
  apply in order, and for each patch to refresh: stage its files into a scratch index
  *before* applying it (that is the pre-state), apply, resolve, then
  `GIT_INDEX_FILE=$scratch git diff -- <its files>`.
- **`git apply -3` leaves the file unmerged in the *main* index, and the next `-3` in the
  series then dies with `does not exist in index`.** `git add` each resolved file before
  moving on. Losing an hour to this is easy because the error names the file, not the cause.
- **A patch that creates files needs `git add -N` on them before the capture**, or
  `git diff` silently omits them — they are untracked in the scratch index, and `git diff`
  does not report untracked paths. This dropped both new files from patch 08 and the only
  symptom was the patch being 50 lines instead of 188. Compare
  `grep -c '^diff --git'` before and after.


## What Electron does not give the extension

Verified against the Electron extensions docs and by running it, not guessed:

- **`chrome.offscreen` DOES exist — this note used to say it did not, and that was
  wrong.** Re-measured 2026-08-25 on Electron 42.5.0 / Chromium 148 with a throwaway
  probe extension: `chrome.offscreen` is an object carrying `createDocument`,
  `hasDocument`, `closeDocument` and `Reason`, `createDocument()` resolves, and the
  binary contains the full api schema plus Chromium's own
  `"Only a single offscreen document may be created."`. It was presumably absent on
  whatever Electron version this note was first written against.
  **What is still true is that the host must not rely on it:** the parent's plugin
  creates a hidden 1×1 `BrowserWindow` on
  `chrome-extension://<id>/assets/offscreen.html`, because it needs something it can
  forward `console-message` from, rebuild on `render-process-gone`, and hand the
  execution provider to through the url (`?forceWasm=1`). `contextIsolation` must be
  `false` there or `chrome.runtime.sendMessage` from the page is unavailable;
  `backgroundThrottling` must be `false` or the hidden window's timers and workers get
  throttled mid-separation.
  **The trap:** `hasDocument()` answers **false** while that BrowserWindow is loaded,
  because a plain window is not registered with the offscreen document manager. So the
  extension's `if (!chrome.offscreen)` stub never installed, `hasDocument()` never
  deduplicated, and `createDocument()` added a *second* live copy of the page — two
  `SeparationHost`s, two ONNX sessions, every track separated twice. Patch 11. The same
  false `hasDocument()` also silently dropped every settings broadcast, which upstream
  gates on it.
- **`chrome.tabs.query` honours only `url`, `title`, `audible`, `active`, `muted`.**
  `currentWindow` and `lastFocusedWindow` are silently ignored, so a query for "the
  active tab of this window" answers with *every* active tab — the settings window
  and the offscreen document included. Identify the player by `url`
  (`https://music.youtube.com/*`), which `host_permissions` already covers. This is
  what patch 08 and `src/settings/player-tab.ts` are for.
- **`chrome.storage.sync` and `.managed` are absent**; only `.local` works. This is the
  one Electron fix carried as *committed source* rather than a patch, and it is the only
  thing upstream merges ever conflict on. Two traps, both hit on the v1.3.0 merge:
  **upstream adds new `.sync` call sites with every settings feature** (v1.3.0's `sources`
  would never have persisted), and **`storage.onChanged` handlers compare `areaName`
  against a literal** — a stale `areaName !== "sync"` guard makes a context deaf to every
  write the rest of the extension makes to `.local`. So after a merge, sweep rather than
  just resolving conflicts:
  `grep -rn 'storage\.\(sync\|managed\)' src workers` and `grep -rn 'areaName' src workers`
  must both come back with nothing to fix.

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
8. **Crossfades lost to their own decode.** Separation, staging and the cue all worked;
   the fade was armed (`<id> is staged, a transition into it is possible`) and then
   abandoned a second from the end with `the staged track was still decoding with 1.2 s
   left`. The cue asks the orchestrator for the decode at `fade + poll +
   DECODE_LEAD_SECONDS` — about 14 s out — and gives up below `MINIMUM_FADE_SECONDS`,
   so the decode has ~13 s to turn ~7 minutes of Opus into PCM. Fine in a browser tab;
   here the tail of a track is also where the next one is warmed and separated, so the
   budget is missed at random. Read the log by elimination: `sendStagedDeck` has exactly
   three outcomes and **none of their lines was present**, which is what places the
   failure inside a decode that never settled in time rather than anywhere upstream.
   Patch 10 asks for the decode when the stems are staged instead, which is a minute or
   so earlier and costs only holding the frames longer, and times the decode so the next
   overrun says so itself.
9. **Every track separated twice.** Two live "Better Lyrics Karaoke spike offscreen
   document" targets, both running the whole pipeline. The host creates exactly one — the
   only three callers of `createOffscreenWindow` all `destroyWindow('offscreen')` first —
   so the second came from `ensureOffscreenDocument()` in `src/background.ts`, which was
   only ever supposed to run in a real browser. It ran here because this file's own note
   that `chrome.offscreen` "does not exist" had gone stale; see above. Found by writing a
   ~40-line throwaway Electron app that loads a probe extension and dumps
   `webContents.getAllWebContents()`: it reported `type=remote` and `type=window` on the
   same url — the user-visible symptom, reproduced in isolation, on Windows, in seconds.
   Worth keeping as a technique, because three rounds of log-reading went to hypotheses
   that a five-minute experiment refuted. A claim about what Electron hands an extension
   is cheap to test directly and expensive to reason about from docs; the docs were
   consulted first here and did not settle it, since they do not list `chrome.offscreen`
   and also say the list is not exhaustive. Patch 11. The host now marks its own window
   with `?owner=host` so the two can be told apart at a glance.
10. **htdemucs was running on SwiftShader, and ORT never said so.** A `requestAdapter()`
    probe in `offscreen.html` on the Linux box answered `vendor: 'google'`,
    `architecture: 'swiftshader'`, `f16: false`. WebGPU was not missing and ORT was not
    falling back to wasm — it had an adapter, and the adapter *was* the CPU. That is the
    worst of both: SwiftShader emulates compute shaders on one thread, where the wasm
    provider gets SIMD and several. **A software WebGPU adapter is slower than no WebGPU
    at all**, so "is there an adapter" was never the right question.

    It stayed silent because `["webgpu", "wasm"]` asks ORT to pick, ORT picks the first
    that initialises without logging which, and it can place *individual nodes* on wasm
    so even a partial fallback is invisible. `logSeverityLevel: ORT_LOG_SEVERITY_ERROR`
    (`workers/separator.ts`) suppresses its EP-registration output on top of that. Patch
    12 makes the choice here instead and states it: `chooseProviders()` refuses an
    adapter whose `isFallbackAdapter` is true (read off both the adapter and `adapter.info`,
    the property moved between spec revisions) or whose identity matches `/swiftshader/i`,
    and logs one line naming the provider either way.

    The host-side flag is a red herring worth recording: `--enable-unsafe-webgpu` is what
    *permits* the SwiftShader fallback. With it there is a software adapter; without it
    Chromium hands out none at all. Neither state produces hardware on Wayland + Mesa
    here — the Vulkan backend crashes the GPU process on Wayland and is unusably slow
    forced onto X11 — so this box is CPU-only, and patch 12 makes that automatic rather
    than a flag anyone has to know about.
11. **`numThreads = 1` was hardcoded, and the reason given for keeping it was wrong.**
    Upstream pins the wasm provider to a single thread, and ORT's own default is also 1
    whenever `self.crossOriginIsolated` is false — which it is here, since the extension
    manifest carries no COEP/COOP. So the plan for this said threading needed
    `cross_origin_embedder_policy` in the manifest plus CORP headers injected host-side
    for the model download. **Measured false**, with a throwaway Electron app loading a
    probe extension that builds a real `["wasm"]` session in a Worker: `crossOriginIsolated`
    is false, and `numThreads = 4` is honoured anyway.

    ORT 1.26's actual gate is not `crossOriginIsolated`. It is: `SharedArrayBuffer` exists,
    **and** a `SharedArrayBuffer` survives `new MessageChannel().port1.postMessage(...)`,
    **and** `WebAssembly.validate()` accepts an atomics module. All three hold in Electron.
    The control run without `--enable-features=SharedArrayBuffer` passed too, so it does
    not even depend on that switch. Patch 12 therefore sets `min(6, floor(cores / 2))` —
    half the machine, capped, because the stems deck under-runs if separation takes every
    core. Safe by construction: when that gate fails ORT *warns and clamps to 1* rather
    than throwing, so the worst case is exactly the old behaviour. Only the
    `ort-wasm-simd-threaded.*` artifacts are shipped, so no new assets are involved.


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
- **The worker states its provider and thread count on every init** (patch 12) — one of
  `provider: webgpu on vendor=… architecture=… f16=…`, `provider: wasm (forced by the
  host)`, or a `logger.error` naming why WebGPU was refused (`no adapter`, `software
  renderer (…)`, `navigator.gpu is absent`), followed by `wasm threads=N (cores=…,
  crossOriginIsolated=…)`. These are the first two lines to read in any report of
  separation being slow. Host side, the parent logs `app.getGPUFeatureStatus()` — but
  only from `app.on('gpu-info-update')`, because before the GPU process reports Chromium
  answers `disabled_*` for every feature and the line reads "everything is software" on
  a perfectly healthy GPU.

## Verification chain

Run all of it from this directory unless noted; this is the sequence that has been
kept green.

```sh
npx tsc --noEmit                       # app + popup
npx tsc -p workers/tsconfig.json --noEmit
npx vitest run                         # 124 files, 2394 tests as of 2026-08-25 (upstream v1.3.0)
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

**Run `vitest` with the patches applied.** On an unpatched tree 20 tests fail
(`src/pageworld/one-owner.test.ts`, `src/shared/web-accessible-resources.test.ts`) — those
are upstream's own Windows path bugs, and patch 09 is what fixes them: `relative()` emits
`\` and is compared against `/` literals, and `new URL(...).pathname` yields `/C:/...`
which `join()` turns into `C:\C:\...`. Seeing those 20 fail means the series is off, not
that something regressed.

## Known open items

- The stems deck under-runs mid-track: `the deck stopped while the track kept playing,
  restarting it at the playhead`, sometimes repeatedly, and `the deck reached the end of
  its audio before the track did`. Seen alongside the crossfade misses of patch 10 but
  independent of them — that fade failed in the orchestrator's decode, not in the graph.
  Not diagnosed.
- Long-term stability is unproven: confirmed working over ~4 tracks per session.
- `PRODUCTION_WORKER_COUNT = 1` (`src/contents/capture-spike.ts`) spawns hidden
  YouTube Music iframes for prefetch. Untouched, and a plausible source of memory
  growth in a long session.
- `DEFAULT_MAX_RETAINED_BYTES = 64 * 1024 * 1024` (`src/capture/accumulator.ts`)
  caps retained capture bytes; chunks past it are dropped from decode input but
  still counted in totals. Untouched.
- **VRAM sits at 6–7 GB while separating** (measured 2026-08-19, after the session-reuse
  and release fixes). **Update 2026-08-25: patch 11 took this to ~4 GB** — half of it was
  the duplicate offscreen document holding a second session, so the figure below was
  always two sessions' worth. Still deliberately left alone: the user deprioritised it in
  favour of "it works", so do not trade stability for it unopened. For whoever picks it up,
  the 163 MB of weights are not the story — that much VRAM is activations and ONNX Runtime's
  WebGPU buffer cache, which reuses freed buffers rather than returning them to the
  driver, so the high-water mark of one segment's intermediates is held for as long as
  the session is. Levers, roughly cheapest first: shrink the segment/overlap the
  pipeline feeds `separate-chunk`, drop the 90 s idle retention so the arena goes back
  between tracks, or move to an fp16 model. Each one costs latency or quality, which is
  exactly why none of them were taken. None of it applies on a box patch 12 puts on wasm.
- `APPROX_MODEL_BYTES = 83 * 1024 * 1024` (`src/cache/model-cache.ts`) is the **fp16**
  size but is the progress denominator for whichever variant is downloading, so a server
  without `content-length` reports fp32 progress running to ~196%. Untouched; it matters
  only if the fp16 model is ever made the default.
