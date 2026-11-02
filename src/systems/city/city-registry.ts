// City skeletons are deterministic, so they are generated on demand and cached for the session.
import type { CityApi, GameContext } from '@/game/types';
import { type CityLayout, generateCity } from '@/world/city/layout';
import { TUNING } from '@/content/tuning';
import { savedProgress } from '@/world/state';
import type { Entrance } from '@/world/wilderness/generator';

export class CityRegistry implements CityApi {
  private readonly layouts = new Map<string, CityLayout>();
  private readonly entrances = new Map<string, Entrance>();

  constructor(private readonly ctx: GameContext) {}

  layout(entrance: Entrance): CityLayout {
    let l = this.layouts.get(entrance.cityId);
    if (!l) {
      l = generateCity(entrance.cityId, entrance.seed);
      this.layouts.set(entrance.cityId, l);
      this.entrances.set(entrance.cityId, entrance);
    }
    return l;
  }

  byId(id: string): CityLayout | undefined {
    return this.layouts.get(id);
  }

  entranceOf(id: string): Entrance | undefined {
    if (this.entrances.has(id)) return this.entrances.get(id);
    // ids are "c<cx>_<cz>": find the entrance by looking at that chunk's grid cell
    const m = /^c(-?\d+)_(-?\d+)$/.exec(id);
    if (!m) return undefined;
    const size = TUNING.world.chunkSize;
    const e = this.ctx.wilderness
      .entrancesNear((Number(m[1]) + 0.5) * size, (Number(m[2]) + 0.5) * size, 0)
      .find((x) => x.cityId === id);
    if (e) this.entrances.set(id, e);
    return e;
  }

  progress(id: string): number {
    return savedProgress(this.ctx.state, id);
  }
}
