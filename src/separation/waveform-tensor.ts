import { SEGMENT_SAMPLES } from "@/separation/chunker";

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
