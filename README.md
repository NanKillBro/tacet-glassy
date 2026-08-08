# Tacet

Vocal separation for YouTube Music. Tacet pulls the track apart into vocals and
instrumental in your browser, then gives you a fader to sit anywhere between the
two. Sing over the instrumental, or drop the backing and listen to the vocal on
its own. Built with Plasmo, ONNX Runtime and WebGPU, running
[htdemucs](https://github.com/adefossez/demucs) locally. Nothing is uploaded.

> [!WARNING]
> Tacet is not on any extension store, and probably will not be. It works by
> capturing the audio YouTube Music is already streaming, which Chrome Web Store
> policy treats the same way it treats video downloaders. Load it unpacked.

> [!NOTE]
> It plays well with [Better Lyrics](https://github.com/boidushya/better-lyrics)
> and [Better Lyrics Shaders](https://github.com/better-lyrics/shaders), and
> mounts its control into the Better Lyrics dock when that is installed. Neither
> is required.

## How it works

A media element can only be routed into Web Audio once, ever, so the three
extensions share one bus published on `window.__blyricsAudio`. Whichever loads
first claims the element and publishes; the others attach to what they find.

The rest is a pipeline:

1. A hidden player acquires the track by hopping the scrubber to the buffered
   edge while paused, which pulls a four minute song in about eleven seconds.
   Playing it through at 16x takes three times as long, because a playhead both
   consumes the buffer it is building and caps the fetch rate at what it can
   traverse.
2. The captured audio is decoded and handed to htdemucs, running on WebGPU in an
   offscreen document. A content script cannot spawn an extension origin worker,
   which is why the offscreen document exists at all.
3. Both stems are encoded to Opus and cached in IndexedDB, keyed by a hash of
   the audio rather than by video id, so the same recording under a different id
   is a cache hit.
4. Playback is two `AudioBufferSourceNode`s through two gains, following the
   player's own transport. The original is silenced with a gain of zero and
   never by disconnecting it, because a disconnected source stalls the element
   behind it and YouTube Music then throws that element away.

The model is 170 MB and downloads once, from
`models.betterlyrics.org`. It is fp32 on purpose: htdemucs overflows fp16's
65504 ceiling and returns NaN, which the Opus encoder then turns into perfect
silence. That bug took a while to find, so the fp16 export is not an option in
the settings.

## Install from source

```bash
git clone https://github.com/better-lyrics/tacet
cd tacet
npm install
npm run build
```

Then open `chrome://extensions/`, turn on developer mode, choose "Load
unpacked", and select `build/chrome-mv3-prod`.

Sing-along is off until you turn it on, from the extension popup. The first
track you enable it for will download the model.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Sing-along | off | The master switch. Off means no audio graph is built at all |
| Separate automatically | on | Starts separating as soon as a track is captured, so the fader is ready before you reach for it |
| Cache budget | 250 MB | How much of the stem cache to keep. Oldest goes first |

## Development

```bash
npm run dev        # Plasmo, with hot reload
npm run test       # vitest
npm run typecheck
npm run lint
```

The pure logic is tested and the impure edges are not: decisions like which
element to bind, whether to reuse an in flight capture, and how the fader maps
to gains all live in their own modules with tests, while Web Audio and the DOM
stay in thin wrappers around them. If you are changing behaviour, the test is
usually the smaller file next to the one you are editing.

`window.blkKaraokeProbe()` in the page console reports what actually reached Web
Audio: which element the graph is bound to, whether it is engaged, the gain
values, and the RMS of the instrumental buffer that is loaded. Measure with it
rather than trusting a log line. Every check in this project stayed green
through a bug that produced pure silence.

## Acknowledgements

[htdemucs](https://github.com/adefossez/demucs) by Alexandre Défossez and
contributors is the separation model. The ONNX export follows
[sevagh/demucs.onnx](https://github.com/sevagh/demucs.onnx).
