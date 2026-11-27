// Grass and flowers are scattered in world-space cells. Each patch owns a compact
// instance buffer; streaming and frustum culling work on patches, never on the
// shape, density or scale of an individual plant. The meadow is blades of grass close set,
// broad painted tufts standing among them and painted wildflowers (cards from the plant
// atlas), and, where a flower sea lies, its flowers packed over the whole field.
import * as THREE from 'three';
import { climateBiome } from '@/content/biomes';
import { color, type ColorKey } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { NO_SHADOW_LAYER, makeInkMaterial } from '@/engine/render/ink-material';
import { makeWindMap } from '@/engine/render/wind-map';
import { hashInts, unit } from '@/world/math/hash';
import { createNoise2D, smoothstep, type Noise2D } from '@/world/math/noise';
import { BANK_HEIGHT, riverbedMeadow, WATER_LEVEL, type Wilderness } from '@/world/wilderness/generator';
import { bloomOf, type FlowerSea, patchMask, SEA_FLOWERS, seasNear } from '@/world/wilderness/groves';
import { springsNear } from '@/world/wilderness/landmarks';
import { pathsOf } from '@/world/wilderness/paths';
import { makeBladeClump, makePlantCard } from './grass-card';
import { meadowFlower } from './meadow-flower';

const RADIUS = 48;
const ROCKY = 0.95;
const FLOWER_LIFT = 0.5;
const DRIFT = 22;
/** Metres across a clump of thicker, taller grass. */
const CLUMP = 6;
const COVER = {
  grassland: { tuft: 0.97, flower: 0.1, blades: ['grass', 'grass', 'sprout'] },
  forest: { tuft: 0.85, flower: 0.03, blades: ['grass', 'sprout', 'forest'] },
  mountain: { tuft: 0.85, flower: 0.04, blades: ['grass', 'sprout', 'forest'] },
} as const;
/** Segments round a sea flower's petal (a meadow flower has 12): half the triangles, and a
 * sea is seen as a mass of flowers, seldom one at arm's length. */
const SEA_PETAL = 6;
const FLOWERS: readonly ColorKey[] = ['yellow', 'yellow', 'cream', 'cream', 'pink', 'sky', 'purple'];

interface Patch {
  i: number;
  k: number;
  mesh: THREE.InstancedMesh;
}

interface Planting {
  key: string;
  i: number;
  k: number;
  distance: number;
}

class Grid {
  readonly patches = new Map<string, Patch>();
  readonly spare: Patch[] = [];
  wanted = new Set<string>();
  pending: Planting[] = [];
  lastI = Infinity;
  lastK = Infinity;
  constructor(
    readonly kind: 'grass' | 'tuft' | 'flower' | 'sea',
    readonly step: number,
    readonly cells: number,
    readonly geometry: THREE.BufferGeometry,
    readonly material: THREE.Material,
  ) {}
}

export class GrassField {
  private readonly coverRoot = new THREE.Group();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly grassDensity = { value: 1 };
  private readonly flowerDensity = { value: 1 };
  private readonly seaDensity = { value: 1 };
  /** How far each kind of flower sea is in bloom (SEA_FLOWERS order): a sea's flowers are all
   * planted, and the shader shows that share of them, so nothing is rebuilt as the season turns. */
  private readonly seaBloom = { value: new THREE.Vector4() };
  private readonly field = {
    uField: { value: new THREE.Vector3() },
    uFieldFade: { value: new THREE.Vector2(RADIUS - 8, RADIUS) },
  };
  private readonly grids: Grid[];
  readonly windMap: THREE.DataTexture;
  private readonly drifts: Noise2D;
  private readonly hues: Noise2D;
  private building: {
    grid: Grid;
    key: string;
    patch: Patch;
    steps: Generator<void, void>;
  } | null = null;

  constructor(
    private readonly wilderness: Wilderness,
    root: THREE.Object3D,
    private readonly camera: THREE.Camera,
    /** Whether a spot inside a town is lawn, where grass grows (false for anywhere unknown). */
    private readonly lawn: (x: number, z: number) => boolean = () => false,
    private readonly cultivated: (x: number, z: number) => boolean = () => false,
  ) {
    this.windMap = makeWindMap(wilderness.seed ^ 0x714d);
    this.grids = [
      new Grid(
        'grass',
        0.67,
        16,
        makeBladeClump(),
        makeInkMaterial({
          wind: this.windMap,
          side: THREE.DoubleSide,
          blades: true,
          field: { ...this.field, uDensity: this.grassDensity },
        }),
      ),
      // broad painted tufts standing over the blades, a few to every stride
      new Grid(
        'tuft',
        0.9,
        14,
        makePlantCard(),
        makeInkMaterial({
          wind: this.windMap,
          side: THREE.DoubleSide,
          plants: 'tufts',
          field: { ...this.field, uDensity: this.grassDensity },
        }),
      ),
      new Grid(
        'flower',
        1.1,
        12,
        makePlantCard(),
        makeInkMaterial({
          wind: this.windMap,
          side: THREE.DoubleSide,
          plants: 'flowers',
          field: { ...this.field, uDensity: this.flowerDensity },
        }),
      ),
      // flower seas: one kind of flower packed close over a whole field (see groves.ts)
      new Grid(
        'sea',
        0.46,
        24,
        meadowFlower(SEA_PETAL),
        makeInkMaterial({
          wind: this.windMap,
          side: THREE.DoubleSide,
          field: { ...this.field, uDensity: this.seaDensity, uBloom: this.seaBloom },
        }),
      ),
    ];
    root.add(this.coverRoot);
    this.drifts = createNoise2D(wilderness.seed ^ 0x51f0);
    this.hues = createNoise2D(wilderness.seed ^ 0x2b1d);
  }

  update(
    at: THREE.Vector3,
    flowers = 1,
    grass = 1,
    yearPhase = 0,
    budgetMs: number = TUNING.world.grassStreaming.buildMs,
  ): void {
    // the seas bloom on their own calendar, even where the meadow is still bare
    const b = this.seaBloom.value.set(
      ...([0, 1, 2, 3].map((k) => bloomOf(k, yearPhase)) as [number, number, number, number]),
    );
    this.coverRoot.visible = grass > 0 || Math.max(b.x, b.y, b.z, b.w) > 0;
    if (!this.coverRoot.visible) return;
    this.grassDensity.value = grass;
    this.flowerDensity.value = Math.min(flowers, grass);
    this.field.uField.value.copy(at);
    this.camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(
      this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse),
    );
    for (const grid of this.grids) this.stream(grid, at);
    this.plant(budgetMs);
    for (const grid of this.grids) {
      const width = grid.step * grid.cells;
      for (const { i, k, mesh } of grid.patches.values()) {
        const dx = Math.max(i * width - at.x, at.x - (i + 1) * width, 0);
        const dz = Math.max(k * width - at.z, at.z - (k + 1) * width, 0);
        mesh.visible =
          mesh.count > 0 &&
          dx * dx + dz * dz < RADIUS * RADIUS &&
          this.frustum.intersectsBox(mesh.boundingBox!);
      }
    }
  }

  /** Startup can finish the nearby meadow behind the loading screen, yielding between updates. */
  get ready(): boolean {
    return (
      !this.coverRoot.visible || (!this.building && this.grids.every((grid) => grid.pending.length === 0))
    );
  }

  get preparation(): { done: number; total: number } {
    if (!this.coverRoot.visible) return { done: 1, total: 1 };
    let total = 0,
      done = 0;
    for (const grid of this.grids)
      for (const key of grid.wanted) {
        total++;
        if (grid.patches.has(key)) done++;
      }
    return { done, total };
  }

  private cancelPlanting(): void {
    if (!this.building) return;
    const { grid, patch, steps } = this.building;
    steps.return();
    patch.mesh.visible = false;
    grid.spare.push(patch);
    this.building = null;
  }

  /** All four kinds share one budget. Partially filled instance buffers stay off screen. */
  private plant(budgetMs: number): void {
    if (this.building && !this.building.grid.wanted.has(this.building.key)) this.cancelPlanting();
    const until = performance.now() + budgetMs;
    do {
      if (!this.building) {
        let nearest: Grid | undefined;
        for (const grid of this.grids)
          if (grid.pending.length && (!nearest || grid.pending[0]!.distance < nearest.pending[0]!.distance))
            nearest = grid;
        if (!nearest) return;
        const { key, i, k } = nearest.pending.shift()!;
        const patch = nearest.spare.pop() ?? this.createPatch(nearest);
        patch.i = i;
        patch.k = k;
        patch.mesh.visible = false;
        this.building = { grid: nearest, key, patch, steps: this.fill(nearest, patch) };
      }
      const job = this.building;
      if (job.steps.next().done) {
        job.grid.patches.set(job.key, job.patch);
        this.building = null;
      }
    } while (performance.now() < until);
  }

  /** Lay every patch afresh as it next streams in (a town nearby has just been laid out, and
   * its lawns can now grow grass). */
  invalidate(): void {
    this.cancelPlanting();
    for (const grid of this.grids) {
      for (const patch of grid.patches.values()) {
        patch.mesh.visible = false;
        grid.spare.push(patch);
      }
      grid.patches.clear();
      grid.pending = [];
      grid.wanted.clear();
      grid.lastI = grid.lastK = Infinity;
    }
  }

  private stream(grid: Grid, at: THREE.Vector3): void {
    const ci = Math.floor(at.x / grid.step),
      ck = Math.floor(at.z / grid.step);
    if (ci === grid.lastI && ck === grid.lastK) return;
    grid.lastI = ci;
    grid.lastK = ck;
    const width = grid.cells * grid.step;
    // Include the whole player cell so no tuft enters the circular field before its patch exists.
    const x = (ci + 0.5) * grid.step,
      z = (ck + 0.5) * grid.step;
    const reach = RADIUS + TUNING.world.grassStreaming.ahead + grid.step;
    const minI = Math.floor((x - reach) / width),
      maxI = Math.floor((x + reach) / width);
    const minK = Math.floor((z - reach) / width),
      maxK = Math.floor((z + reach) / width);
    for (const [key, patch] of grid.patches) {
      if (patch.i >= minI - 1 && patch.i <= maxI + 1 && patch.k >= minK - 1 && patch.k <= maxK + 1) continue;
      grid.patches.delete(key);
      patch.mesh.visible = false;
      grid.spare.push(patch);
    }
    grid.wanted.clear();
    grid.pending = [];
    for (let i = minI; i <= maxI; i++) {
      const dx = Math.max(i * width - x, x - (i + 1) * width, 0);
      for (let k = minK; k <= maxK; k++) {
        const dz = Math.max(k * width - z, z - (k + 1) * width, 0);
        if (dx * dx + dz * dz > reach * reach) continue;
        const key = `${i},${k}`;
        grid.wanted.add(key);
        if (grid.patches.has(key)) continue;
        if (this.building?.grid === grid && this.building.key === key) continue;
        grid.pending.push({ key, i, k, distance: dx * dx + dz * dz });
      }
    }
    grid.pending.sort((a, b) => a.distance - b.distance);
  }

  private createPatch(grid: Grid): Patch {
    const count = grid.cells ** 2;
    const mesh = new THREE.InstancedMesh(grid.geometry, grid.material, count);
    mesh.name = { grass: 'grass-tufts', tuft: 'painted-tufts', flower: 'wildflowers', sea: 'flower-sea' }[
      grid.kind
    ];
    mesh.layers.set(NO_SHADOW_LAYER);
    mesh.count = 0;
    mesh.visible = false;
    // A flat patch's sphere reaches far above its grass. Cull against its wind-padded box instead.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.coverRoot.add(mesh);
    return { i: 0, k: 0, mesh };
  }

  private *fill(grid: Grid, { mesh, i: pi, k: pk }: Patch): Generator<void, void> {
    const matrices = mesh.instanceMatrix.array as Float32Array;
    const colors = mesh.instanceColor!.array as Float32Array;
    const seed =
      this.wilderness.seed ^ { grass: 0x6a55, tuft: 0x4be7, flower: 0x1f3d, sea: 0x3c71 }[grid.kind];
    const w = this.wilderness;
    const paths = pathsOf(w);
    let count = 0;
    if (grid.kind === 'sea') {
      const width = grid.cells * grid.step;
      const seas = seasNear(w, (pi + 0.5) * width, (pk + 0.5) * width, width * 0.71);
      if (seas.length) count = yield* this.fillSea(grid, pi, pk, seas, matrices, colors);
      return this.finish(mesh, count);
    }
    for (let i = pi * grid.cells; i < (pi + 1) * grid.cells; i++) {
      for (let k = pk * grid.cells; k < (pk + 1) * grid.cells; k++) {
        const r = (n: number) => unit(hashInts(seed, i, k, n));
        // tufts stray past their own cell, so the meadow never lines up into planted rows
        const x = (i - 0.25 + r(0) * 1.5) * grid.step,
          z = (k - 0.25 + r(1) * 1.5) * grid.step;
        const y = w.heightAt(x, z);
        if (y <= WATER_LEVEL) continue;
        // towns have paving and bare yards of their own, but their lawns grow grass like any
        // meadow; footpaths are trodden bare down the middle, the meadow spilling over their edges
        if (this.cultivated(x, z) || (w.townAt(x, z, 1) && !this.lawn(x, z))) continue;
        // the meadow creeps in over a path's edges, thinning out toward the trodden middle
        const onPath = -paths.edgeDistance(x, z);
        if (onPath > 0.25 && r(11) < Math.min(1, (onPath - 0.25) / 0.7)) continue;
        // (a painted tuft or flower is a card half a stride wide: it keeps clear of the path)
        if (grid.kind !== 'grass' && onPath > -0.35) continue;
        // nor in a hot spring's pool
        if (springsNear(w, x, z, 8).some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 0.3)) continue;
        const climate = w.climate(x, z);
        const biome = climateBiome(climate);
        const cover = COVER[biome === 'water' ? 'grassland' : biome];
        const meadow = riverbedMeadow(climate) * smoothstep(0, BANK_HEIGHT, y - WATER_LEVEL);
        // grass grows in clumps, thinner between them
        const clump = THREE.MathUtils.smoothstep(this.drifts(x / CLUMP + 41, z / CLUMP + 17), 0.2, 0.75);
        const share =
          grid.kind === 'grass' ? 0.72 + 0.28 * clump : grid.kind === 'tuft' ? 0.5 + 0.5 * clump : 1;
        if (r(2) >= cover.tuft * meadow * share) continue;
        const dx = (w.heightAt(x + 0.4, z) - y) / 0.4,
          dz = (w.heightAt(x, z + 0.4) - y) / 0.4;
        if (Math.max(Math.abs(dx), Math.abs(dz)) > ROCKY) continue;
        const size = (0.7 + 0.5 * r(3)) * (0.45 + 0.55 * meadow) * (0.85 + 0.25 * clump);
        const angle = r(4) * Math.PI * 2;
        if (grid.kind === 'flower') {
          const drift = THREE.MathUtils.smoothstep(this.drifts(x / DRIFT, z / DRIFT), 0.25, 0.6);
          const chance = Math.min(0.95, 4 * cover.flower * (0.25 + 4 * drift));
          const roll = r(7);
          if (roll >= chance) continue;
          const fs = 0.8 + 0.5 * r(8);
          // (a painted flower stands taller than its head is wide: the card is its whole height)
          put(matrices, count, x, y - 0.01, z, angle, fs, 0.52 * (FLOWER_LIFT * size + 0.04) * fs, 0, 0);
          colors[count * 3] = color(this.flowerColour(x, z, r(9)));
          colors[count * 3 + 1] = roll / chance;
        } else if (grid.kind === 'tuft') {
          // as tall as the tallest blades round it, and its foot sunk a little into them
          const tall = (0.3 + 0.22 * r(5)) * size;
          put(matrices, count, x, y - 0.04 * tall, z, angle, tall, tall, 0, 0);
          colors[count * 3] = color(cover.blades[Math.floor(r(6) * cover.blades.length)]!);
          colors[count * 3 + 1] = r(7);
        } else {
          const tall = r(5);
          put(
            matrices,
            count,
            x,
            y - 0.035 * size,
            z,
            angle,
            size,
            size * (0.65 + 0.7 * tall * tall),
            dx,
            dz,
          );
          colors[count * 3] = color(cover.blades[Math.floor(r(6) * cover.blades.length)]!);
          colors[count * 3 + 1] = r(7);
        }
        // The blue channel holds a stable wind response, independent of density and streaming order.
        colors[count * 3 + 2] = r(10);
        count++;
      }
      yield;
    }
    this.finish(mesh, count);
  }

  /** A flower sea's share of a patch: packed close where the sea is thick, each flower with its
   * sea's kind and its place in the bloom (green channel: kind + 0.9 × place). */
  private *fillSea(
    grid: Grid,
    pi: number,
    pk: number,
    seas: readonly FlowerSea[],
    matrices: Float32Array,
    colors: Float32Array,
  ): Generator<void, number> {
    const w = this.wilderness;
    const paths = pathsOf(w);
    const seed = w.seed ^ 0x3c71;
    let count = 0;
    for (let i = pi * grid.cells; i < (pi + 1) * grid.cells; i++) {
      for (let k = pk * grid.cells; k < (pk + 1) * grid.cells; k++) {
        const r = (n: number) => unit(hashInts(seed, i, k, n));
        const x = (i - 0.25 + r(0) * 1.5) * grid.step,
          z = (k - 0.25 + r(1) * 1.5) * grid.step;
        let sea: FlowerSea | null = null;
        let thick = 0;
        for (const s of seas) {
          const m = patchMask(s, x, z);
          if (m > thick) [sea, thick] = [s, m];
        }
        // thinning out raggedly toward the edge
        const limit = thick * (0.75 + 0.25 * this.drifts(x / 7 + 13, z / 7 + 5));
        if (!sea || r(2) >= limit) continue;
        const y = w.heightAt(x, z);
        if (
          y <= WATER_LEVEL + 0.2 ||
          this.cultivated(x, z) ||
          w.townAt(x, z, 1) ||
          paths.edgeDistance(x, z) < 0.2
        )
          continue;
        const dx = (w.heightAt(x + 0.4, z) - y) / 0.4,
          dz = (w.heightAt(x, z + 0.4) - y) / 0.4;
        if (Math.max(Math.abs(dx), Math.abs(dz)) > ROCKY) continue;
        const kind = SEA_FLOWERS[sea.kind]!;
        const size = 0.9 + 0.5 * r(3);
        put(
          matrices,
          count,
          x,
          y,
          z,
          r(4) * Math.PI * 2,
          size,
          FLOWER_LIFT * size + 0.05 + 0.15 * r(5),
          0,
          0,
        );
        colors[count * 3] = r(6) < 0.1 ? kind.dot : kind.colour;
        // which flowers open first: the shader shows those whose place is below the sea's bloom
        colors[count * 3 + 1] = sea.kind + 0.9 * (r(2) / limit);
        colors[count * 3 + 2] = r(10);
        count++;
      }
      yield;
    }
    return count;
  }

  private finish(mesh: THREE.InstancedMesh, count: number): void {
    mesh.visible = count > 0;
    mesh.count = count;
    if (!count) return;
    for (const attr of [mesh.instanceMatrix, mesh.instanceColor!]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, count * attr.itemSize);
      attr.needsUpdate = true;
    }
    mesh.computeBoundingBox();
    mesh.boundingBox!.expandByScalar(0.65); // Includes the tallest tip at maximum wind bend.
  }

  private flowerColour(x: number, z: number, roll: number): ColorKey {
    if (roll < 0.15) return FLOWERS[Math.floor((roll / 0.15) * FLOWERS.length)]!;
    const h = (this.hues(x / (DRIFT * 1.3), z / (DRIFT * 1.3)) + 1) / 2;
    return FLOWERS[Math.min(FLOWERS.length - 1, Math.floor(h * FLOWERS.length))]!;
  }

  dispose(): void {
    this.cancelPlanting();
    this.windMap.dispose();
    this.coverRoot.removeFromParent();
    for (const grid of this.grids) {
      for (const { mesh } of [...grid.patches.values(), ...grid.spare]) {
        mesh.removeFromParent();
        mesh.dispose();
      }
      grid.geometry.dispose();
      grid.material.dispose();
      grid.patches.clear();
      grid.pending = [];
      grid.wanted.clear();
      grid.spare.length = 0;
    }
  }
}

/** Static yaw, scale and slope-following roots. Stems remain upright on a bank. */
function put(
  m: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  angle: number,
  sx: number,
  sy: number,
  dx: number,
  dz: number,
): void {
  const c = Math.cos(angle),
    s = Math.sin(angle),
    at = index * 16;
  m[at] = sx * c;
  m[at + 1] = sx * (c * dx - s * dz);
  m[at + 2] = -sx * s;
  m[at + 4] = 0;
  m[at + 5] = sy;
  m[at + 6] = 0;
  m[at + 8] = sx * s;
  m[at + 9] = sx * (s * dx + c * dz);
  m[at + 10] = sx * c;
  m[at + 12] = x;
  m[at + 13] = y;
  m[at + 14] = z;
  m[at + 15] = 1;
}
