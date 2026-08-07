import { SEGMENT_SAMPLES } from "@/separation/chunker";

// Pure layout construction for HTDemucs's "input" tensor, [1, 2, 343980],
// laid out [L..., R...]. Split out of the worker's chunk loop so it is
// testable without ORT or WebGPU; the worker wraps the returned Float32Array
// in an ort.Tensor.

function buildWaveformTensorData(chunkChannels: Float32Array[]): Float32Array {
  if (chunkChannels.length !== 2) {
    throw new Error(`waveform-tensor: expects stereo input (got ${chunkChannels.length} channels)`);
  }

  const [left, right] = chunkChannels;
  if (left.length !== SEGMENT_SAMPLES || right.length !== SEGMENT_SAMPLES) {
    throw new Error(`waveform-tensor: expects SEGMENT_SAMPLES (${SEGMENT_SAMPLES}) samples per channel`);
  }

  const flat = new Float32Array(2 * SEGMENT_SAMPLES);
  flat.set(left, 0);
  flat.set(right, SEGMENT_SAMPLES);
  return flat;
}

export { buildWaveformTensorData };
