# ORT assets

The `.wasm` files in this directory are gitignored because of their size. The `.mjs`
loaders and the WebGPU bundle are committed since they are small and reviewable.

Repopulate from a local `onnxruntime-web@1.26.0` install with:

```sh
SRC=node_modules/onnxruntime-web/dist
DST=assets/ort
cp "$SRC/ort.webgpu.bundle.min.mjs" "$DST/"
cp $SRC/ort-wasm*.mjs "$DST/"
cp $SRC/ort-wasm*.wasm "$DST/"
```

This pulls in every `ort-wasm-simd-threaded*` variant (default, `.jsep`, `.jspi`,
`.asyncify`) plus their `.mjs` loaders and the WebGPU entry bundle. The worker only
loads the `.asyncify` variant at runtime, but all four are copied so the wasmPaths
prefix resolves regardless of which build ends up in use.
