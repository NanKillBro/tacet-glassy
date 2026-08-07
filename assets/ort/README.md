# ORT assets

The `.wasm` files in this directory are gitignored because of their size. The `.mjs`
loaders and the WebGPU bundle are committed since they are small and reviewable.

`onnxruntime-web` is pinned as an exact-version devDependency (`package.json`), used
only as the source for these assets, nothing imports it. Repopulate the `.wasm`
files with:

```sh
npm install
npm run sync:ort
```

This pulls in every `ort-wasm-simd-threaded*` variant (default, `.jsep`, `.jspi`,
`.asyncify`) plus their `.mjs` loaders and the WebGPU entry bundle. The worker only
loads the `.asyncify` variant at runtime, but all four are copied so the wasmPaths
prefix resolves regardless of which build ends up in use.

The pinned version and the `.mjs` loaders committed here must move together: a
mismatched `sync:ort` run produces loader/binary skew that ONNX Runtime reports as
an unhelpful `no available backend found` rather than a version error. Bump the
`package.json` version and re-run `sync:ort` in the same change.

`LICENSE` in this directory is onnxruntime-web's upstream MIT licence, covering the
`.mjs` and `.wasm` artefacts committed here.
