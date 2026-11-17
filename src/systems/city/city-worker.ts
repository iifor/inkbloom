// Works out a city off the main thread: its layout (roads, blocks, buildings, surfaces) and the
// geometry and colliders buildCity makes from it. The main thread asks as soon as a city's
// town comes near, so by the time the player walks up to it nothing is left to compute.
// Same code, same seed: the result is identical to building it on the main thread.
import type { BuiltCity } from '@/game/types';
import { type CityLayout, townLayout } from '@/world/city/layout';
import { type Entrance, type Wilderness, createWilderness } from '@/world/wilderness/generator';
import { type GeometryBuilder, geometryData } from '@/engine/render/geometry-builder';
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
  const transfer: ArrayBuffer[] = [];
  const pack = (g: GeometryBuilder) => {
    const packed = geometryData(g.build());
    transfer.push(...packed.transfer);
    return packed.data;
  };
  const tiles = buildCity(layout, {
    addBox: (group, min, max, data = {}) => boxes.push({ group, min: { ...min }, max: { ...max }, data }),
  }).map((t) => ({ full: pack(t.full), far: pack(t.far) }));
  const result: CityResult = { cityId, layout, built: { tiles, boxes } };
  (self as unknown as Worker).postMessage(result, transfer);
});
