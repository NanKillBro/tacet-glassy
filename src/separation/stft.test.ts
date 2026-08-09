// Vendored from composer src/audio/separation/stft.test.ts @ 30f0e2e

import { N_FFT, reflectPad, istft, stft } from "@/separation/stft";
import { describe, expect, it } from "vitest";

function directDft(frame: Float32Array, bin: number): { real: number; imag: number } {
  const n = frame.length;
  let real = 0;
  let imag = 0;
  for (let i = 0; i < n; i++) {
    const angle = (-2 * Math.PI * bin * i) / n;
    real += frame[i] * Math.cos(angle);
    imag += frame[i] * Math.sin(angle);
  }
  return { real, imag };
}

function rms(a: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * a[i];
  return Math.sqrt(sum / a.length);
}

function diffRms(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum / n);
}

describe("stft", () => {
  it("round-trips a sine wave with low RMS error", () => {
    const sr = 44100;
    const length = 32768;
    const signal = new Float32Array(length);
    for (let i = 0; i < length; i++) signal[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5;

    const spec = stft(signal);
    const reconstructed = istft(spec, length);
    expect(reconstructed.length).toBe(length);

    const pad = 8192;
    const a = signal.subarray(pad, length - pad);
    const b = reconstructed.subarray(pad, length - pad);
    const err = diffRms(a, b);
    const ref = rms(a);
    expect(err / ref).toBeLessThan(0.05);
  });

  it("round-trips a normalized spectrogram without losing amplitude", () => {
    const sr = 44100;
    const length = 32768;
    const signal = new Float32Array(length);
    for (let i = 0; i < length; i++) signal[i] = Math.sin((2 * Math.PI * 880 * i) / sr) * 0.25;

    const spec = stft(signal, { normalized: true });
    const reconstructed = istft(spec, length, { normalized: true });

    const pad = 8192;
    const a = signal.subarray(pad, length - pad);
    const b = reconstructed.subarray(pad, length - pad);
    const err = diffRms(a, b);
    const ref = rms(a);
    expect(err / ref).toBeLessThan(0.05);
    expect(rms(b) / ref).toBeGreaterThan(0.95);
  });
});

describe("invariants", () => {
  it("agrees with a direct DFT of the first windowed frame", () => {
    const length = N_FFT * 2;
    const signal = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      signal[i] = Math.sin((2 * Math.PI * 97 * i) / length) * 0.6 + Math.sin((2 * Math.PI * 613 * i) / length) * 0.3;
    }

    const spec = stft(signal);

    const padded = reflectPad(signal, N_FFT / 2, N_FFT / 2);
    const window = new Float32Array(N_FFT);
    for (let i = 0; i < N_FFT; i++) window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N_FFT));
    const frame = new Float32Array(N_FFT);
    for (let i = 0; i < N_FFT; i++) frame[i] = padded[i] * window[i];

    for (const bin of [0, 1, 97, 613, 1024, N_FFT / 2]) {
      const expected = directDft(frame, bin);
      expect(spec.real[bin]).toBeCloseTo(expected.real, 1);
      expect(spec.imag[bin]).toBeCloseTo(expected.imag, 1);
    }
  });

  it("keeps the twiddle table consistent across FFT lengths", () => {
    const short = new Float32Array(1024);
    for (let i = 0; i < short.length; i++) short[i] = Math.sin(i * 0.05);
    const first = stft(short, { normalized: true });
    const second = stft(short, { normalized: true });
    expect(Array.from(second.real)).toEqual(Array.from(first.real));
    expect(Array.from(second.imag)).toEqual(Array.from(first.imag));
  });
});
