import type * as THREE from 'three';
import { RESIDENT_NAMES } from '@/content/names';
import type { GameContext } from '@/game/types';
import {
  familyKey,
  returnedCount,
  returnTime,
  type Homecomings,
  type ReturningFamily,
} from '@/world/city/homecoming';
import type { Entrance } from '@/world/wilderness/generator';
import { doorFront } from '@/world/city/features';
import { type CityLayout, groundAt } from '@/world/city/layout';
import { hashInts } from '@/world/math/hash';
import type { Farmstead } from '@/world/wilderness/farmsteads';
import { ResidentFigure } from '@/systems/figures/kaykit-villager';
import {
  loadResident,
  modelForResident,
  residentInfo,
  residentMotions,
} from '@/systems/figures/resident-models';

import {
  MAX_ROAM,
  outingTime,
  planOuting,
  residentPose,
  type Neighbourhood,
  type Outing,
} from '@/world/city/resident-routine';

interface ResidentSpot {
  since?: number;
  x: number;
  y: number;
  z: number;
  angle: number;
  name: string;
  seed: number;
}

function atTownHouse(layout: CityLayout, b: CityLayout['buildings'][number], slot: number) {
  const at = doorFront(b, 1.9 + Math.floor(slot / 2) * 1.4);
  const offset = slot % 2 ? -1.25 : 0.95;
  at.x += Math.cos(b.angle) * offset;
  at.z -= Math.sin(b.angle) * offset;
  return { ...at, y: groundAt(layout, at.x, at.z), angle: b.angle };
}

export function townResidents(layout: CityLayout): ResidentSpot[] {
  const household = new Map<number, number>();
  return layout.residents.map((resident, i) => {
    const slot = household.get(resident.building) ?? 0;
    household.set(resident.building, slot + 1);
    return {
      ...atTownHouse(layout, layout.buildings[resident.building]!, slot),
      name: resident.name,
      seed: (layout.seed >>> 0) + i,
    };
  });
}

function familyMember(farmSeed: number, building: number, slot: number) {
  const seed = hashInts(farmSeed, building, slot);
  return { seed, name: RESIDENT_NAMES[seed % RESIDENT_NAMES.length]! };
}

function resettledFamilies(
  layout: CityLayout,
  families: readonly ReturningFamily[],
  restoredAt: number,
): ResidentSpot[][] {
  const studios = new Set(layout.studios.map((s) => s.building));
  const homes = layout.buildings.filter((b) => !studios.has(b.id));
  if (!homes.length) homes.push(...layout.buildings);
  homes.sort(
    (a, b) =>
      Math.hypot(a.x - layout.spawn.x, a.z - layout.spawn.z) -
      Math.hypot(b.x - layout.spawn.x, b.z - layout.spawn.z),
  );
  const occupancy = new Map<number, number>();
  return families.map((family, i) => {
    const home = homes[i % homes.length];
    const used = home ? (occupancy.get(home.id) ?? 0) : 0;
    if (home) occupancy.set(home.id, used + family.members);
    return Array.from({ length: family.members }, (_, slot) => {
      const x = layout.square.x + 2 * (slot - 1),
        z = layout.square.z + i * 1.5;
      const pos = home
        ? atTownHouse(layout, home, used + slot)
        : { x, z, y: groundAt(layout, x, z), angle: 0 };
      return {
        ...pos,
        since: returnTime(restoredAt, i),
        ...familyMember(family.farmSeed, family.building, slot),
      };
    });
  });
}

const empty: ResidentSpot[] = [];

export function villagePopulation(ctx: GameContext, layout: CityLayout, town: Entrance, moves: Homecomings) {
  let locals: ResidentSpot[] | undefined;
  let returning: ResidentSpot[][] = [];
  let restoredAt: number | null = null;
  let count = -1;
  let present = empty;
  return () => {
    const saved = ctx.state.cities.get(layout.id);
    if (saved?.peaceful) return (locals ??= townResidents(layout));
    if (!saved?.completed || saved.restoredAt === null) return empty;
    const plan = moves.plan(town);
    if (!plan) return empty;
    if (restoredAt !== saved.restoredAt) {
      restoredAt = saved.restoredAt;
      returning = resettledFamilies(layout, plan.families, restoredAt);
      count = -1;
    }
    const arrived = returnedCount(ctx.state.clock, saved.restoredAt, returning.length);
    if (arrived !== count) {
      count = arrived;
      present = returning.slice(0, count).flat();
    }
    return present;
  };
}

export function farmPopulation(ctx: GameContext, farm: Farmstead, moves: Homecomings) {
  const groups = farm.buildings.map((b, i) =>
    Array.from({ length: b.residents }, (_, slot) => {
      const x = b.x + (slot % 2 ? -1.8 : 1.8);
      const z = b.z + farm.front * (b.hd + 1.3 + Math.floor(slot / 2) * 1.4);
      return {
        x,
        y: ctx.wilderness.heightAt(x, z),
        z,
        angle: farm.front === 1 ? 0 : Math.PI,
        ...familyMember(farm.seed, i, slot),
      };
    }),
  );
  const everyone = groups.flat();
  const town = farm.refugeFor && ctx.cities.entranceOf(farm.refugeFor);
  let present = everyone;
  let count = -1;
  return () => {
    if (!town) return everyone;
    const saved = ctx.state.cities.get(town.cityId);
    if (!saved?.completed || saved.peaceful) return everyone;
    const plan = moves.plan(town);
    if (!plan) return returnedCount(ctx.state.clock, saved.restoredAt, 1) ? empty : everyone;
    const arrived = returnedCount(ctx.state.clock, saved.restoredAt, plan.families.length);
    if (arrived !== count) {
      count = arrived;
      present = groups.flatMap((group, i) =>
        (plan.order.get(familyKey(farm.buildings[i]!)) ?? Infinity) < arrived ? [] : group,
      );
    }
    return present;
  };
}

function occupation(spot: ResidentSpot) {
  return residentInfo(modelForResident(spot.seed)).profession ?? 'villager';
}

/** Keep the population deterministic, and only allocate animated models in the player's neighbourhood. */
export class Residents {
  private actors = new Map<ResidentSpot, ResidentFigure>();
  private wanted = new Set<ResidentSpot>();
  private loading = new Set<ResidentSpot>();
  private failed = new Set<ResidentSpot>();
  private routes = new WeakMap<ResidentSpot, { shift: number; outing: Outing }>();
  private toPlan: ResidentSpot[] = [];
  private area?: Neighbourhood;
  private refreshIn = 0;
  private spots: ResidentSpot[] = empty;
  constructor(
    private readonly ctx: GameContext,
    private readonly population: () => ResidentSpot[],
    private readonly root: THREE.Object3D,
    private readonly neighbourhood: () => Neighbourhood,
  ) {}

  update(dt: number): void {
    if (typeof window === 'undefined') return;
    const player = this.ctx.player.position;
    this.refreshIn -= dt;
    const spots = this.population();
    const clock = this.ctx.state.clock;
    if (spots !== this.spots || this.refreshIn <= 0) {
      this.spots = spots;
      this.refreshIn = 0.35;
      const candidates = spots
        .map((spot) => ({ spot, d: (spot.x - player.x) ** 2 + (spot.z - player.z) ** 2 }))
        .filter((entry) => entry.d <= (MAX_ROAM + 100) ** 2)
        .sort((a, b) => a.d - b.d);
      this.toPlan = [];
      const near: { spot: ResidentSpot; d: number }[] = [];
      for (const { spot } of candidates) {
        const time = outingTime(spot, clock);
        const route = this.routes.get(spot);
        if (!route || route.shift !== time.shift) {
          this.toPlan.push(spot);
          if (!this.actors.has(spot)) continue;
        }
        const pose =
          route?.shift === time.shift ? residentPose(spot, occupation(spot), route.outing, time.phase) : spot;
        const d = (pose.x - player.x) ** 2 + (pose.z - player.z) ** 2;
        if (d < 100 ** 2) near.push({ spot, d });
      }
      near.sort((a, b) => a.d - b.d);
      near.length = Math.min(near.length, 32);
      this.wanted = new Set(near.map((s) => s.spot));
      for (const [spot, actor] of this.actors) {
        if (!this.wanted.has(spot)) {
          actor.dispose();
          this.actors.delete(spot);
        }
      }
    }
    // Budget path searches separately from model loads in large towns.
    const next = this.toPlan.shift();
    if (next) {
      this.area ??= this.neighbourhood();
      const { shift } = outingTime(next, clock);
      this.routes.set(next, { shift, outing: planOuting(this.area, next, occupation(next), shift) });
    }
    // Spread skeleton creation across frames when entering a dense settlement.
    for (const spot of this.wanted) {
      if (this.loading.size) break;
      if (this.actors.has(spot) || this.failed.has(spot)) continue;
      const variant = modelForResident(spot.seed);
      this.loading.add(spot);
      void loadResident(variant)
        .then((source) => {
          if (!this.wanted.has(spot)) return;
          const actor = new ResidentFigure(
            source,
            (spot.seed % 100) * 0.37,
            residentMotions(variant),
            spot.seed,
          );
          actor.root.position.set(spot.x, spot.y, spot.z);
          actor.root.rotation.y = spot.angle;
          Object.assign(actor.root.userData, {
            resident: spot.name,
            variant,
            profession: residentInfo(variant).profession,
          });
          this.root.add(actor.root);
          this.actors.set(spot, actor);
        })
        .catch((error) => {
          this.failed.add(spot);
          console.warn('村民模型加载失败', error);
        })
        .finally(() => this.loading.delete(spot));
      break;
    }
    for (const [spot, actor] of this.actors) {
      const route = this.routes.get(spot);
      const time = outingTime(spot, clock);
      const pose =
        route?.shift === time.shift
          ? residentPose(spot, occupation(spot), route.outing, time.phase)
          : { ...spot, motion: 'idle' as const };
      const y =
        pose.motion === 'idle' && pose.x === spot.x && pose.z === spot.z
          ? spot.y
          : this.area!.ground(pose.x, pose.z);
      actor.root.position.set(pose.x, y, pose.z);
      actor.root.rotation.y = pose.angle;
      actor.update(dt, actor.root.position.distanceToSquared(player) < 3.5 ** 2, pose.motion);
    }
  }

  dispose(): void {
    this.wanted.clear();
    for (const actor of this.actors.values()) actor.dispose();
    this.actors.clear();
  }
}
