// What applyPatch needs to know about the world, worked out from the seed alone: town layouts,
// pigment sources, ruins and wilderness monsters. The client uses the layouts it has already
// made; the world server makes them on demand, so it can judge a patch in a town nobody has
// sent it the layout of.
import { TUNING } from '@/content/tuning';
import { type CityLayout, townLayout } from '../city/layout';
import type { PatchContext } from '../patch';
import type { Entrance, Wilderness } from '../wilderness/generator';
import { ruinById } from '../wilderness/ruins';
import { sourceById } from '../wilderness/sources';
import { chunkSaturation, wildMonsterById } from '../wilderness/wild-monsters';

/** A town's entrance from its id ("c<cx>_<cz>", the chunk its tower stands in). */
export function entranceById(wilderness: Wilderness, id: string): Entrance | null {
  const m = /^c(-?\d+)_(-?\d+)$/.exec(id);
  if (!m) return null;
  const size = TUNING.world.chunkSize;
  return (
    wilderness
      .entrancesNear((Number(m[1]) + 0.5) * size, (Number(m[2]) + 0.5) * size, 0)
      .find((x) => x.cityId === id) ?? null
  );
}

export function worldPatchContext(
  wilderness: Wilderness,
  layoutOf: (id: string) => CityLayout | null,
  progressOf: (id: string) => number,
): PatchContext {
  return {
    cityOf: layoutOf,
    sourceOf: (id) => sourceById(wilderness, id),
    ruinOf: (id) => ruinById(wilderness, id),
    wildMonsterOf: (id) => {
      const m = /^(-?\d+),(-?\d+):/.exec(id);
      if (!m) return null;
      const sat = chunkSaturation(wilderness, Number(m[1]), Number(m[2]), progressOf);
      return wildMonsterById(wilderness, id, sat);
    },
  };
}

/** Layouts made on demand and kept (the server's way: it has no prefetching worker). */
export function layoutCache(wilderness: Wilderness): (id: string) => CityLayout | null {
  const cache = new Map<string, CityLayout | null>();
  return (id) => {
    if (!cache.has(id)) {
      const e = entranceById(wilderness, id);
      cache.set(id, e ? townLayout(e, wilderness) : null);
    }
    return cache.get(id)!;
  };
}
