// The infinite wilderness. Streams chunks around the player (one build per frame so walking
// never hitches), owns their colliders (and, while they stand, the towns'), registers each
// pigment source as an interactable, and hosts the monsters that roam drained land (and guard
// its ink wells) and the deer that graze the rest.
import { pathsOf } from '@/world/wilderness/paths';
import { SPAWN_CENTER } from '@/world/wilderness/spawn-circle';
import * as THREE from 'three';
import { SEASONS } from '@/content/seasons';
import { TUNING } from '@/content/tuning';
import { PhysicsWorld } from '@/engine/physics/world';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { makeInkMaterial, shared } from '@/engine/render/ink-material';
import { disposeTree } from '@/engine/resources';
import type { GameContext, GameScene } from '@/game/types';
import { calendarAt, calendarClock, grassCoverAt, seasonBlend } from '@/world/climate/calendar';
import { villageLawnKind } from '@/world/city/lawn';
import { chunkKey, generateWildChunkSteps } from '@/world/wilderness/chunk';
import { waterCurrentsOf } from '@/world/wilderness/water-current';
import { buildTerrainSteps, addChunkColliders } from './build-chunk';
import { WildTrees } from './wild-trees';
import { WildSources } from './pigment-sources';
import { WildMonsterCamps } from './wild-monster-camps';
import { WildRuins, buildRuin } from './ruins';
import { WildMarks } from './marks';
import { WildFish } from './fish';
import { Waterweed } from './waterweed';
import { GrassField } from './grass';
import { WildDeer } from './deer';
import { WildInkWells } from './ink-wells';
import { WindFlags } from '@/engine/render/wind-flags';
import { lookoutFlag } from './build-landmarks';
import { DistantTerrain } from './distant-terrain';
import { buildFarmstead } from './build-farmstead';
import { mountFarmDoor } from './farm-door';

interface Loaded {
  readonly mesh: THREE.Mesh;
  readonly release: (() => void)[];
}

const W = TUNING.world;
/** The velocity texture covers four bands on each axis. */
const RIVER_BAND = 192;
/** Offsets (metres) round a grass tuft that must all be clear of paving, houses and water. */
const LAWN_CLEAR = [
  [0, 0],
  [0.6, 0],
  [-0.6, 0],
  [0, 0.6],
  [0, -0.6],
] as const;
/** Milliseconds a frame spent building the next chunk. */
const BUILD_MS = 2;

export class WildScene implements GameScene {
  readonly ref = { kind: 'wild' } as const;
  readonly name = '野外';
  readonly root = new THREE.Group();
  readonly physics = new PhysicsWorld(8);
  private readonly material = makeInkMaterial();
  private readonly trees = new WildTrees(this.root);
  private readonly landscape: DistantTerrain;
  private readonly loaded = new Map<string, Loaded>();
  /** The chunk being built a little each frame, if any; see update(). */
  private building: { readonly key: string; readonly steps: Generator<void, void, void> } | null = null;
  private drainT = 0;
  private readonly sources: WildSources;
  readonly monsters: WildMonsterCamps;
  private readonly ruins: WildRuins;
  private readonly marks: WildMarks;
  private readonly deer: WildDeer;
  private readonly wells: WildInkWells;
  private readonly grass: GrassField;
  private readonly flags: WindFlags;
  private readonly fish = new WildFish(this.root, (x, z) => this.ctx.renderer.ripple(x, z, false));
  private readonly weed = new Waterweed(this.root);
  private nextWake = 0;
  /** Towns near by that were laid out when the grass was last laid (see update). */
  private lawns = '';
  /** Where the renderer's river table was last made for (see updateRivers). */
  private riverX = NaN;
  private riverZ = NaN;
  private readonly offStroke: () => void;

  constructor(private readonly ctx: GameContext) {
    this.root.name = 'wild';
    this.landscape = new DistantTerrain(ctx.wilderness, this.root);
    // rolling hills: bodies stand on the height function itself, not on colliders
    this.physics.ground = (x, z) => ctx.wilderness.heightAt(x, z);
    this.grass = new GrassField(ctx.wilderness, this.root, ctx.renderer.camera, (x, z) => this.lawnAt(x, z));
    this.sources = new WildSources(ctx, this.material, this.root, this.grass.windMap);
    this.flags = new WindFlags(this.root, ctx.wilderness.seed, this.grass.windMap);
    this.monsters = new WildMonsterCamps(ctx, this.physics, this.root, this.material);
    this.ruins = new WildRuins(ctx, this.material, this.root);
    this.marks = new WildMarks(ctx, this.material, this.root);
    this.deer = new WildDeer(ctx, this.root, this.material);
    this.wells = new WildInkWells(ctx, this.material, this.root);
    this.offStroke = ctx.events.on('player:stroke', ({ hands }) => {
      for (const h of hands) ctx.renderer.ripple(h.x, h.z, true);
    });
  }

  spawn(): { pos: THREE.Vector3; yaw: number } {
    const x = SPAWN_CENTER;
    const z = SPAWN_CENTER;
    this.ensureAt(x, z);
    const w = this.ctx.wilderness;
    const road = pathsOf(w)
      .trailsNear(x, z, x + 8, z)
      .find((trail) => trail.id === 'spawn');
    const town = w.entranceInCell(0, 0);
    const aheadX = road?.pts[4] ?? town?.x ?? x;
    const aheadZ = road?.pts[5] ?? town?.z ?? z - 1;
    return { pos: new THREE.Vector3(x, w.heightAt(x, z) + 0.16, z), yaw: Math.atan2(x - aheadX, z - aheadZ) };
  }

  /**
   * Whether grass grows at (x, z) in a town: on its green ground (the verges either side of
   * the paving, plain ground, grass-coloured yards), and raggedly a little way onto a bare yard
   * where it meets them, but a step clear of paving, houses and water. Only towns already laid
   * out count (nothing is worked out here but the paving map, once a town).
   */
  private lawnAt(x: number, z: number): boolean {
    const e = this.ctx.wilderness.townAt(x, z, 1);
    const l = e && this.ctx.cities.byId(e.cityId);
    if (!l) return false;
    const kind = (px: number, pz: number) => villageLawnKind(l, px, pz);
    let lawn = 0;
    for (const [dx, dz] of LAWN_CLEAR) {
      const k = kind(x + dx, z + dz);
      if (k < 0) return false;
      lawn += k;
    }
    if (kind(x, z) === 1) return true;
    // a bare yard: the green next door creeps over its edge, more where more of it is near
    const ragged = 0.5 + 0.5 * Math.sin(x * 2.3 + z * 1.7) * Math.sin(x * 0.9 - z * 2.9);
    return lawn >= 2 && ragged < (lawn - 1) / 4;
  }

  /** Synchronously build the chunk under a point (used before placing the player). */
  ensureAt(x: number, z: number): void {
    this.load(Math.floor(x / W.chunkSize), Math.floor(z / W.chunkSize));
  }

  update(dt: number): void {
    const p = this.ctx.player.position;
    const pcx = Math.floor(p.x / W.chunkSize);
    const pcz = Math.floor(p.z / W.chunkSize);
    // keep building the chunk under way, a couple of milliseconds a frame
    if (this.building) {
      const until = performance.now() + BUILD_MS;
      while (performance.now() < until)
        if (this.building.steps.next().done) {
          this.building = null;
          break;
        }
    }
    // then start on the nearest missing chunk
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dx = -W.loadRadius; dx <= W.loadRadius; dx++)
      for (let dz = -W.loadRadius; dz <= W.loadRadius; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const k = chunkKey(cx, cz);
        if (this.loaded.has(k) || this.building?.key === k) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = [cx, cz];
        }
      }
    if (best && !this.building)
      this.building = { key: chunkKey(best[0], best[1]), steps: this.loadSteps(best[0], best[1]) };
    for (const [key, item] of this.loaded) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > W.unloadRadius) this.unload(key, item);
    }
    const phase = calendarAt(calendarClock(this.ctx.state, !!this.ctx.net)).yearPhase;
    this.landscape.update(p, this.loaded);
    const year = seasonBlend(phase);
    this.trees.update(p);
    const flowers = SEASONS[year.from]!.flowers * (1 - year.t) + SEASONS[year.to]!.flowers * year.t;
    this.grass.update(p, flowers, grassCoverAt(phase), phase);
    const t = this.ctx.state.clock;
    this.fish.update(t, p, dt);
    this.weed.update(p);
    // a swimmer's wake comes from the strokes (see the constructor); a wader's from each step
    if (this.ctx.player.waterMode === 'wading' && this.ctx.player.speed > 0.45 && t >= this.nextWake) {
      this.ctx.renderer.ripple(p.x, p.z, true);
      this.nextWake = t + 0.41;
    }
    this.updateRivers(p);
    this.sources.update(dt);
    this.flags.update(dt);
    this.monsters.update(dt);
    this.ruins.update(dt);
    this.deer.update(dt);
    this.wells.update(dt);
    this.drainT -= dt;
    if (this.drainT <= 0) {
      this.drainT = 0.5;
      this.updateDrain();
      // a town near by newly laid out: its lawns can grow grass now
      const known = this.ctx.wilderness
        .entrancesNear(p.x, p.z, 1)
        .filter((e) => this.ctx.cities.byId(e.cityId))
        .map((e) => e.cityId)
        .join();
      if (known !== this.lawns) {
        this.lawns = known;
        this.grass.invalidate();
      }
    }
  }

  /** The renderer's table of where the rivers run (for the water's current), redone when the
   * player crosses into another river's lane or another stretch of a few hundred metres. */
  private updateRivers(p: THREE.Vector3): void {
    const x0 = Math.floor(p.x / RIVER_BAND) * RIVER_BAND - RIVER_BAND * 2;
    const z0 = Math.floor(p.z / RIVER_BAND) * RIVER_BAND - RIVER_BAND * 2;
    if (x0 === this.riverX && z0 === this.riverZ) return;
    this.riverX = x0;
    this.riverZ = z0;
    const currents = waterCurrentsOf(this.ctx.wilderness);
    this.ctx.renderer.setRivers(x0, z0, (x, z) => currents.at(x, z));
  }

  /** Push nearby cities' progress into the shader so the wilderness greys around them. */
  updateDrain(): void {
    const p = this.ctx.player.position;
    const near = this.ctx.wilderness
      .entrancesNear(p.x, p.z, 1)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))
      .slice(0, TUNING.drain.maxCities);
    near.forEach((e, i) =>
      shared.uCities.value[i]!.set(e.x, e.z, this.ctx.cities.progress(e.cityId), e.size / 2),
    );
    shared.uCityCount.value = near.length;
    shared.uSceneSat.value = 1;
  }

  /** Load a chunk now, all of it (the player is about to stand there). */
  private load(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (this.loaded.has(key)) return;
    // already under way: finish that one rather than build the chunk twice
    const steps = this.building?.key === key ? this.building.steps : this.loadSteps(cx, cz);
    if (this.building?.key === key) this.building = null;
    while (!steps.next().done);
  }

  /** Loading a chunk as a sequence of steps, each a millisecond or two. */
  private *loadSteps(cx: number, cz: number): Generator<void, void, void> {
    const key = chunkKey(cx, cz);
    const chunk = yield* generateWildChunkSteps(this.ctx.wilderness, cx, cz);
    yield;
    const g = new GeometryBuilder();
    yield* buildTerrainSteps(chunk, this.ctx.wilderness, g);
    if (this.loaded.has(key)) return;
    const group = `chunk:${key}`;
    addChunkColliders(chunk, this.physics, group);
    const release: (() => void)[] = [];
    if (chunk.farmstead) {
      let index = 0;
      buildFarmstead(
        g,
        this.ctx.wilderness,
        chunk.farmstead,
        (min, max, data) => this.physics.addBox(group, min, max, data),
        (door) =>
          release.push(
            mountFarmDoor(this.ctx, this.root, this.material, this.physics, `${group}:door:${index++}`, door),
          ),
      );
      yield;
    }
    release.push(this.trees.add(chunk, this.ctx.player.position));
    for (const l of chunk.lookouts) release.push(this.flags.add(lookoutFlag(l, this.ctx.wilderness)));
    for (const r of chunk.ruins) buildRuin(r, g, this.physics, group);
    yield;
    release.push(this.ruins.add(chunk.ruins));
    release.push(this.sources.add(chunk.sources));
    release.push(this.monsters.add(chunk));
    release.push(this.wells.add(chunk));
    yield;
    release.push(this.fish.add(chunk, this.ctx.wilderness));
    release.push(this.weed.add(chunk, this.ctx.wilderness));
    yield;
    const mesh = new THREE.Mesh(g.build(), this.material);
    release.push(this.ctx.renderer.lamps.add(mesh.geometry));
    mesh.name = group;
    this.root.add(mesh);
    this.loaded.set(key, { mesh, release });
  }

  private unload(key: string, item: Loaded): void {
    this.physics.removeGroup(`chunk:${key}`);
    for (const r of item.release) r();
    item.mesh.geometry.dispose();
    item.mesh.removeFromParent();
    this.loaded.delete(key);
  }

  get chunkCount(): number {
    return this.loaded.size;
  }

  activate(): void {
    this.ctx.renderer.setWildWater(true);
    this.updateDrain();
  }

  dispose(): void {
    // a chunk half built has already registered things; finish it so it unloads cleanly
    if (this.building) while (!this.building.steps.next().done);
    this.building = null;
    this.offStroke();
    for (const [key, item] of [...this.loaded]) this.unload(key, item);
    this.sources.dispose();
    this.monsters.dispose();
    this.marks.dispose();
    this.deer.dispose();
    this.wells.dispose();
    this.grass.dispose();
    this.flags.dispose();
    this.fish.dispose();
    this.weed.dispose();
    this.trees.dispose();
    this.landscape.dispose();
    this.material.dispose();
    disposeTree(this.root);
  }
}
