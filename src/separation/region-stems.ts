import { denormalizeDemucsOutput } from "@/separation/demucs-postprocess";
import { computeInstrumental } from "@/separation/derived-stems";

// Ties a freshly finalised StreamingStitcher region back to the original
// track: denormalizes the model's vocals output, then slices the matching
// span out of the (never normalized) original audio to derive the
// instrumental, since HTDemucs only outputs vocals. Pure and ORT-free, unlike
// the worker loop that produces vocalsRegionRaw in the first place.

interface RegionStems {
  vocals: Float32Array[];
  instrumental: Float32Array[];
}

function deriveRegionStems(
  originalChannels: Float32Array[],
  regionStart: number,
  vocalsRegionRaw: Float32Array[],
  normalization: { mean: number; std: number }
): RegionStems {
  if (vocalsRegionRaw.length !== originalChannels.length) {
    throw new Error(
      `region-stems: channel count mismatch (original ${originalChannels.length}, vocals region ${vocalsRegionRaw.length})`
    );
  }

  const regionLength = vocalsRegionRaw[0]?.length ?? 0;
  for (let c = 0; c < vocalsRegionRaw.length; c++) {
    if (vocalsRegionRaw[c].length !== regionLength) {
      throw new Error(`region-stems: vocals region channels must share the same length (channel ${c} disagrees)`);
    }
  }

  const trackLength = originalChannels[0]?.length ?? 0;
  if (regionStart < 0 || regionStart + regionLength > trackLength) {
    throw new Error(
      `region-stems: region [${regionStart}, ${regionStart + regionLength}) is out of bounds for original audio of length ${trackLength}`
    );
  }

  const vocals = denormalizeDemucsOutput(vocalsRegionRaw, normalization);
  const originalSlice = originalChannels.map(channel => channel.subarray(regionStart, regionStart + regionLength));
  const instrumental = computeInstrumental(originalSlice, vocals);

  return { vocals, instrumental };
}

export { deriveRegionStems };
export type { RegionStems };
