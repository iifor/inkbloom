// Works out a city off the main thread: its layout (roads, blocks, buildings, surfaces) and the
// geometry and colliders buildCity makes from it. The main thread asks as soon as a city's
// town comes near, so by the time the player walks up to it nothing is left to compute.
// Same code, same seed: the result is identical to building it on the main thread.
import type { BuiltCity } from '@/game/types';
import { type CityLayout, townLayout } from '@/world/city/layout';
import { type Entrance, type Wilderness, createWilderness } from '@/world/wilderness/generator';
import { buildCity } from './build-city';

export interface CityJob {
  readonly town: Entrance;
  /** The world's seed: the town is laid out on the land, which the worker works out itself. */
  readonly worldSeed: number;
}

let wilderness: Wilderness | null = null;

export interface CityResult {
  readonly cityId: string;
  readonly layout: CityLayout;
  readonly built: BuiltCity;
}

self.addEventListener('message', (event: MessageEvent<CityJob>) => {
  const { town, worldSeed } = event.data;
  if (wilderness?.seed !== worldSeed) wilderness = createWilderness(worldSeed);
  const layout = townLayout(town, wilderness);
  const cityId = layout.id;
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
