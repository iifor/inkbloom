// Works out a city off the main thread: its layout (roads, blocks, buildings, surfaces) and the
// geometry and colliders buildCity makes from it. The main thread asks as soon as a city's
// tower comes into view, so by the time the player walks in nothing is left to compute.
// Same code, same seed: the result is identical to building it on the main thread.
import type { BuiltCity } from '@/game/types';
import { type CityLayout, generateCity } from '@/world/city/layout';
import { buildCity } from './build-city';

export interface CityJob {
  readonly cityId: string;
  readonly seed: number;
  readonly chunks: number;
}

export interface CityResult {
  readonly cityId: string;
  readonly layout: CityLayout;
  readonly built: BuiltCity;
}

self.addEventListener('message', (event: MessageEvent<CityJob>) => {
  const { cityId, seed, chunks } = event.data;
  const layout = generateCity(cityId, seed, chunks);
  const boxes: BuiltCity['boxes'][number][] = [];
  const geometry = buildCity(layout, {
    addBox: (group, min, max, data = {}) => boxes.push({ group, min: { ...min }, max: { ...max }, data }),
  }).build();
  const attributes: Record<string, { array: Float32Array; itemSize: number }> = {};
  const transfer: ArrayBuffer[] = [];
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const array = attr.array as Float32Array;
    attributes[name] = { array, itemSize: attr.itemSize };
    transfer.push(array.buffer as ArrayBuffer);
  }
  const result: CityResult = { cityId, layout, built: { attributes, boxes } };
  (self as unknown as Worker).postMessage(result, transfer);
});
