// City skeletons are deterministic, so they are generated on demand and cached for the session.
// Cities near the player are also worked out ahead of time in a worker (layout, geometry,
// colliders), so neither the first mention of a city's name nor walking into it stalls a frame.
import type { BuiltCity, CityApi, GameContext } from '@/game/types';
import { type CityLayout, townLayout } from '@/world/city/layout';
import { TUNING } from '@/content/tuning';
import { savedProgress } from '@/world/state';
import type { Entrance } from '@/world/wilderness/generator';
import type { CityJob, CityResult } from './city-worker';

/** Prebuilt cities kept waiting at most (a big one is ~12 MB of geometry). */
const KEEP_BUILT = 2;

export class CityRegistry implements CityApi {
  private readonly layouts = new Map<string, CityLayout>();
  private readonly entrances = new Map<string, Entrance>();
  /** Finished in the worker and not yet taken, oldest first. */
  private readonly built = new Map<string, BuiltCity>();
  private readonly pending = new Set<string>();
  private worker: Worker | null = null;
  /** A worker that failed once is not tried again this session. */
  private workerFailed = false;

  constructor(private readonly ctx: GameContext) {}

  prefetch(entrance: Entrance): void {
    const id = entrance.cityId;
    if (this.pending.has(id) || this.built.has(id)) return;
    const worker = this.ensureWorker();
    // no workers (tests): there is nothing to gain by building early on the main thread
    if (!worker) return;
    this.entrances.set(id, entrance);
    this.pending.add(id);
    const job: CityJob = {
      town: entrance,
      worldSeed: this.ctx.wilderness.seed,
      terrainVersion: this.ctx.wilderness.terrainVersion,
      legacyTowns: this.ctx.wilderness.legacyTowns,
    };
    worker.postMessage(job);
  }

  nameOf(entrance: Entrance): string | null {
    const l = this.layouts.get(entrance.cityId);
    if (l) return l.name;
    this.prefetch(entrance);
    return null;
  }

  ready(id: string): boolean {
    return this.built.has(id);
  }

  takeBuilt(id: string): BuiltCity | undefined {
    const b = this.built.get(id);
    this.built.delete(id);
    return b;
  }

  private ensureWorker(): Worker | null {
    if (this.worker || this.workerFailed || typeof Worker === 'undefined') return this.worker;
    this.worker = new Worker(new URL('./city-worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (event: MessageEvent<CityResult>) => {
      const { cityId, layout, built } = event.data;
      this.pending.delete(cityId);
      // a layout made on the main thread meanwhile is identical; keep whichever came first
      if (!this.layouts.has(cityId)) this.layouts.set(cityId, layout);
      this.built.set(cityId, built);
      while (this.built.size > KEEP_BUILT) this.built.delete(this.built.keys().next().value!);
    });
    this.worker.addEventListener('error', (e) => {
      // building on the main thread still works; just stop asking the worker
      console.warn('city worker failed; cities will be built when entered', e.message);
      this.worker?.terminate();
      this.worker = null;
      this.workerFailed = true;
      this.pending.clear();
    });
    return this.worker;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  layout(entrance: Entrance): CityLayout {
    let l = this.layouts.get(entrance.cityId);
    if (!l) {
      l = townLayout(entrance, this.ctx.wilderness);
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
