interface RegionAccumulator {
  vocals: Float32Array[];
  instrumental: Float32Array[];
  addRegion(regionStart: number, vocals: Float32Array[], instrumental: Float32Array[]): void;
}

function createRegionAccumulator(totalFrames: number, channelCount: number): RegionAccumulator {
  const vocals = Array.from({ length: channelCount }, () => new Float32Array(totalFrames));
  const instrumental = Array.from({ length: channelCount }, () => new Float32Array(totalFrames));

  function addRegion(regionStart: number, vocalsRegion: Float32Array[], instrumentalRegion: Float32Array[]): void {
    if (vocalsRegion.length !== channelCount || instrumentalRegion.length !== channelCount) {
      throw new Error(
        `region-accumulator: expected ${channelCount} channels, got vocals=${vocalsRegion.length} instrumental=${instrumentalRegion.length}`
      );
    }
    for (let channel = 0; channel < channelCount; channel++) {
      vocals[channel].set(vocalsRegion[channel], regionStart);
      instrumental[channel].set(instrumentalRegion[channel], regionStart);
    }
  }

  return { vocals, instrumental, addRegion };
}

export { createRegionAccumulator };
export type { RegionAccumulator };
