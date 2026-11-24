// Only the first restoration time needs saving. The same real farm plots, order and
// world clock reproduce the address of every family after a reload or on another client.
import { TUNING } from '@/content/tuning';
import { type WorldState, peacefulVillage } from '../state';
import { ruralSites } from '../wilderness/chunk';
import { OUTSKIRTS_RANGE } from '../wilderness/farmsteads';
import type { Entrance, Wilderness } from '../wilderness/generator';

export interface ReturningFamily {
  key: string;
  farmSeed: number;
  building: number;
  members: number;
  distance: number;
}

export function familyKey(home: { x: number; z: number }): string {
  return `${home.x},${home.z}`;
}

const FIRST_RETURN = 30;
const RETURN_INTERVAL = 60;
export function returnTime(restoredAt: number, index: number): number {
  return restoredAt + FIRST_RETURN + RETURN_INTERVAL * index;
}

export function returnedCount(clock: number, restoredAt: number | null, families: number): number {
  if (restoredAt === null || clock < restoredAt + FIRST_RETURN) return 0;
  return Math.min(families, 1 + Math.floor((clock - restoredAt - FIRST_RETURN) / RETURN_INTERVAL));
}

function* census(w: Wilderness, town: Entrance, peaceful: (id: string) => boolean) {
  const families: ReturningFamily[] = [];
  const size = TUNING.world.chunkSize;
  for (
    let cx = Math.floor((town.ox - OUTSKIRTS_RANGE) / size);
    cx <= Math.floor((town.ox + town.size + OUTSKIRTS_RANGE) / size);
    cx++
  )
    for (
      let cz = Math.floor((town.oz - OUTSKIRTS_RANGE) / size);
      cz <= Math.floor((town.oz + town.size + OUTSKIRTS_RANGE) / size);
      cz++
    ) {
      const { farmstead } = yield* ruralSites(w, cx, cz, peaceful);
      if (farmstead?.refugeFor !== town.cityId) continue;
      farmstead.buildings.forEach((b, i) => {
        if (b.residents)
          families.push({
            key: familyKey(b),
            farmSeed: farmstead.seed,
            building: i,
            members: b.residents,
            distance: Math.hypot(town.x - b.x, town.z - b.z),
          });
      });
    }
  return families.sort(
    (a, b) => a.distance - b.distance || a.building - b.building || a.farmSeed - b.farmSeed,
  );
}

export interface HomecomingPlan {
  families: ReturningFamily[];
  order: Map<string, number>;
}

export class Homecomings {
  private readonly plans = new Map<string, HomecomingPlan>();
  private readonly pending = new Map<string, ReturnType<typeof census>>();
  constructor(
    private readonly world: Wilderness,
    private readonly state: WorldState,
  ) {}

  plan(town: Entrance): HomecomingPlan | undefined {
    const ready = this.plans.get(town.cityId);
    if (!ready && !this.pending.has(town.cityId))
      this.pending.set(
        town.cityId,
        census(this.world, town, (id) => peacefulVillage(this.state, id)),
      );
    return ready;
  }

  /** Survey a little each frame, even when the outskirts have never been streamed. */
  update(): void {
    if (!this.pending.size) return;
    const until = performance.now() + 2;
    for (const [id, scan] of this.pending) {
      do {
        const step = scan.next();
        if (step.done) {
          const families = step.value;
          this.plans.set(id, { families, order: new Map(families.map((f, i) => [f.key, i])) });
          this.pending.delete(id);
          break;
        }
      } while (performance.now() < until);
      if (performance.now() >= until) break;
    }
  }
}
