// Grass and flowers are scattered in world-space cells. Each patch owns a compact
// instance buffer; streaming and frustum culling work on patches, never on the
// shape, density or scale of an individual plant.
import * as THREE from 'three';
import { climateBiome } from '@/content/biomes';
import { color, type ColorKey } from '@/content/palette';
import { NO_SHADOW_LAYER, makeInkMaterial } from '@/engine/render/ink-material';
import { makeWindMap } from '@/engine/render/wind-map';
import { hashInts, unit } from '@/world/math/hash';
import { createNoise2D, smoothstep, type Noise2D } from '@/world/math/noise';
import { BANK_HEIGHT, riverbedMeadow, WATER_LEVEL, type Wilderness } from '@/world/wilderness/generator';
import { springsNear } from '@/world/wilderness/landmarks';
import { pathsOf } from '@/world/wilderness/paths';
import { makeBladeClump } from './grass-card';
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
const FLOWERS: readonly ColorKey[] = ['yellow', 'yellow', 'cream', 'cream', 'pink', 'sky', 'purple'];

interface Patch {
  i: number;
  k: number;
  mesh: THREE.InstancedMesh;
}

class Grid {
  readonly patches = new Map<string, Patch>();
  readonly spare: Patch[] = [];
  lastI = Infinity;
  lastK = Infinity;
  constructor(
    readonly kind: 'grass' | 'flower',
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
  private readonly field = {
    uField: { value: new THREE.Vector3() },
    uFieldFade: { value: new THREE.Vector2(RADIUS - 8, RADIUS) },
  };
  private readonly grids: Grid[];
  readonly windMap: THREE.DataTexture;
  private readonly drifts: Noise2D;
  private readonly hues: Noise2D;

  constructor(
    private readonly wilderness: Wilderness,
    root: THREE.Object3D,
    private readonly camera: THREE.Camera,
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
      new Grid(
        'flower',
        1.1,
        12,
        meadowFlower(),
        makeInkMaterial({
          wind: this.windMap,
          side: THREE.DoubleSide,
          field: { ...this.field, uDensity: this.flowerDensity },
        }),
      ),
    ];
    root.add(this.coverRoot);
    this.drifts = createNoise2D(wilderness.seed ^ 0x51f0);
    this.hues = createNoise2D(wilderness.seed ^ 0x2b1d);
  }

  update(at: THREE.Vector3, flowers = 1, grass = 1): void {
    this.coverRoot.visible = grass > 0;
    if (!this.coverRoot.visible) return;
    this.grassDensity.value = grass;
    this.flowerDensity.value = Math.min(flowers, grass);
    this.field.uField.value.copy(at);
    this.camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(
      this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse),
    );
    for (const grid of this.grids) {
      this.stream(grid, at);
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
    const reach = RADIUS + grid.step;
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
    for (let i = minI; i <= maxI; i++) {
      const dx = Math.max(i * width - x, x - (i + 1) * width, 0);
      for (let k = minK; k <= maxK; k++) {
        const dz = Math.max(k * width - z, z - (k + 1) * width, 0);
        if (dx * dx + dz * dz > reach * reach) continue;
        const key = `${i},${k}`;
        if (grid.patches.has(key)) continue;
        const patch = grid.spare.pop() ?? this.createPatch(grid);
        patch.i = i;
        patch.k = k;
        this.fill(grid, patch);
        grid.patches.set(key, patch);
      }
    }
  }

  private createPatch(grid: Grid): Patch {
    const count = grid.cells ** 2;
    const mesh = new THREE.InstancedMesh(grid.geometry, grid.material, count);
    mesh.name = grid.kind === 'grass' ? 'grass-tufts' : 'wildflowers';
    mesh.layers.set(NO_SHADOW_LAYER);
    // A flat patch's sphere reaches far above its grass. Cull against its wind-padded box instead.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.coverRoot.add(mesh);
    return { i: 0, k: 0, mesh };
  }

  private fill(grid: Grid, { mesh, i: pi, k: pk }: Patch): void {
    const matrices = mesh.instanceMatrix.array as Float32Array;
    const colors = mesh.instanceColor!.array as Float32Array;
    const seed = this.wilderness.seed ^ (grid.kind === 'flower' ? 0x1f3d : 0x6a55);
    const w = this.wilderness;
    const paths = pathsOf(w);
    let count = 0;
    for (let i = pi * grid.cells; i < (pi + 1) * grid.cells; i++) {
      for (let k = pk * grid.cells; k < (pk + 1) * grid.cells; k++) {
        const r = (n: number) => unit(hashInts(seed, i, k, n));
        // tufts stray past their own cell, so the meadow never lines up into planted rows
        const x = (i - 0.25 + r(0) * 1.5) * grid.step,
          z = (k - 0.25 + r(1) * 1.5) * grid.step;
        const y = w.heightAt(x, z);
        if (y <= WATER_LEVEL) continue;
        // towns have paving and yards of their own; footpaths are trodden bare down the middle,
        // with the meadow spilling over their edges
        if (w.townAt(x, z, 1)) continue;
        if (paths.edgeDistance(x, z) < -0.3) continue;
        // nor in a hot spring's pool
        if (springsNear(w, x, z, 8).some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 0.3)) continue;
        const climate = w.climate(x, z);
        const biome = climateBiome(climate);
        const cover = COVER[biome === 'water' ? 'grassland' : biome];
        const meadow = riverbedMeadow(climate) * smoothstep(0, BANK_HEIGHT, y - WATER_LEVEL);
        // grass grows in clumps, thinner between them
        const clump = THREE.MathUtils.smoothstep(this.drifts(x / CLUMP + 41, z / CLUMP + 17), 0.2, 0.75);
        if (r(2) >= cover.tuft * meadow * (grid.kind === 'grass' ? 0.72 + 0.28 * clump : 1)) continue;
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
          put(matrices, count, x, y, z, angle, fs, FLOWER_LIFT * size + 0.04, 0, 0);
          colors[count * 3] = color(this.flowerColour(x, z, r(9)));
          colors[count * 3 + 1] = roll / chance;
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
    }
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
