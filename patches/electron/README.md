# Electron patch series

Local fixes for running this extension inside **pear-desktop** (Electron), kept as
patches so the tracked sources stay as upstream wrote them and
`git merge upstream/main` never conflicts on them.

Applied automatically by `pnpm build` and `pnpm dev`, or by hand:

```sh
pnpm apply:patches            # idempotent
pnpm apply:patches --status
pnpm apply:patches --revert    # do this before committing anything here
```

They are numbered because order matters — several touch the same file, and a later
one is written against the tree an earlier one produced.

| # | patch | why |
|---|-------|-----|
| 01 | `ort-session-reuse-and-release` | one inference session per model instead of a fresh 163 MB upload per track, released when superseded and handed back after 90 s idle |
| 02 | `superseded-separation-request` | a second request used to strand the first caller's promise forever |
| 03 | `zero-probe-opt-in` | four full-segment warmup inferences ran on every init; now behind `blkSetSeparationProbe(true)` |
| 04 | `streaming-base64-transfers` | a stem existed three times over while being sent, which ran the renderer out of heap |
| 05 | `one-delivery-per-track` | repeat cache probes each started their own multi-MB delivery |
| 06 | `probe-traffic-and-warm-once` | the same warm request was sent per answer rather than per target; adds a rolling census of probe traffic |
| 07 | `force-wasm-provider` | lets the host's "Force WASM (CPU) Mode" reach the worker, through the offscreen document's url |
| 08 | `electron-player-tab` | Electron ignores `tabs.query({currentWindow})`, so the popup has to find the player by url |
| 09 | `windows-test-paths` | two tests assumed posix path separators |

## How the applier knows what is applied

Not by trial: `git apply --check` cannot judge a patch in a series (01's context stops
existing once 03 lands on the same file, and one `git apply --check` over the whole
series does not carry each patch's result to the next). Instead it reads the
`index a..b` line every git patch carries, which records the blob hash of that file
before and after that step, and compares it with `git hash-object` on the working
tree. Same clean filter on both sides, so this stays correct on a CRLF checkout.

So `--status` can say `4 of 9 applied`, and a tree nobody's series describes gets
named for what it is closest to:

```
[patches] this tree is in no state the series describes.
[patches] Closest is fully patched, with 1 file(s) out of step:
[patches]   workers/separator.ts: expected c79c544, tree holds 124046c
```

## Refreshing after an upstream merge

`pnpm apply:patches` and read what it names. If the sources moved, it tries
`git apply --3way` over the series — that needs a clean tree, so it only helps right
after a merge, and it warns loudly, because a three-way result is no longer what the
patch files say. Check that diff, then regenerate the patch it belongs to with
`git diff` and re-run `--status` until the series reads `all applied` again.
