// Grass and wildflowers around the player: clumps of painted stalks (crossed alpha cards, see
// grass-card.ts) and dots of flowers on a fixed world grid (so they stay put as you walk).
//
// Every grid cell has a fixed instance slot in a window that wraps around (cell i lands in
// slot i mod WINDOW), so when the player crosses a cell only the row or column coming into
// range is written: a few hundred matrices, never the whole field. Thinning at the rim,
// shortening underfoot and the season's flowers are all done on the GPU from uniforms
// (ink material `field`), so nothing else changes as the player moves.
// They sway in the wind (ink material `wind`), thin out towards the edge of the field, take
// their colour from the land around cities like the ground does, and cast no shadows.
// Drawing only: nothing collides with grass.
import * as THREE from 'three';
import { BIOME_INDEX } from '@/content/biomes';
import { color, type ColorKey } from '@/content/palette';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { NO_SHADOW_LAYER, makeInkMaterial } from '@/engine/render/ink-material';
import { hashInts, unit } from '@/world/math/hash';
import { createNoise2D, type Noise2D } from '@/world/math/noise';
import { WATER_LEVEL, type Wilderness } from '@/world/wilderness/generator';
import { makeCardClump, makeGrassCard } from './grass-card';

/** Radius of the field around the player, metres. */
const RADIUS = 40;
/** Grid spacing between clumps. */
const SPACING = 0.55;
/** Rise over run where grass gives way to rock (the renderer paints rock from about here). */
const ROCKY = 0.95;
/** Close to the player a second, finer grid fills the gaps between clumps. */
const NEAR = 7;
const NEAR_SPACING = SPACING / 2;
/** Cells across each grid's window around the player (covers its reach, with room). */
const WINDOW = 160;
const NEAR_WINDOW = 64;
/** Height of a flower head above the ground at full size, as a share of its clump's size. */
const FLOWER_LIFT = 0.5;

/**
 * Everything about one grid point that does not depend on where the player stands, worked out
 * once so placing the field again only writes matrices. Kept in flat typed arrays indexed by
 * grid cell (wrapping around, like a ring buffer in two dimensions): walking allocates nothing,
 * so there is no garbage to collect and no pause.
 */
const F = {
  /** 1 if grass grows here. (Which grid cell a slot holds is kept apart, in `keys`.) */
  GROWS: 0,
  X: 1,
  Y: 2,
  Z: 3,
  COS: 4,
  SIN: 5,
  /** Size before distance fading, and how much taller than wide. */
  SIZE: 6,
  TALL: 7,
  /** Palette index of the blades. */
  BLADE: 8,
  /** A flower here if FLOWER_ROLL < FLOWER_CHANCE * season bloom. */
  FLOWER_ROLL: 9,
  FLOWER_CHANCE: 10,
  FLOWER: 11,
  FLOWER_SIZE: 12,
} as const;
const STRIDE = 13;
const EMPTY = 0x7fffffff;

class SpotCache {
  readonly keys: Int32Array;
  readonly data: Float32Array;
  private readonly mask: number;

  /** `side` (a power of two) cells across; must exceed the area kept around the player. */
  constructor(readonly side: number) {
    this.mask = side - 1;
    this.keys = new Int32Array(side * side * 2).fill(EMPTY);
    this.data = new Float32Array(side * side * STRIDE);
  }

  slot(i: number, k: number): number {
    return (i & this.mask) * this.side + (k & this.mask);
  }

  holds(slot: number, i: number, k: number): boolean {
    return this.keys[slot * 2] === i && this.keys[slot * 2 + 1] === k;
  }
}

/** Per biome: chance of a tuft per grid point, chance of a flower, blade colours. */
const COVER: Partial<Record<string, { tuft: number; flower: number; blades: readonly ColorKey[] }>> = {
  grassland: { tuft: 0.97, flower: 0.1, blades: ['grass', 'grass', 'sprout'] },
  forest: { tuft: 0.85, flower: 0.03, blades: ['grass', 'sprout', 'forest'] },
  mountain: { tuft: 0.85, flower: 0.04, blades: ['grass', 'sprout', 'forest'] },
};
const FLOWERS: readonly ColorKey[] = ['yellow', 'yellow', 'cream', 'cream', 'pink', 'sky', 'purple'];
/** Metres across a drift of flowers. */
const DRIFT = 22;

function bake(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const b = new GeometryBuilder();
  b.meshSmooth(geometry, new THREE.Matrix4(), 0);
  geometry.dispose();
  return b.build();
}

/** One grid's window of instance slots and where it currently sits. */
interface Window {
  readonly fine: boolean;
  readonly side: number;
  readonly step: number;
  readonly tufts: THREE.InstancedMesh;
  /** First cell (i, k) of the window, or null before the first fill. */
  i0: number | null;
  k0: number | null;
}

export class GrassField {
  private readonly card = makeGrassCard();
  private readonly field = {
    uField: { value: new THREE.Vector3() },
    uFieldFade: { value: new THREE.Vector4(RADIUS, RADIUS * 0.3, 0.8, 4) },
    uBloom: { value: 1 },
  };
  private readonly nearField = {
    uField: this.field.uField,
    uFieldFade: { value: new THREE.Vector4(NEAR, 2.5, 0.8, 4) },
    uBloom: this.field.uBloom,
  };
  private readonly material = makeInkMaterial({
    wind: true,
    side: THREE.DoubleSide,
    card: this.card,
    field: this.field,
  });
  private readonly nearMaterial = makeInkMaterial({
    wind: true,
    side: THREE.DoubleSide,
    card: this.card,
    field: this.nearField,
  });
  private readonly flowerMaterial = makeInkMaterial({ wind: true, field: this.field });
  private readonly flowers: THREE.InstancedMesh;
  private readonly coarseWindow: Window;
  private readonly nearWindow: Window;
  /** Grid points worked out so far: the field's grid, and the finer one near the player. */
  private readonly coarse = new SpotCache(256);
  private readonly fine = new SpotCache(64);
  private readonly names = [...BIOME_INDEX].reduce<string[]>((a, [k, i]) => ((a[i] = k), a), []);
  /** Where flowers gather in drifts, and which colour each drift is. */
  private readonly drifts: Noise2D;
  private readonly hues: Noise2D;

  constructor(
    private readonly wilderness: Wilderness,
    root: THREE.Object3D,
  ) {
    this.drifts = createNoise2D(wilderness.seed ^ 0x51f0);
    this.hues = createNoise2D(wilderness.seed ^ 0x2b1d);
    const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, count: number) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.frustumCulled = false;
      mesh.layers.set(NO_SHADOW_LAYER);
      // every slot starts empty (a zero matrix draws nothing)
      (mesh.instanceMatrix.array as Float32Array).fill(0);
      // palette index in red; flowers also use green (bloom needed) and blue (head height)
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      root.add(mesh);
      return mesh;
    };
    const clump = makeCardClump(1.25, 0.8);
    this.coarseWindow = {
      fine: false,
      side: WINDOW,
      step: SPACING,
      tufts: instanced(clump, this.material, WINDOW * WINDOW),
      i0: null,
      k0: null,
    };
    this.nearWindow = {
      fine: true,
      side: NEAR_WINDOW,
      step: NEAR_SPACING,
      tufts: instanced(clump.clone(), this.nearMaterial, NEAR_WINDOW * NEAR_WINDOW),
      i0: null,
      k0: null,
    };
    this.flowers = instanced(
      bake(new THREE.OctahedronGeometry(0.075, 0)),
      this.flowerMaterial,
      WINDOW * WINDOW,
    );
  }

  /** `flowers`: how many wildflowers the season brings, 0..1 (see content/seasons.ts). */
  update(at: THREE.Vector3, flowers = 1): void {
    this.field.uField.value.copy(at);
    this.field.uBloom.value = flowers;
    this.slide(this.coarseWindow, at);
    this.slide(this.nearWindow, at);
  }

  /**
   * Keep a window centred on the player: write the columns and rows of cells that have come
   * into it since last time (all of it after a long jump), nothing else.
   */
  private slide(win: Window, at: THREE.Vector3): void {
    const half = win.side >> 1;
    const i0 = Math.floor(at.x / win.step) - half;
    const k0 = Math.floor(at.z / win.step) - half;
    if (win.i0 === i0 && win.k0 === k0) return;
    const side = win.side;
    const changed: number[] = [];
    if (
      win.i0 === null ||
      win.k0 === null ||
      Math.abs(i0 - win.i0) >= side ||
      Math.abs(k0 - win.k0) >= side
    ) {
      for (let i = i0; i < i0 + side; i++) changed.push(...this.column(win, i, k0, k0 + side));
    } else {
      // columns entering on the i side, over the new k range
      const iFrom = i0 > win.i0 ? win.i0 + side : i0;
      const iTo = i0 > win.i0 ? i0 + side : win.i0;
      for (let i = iFrom; i < iTo; i++) changed.push(...this.column(win, i, k0, k0 + side));
      // rows entering on the k side, for the columns that were already there
      const kFrom = k0 > win.k0 ? win.k0 + side : k0;
      const kTo = k0 > win.k0 ? k0 + side : win.k0;
      const iKeep0 = Math.max(i0, win.i0);
      const iKeep1 = Math.min(i0 + side, win.i0 + side);
      for (let i = iKeep0; i < iKeep1; i++) changed.push(...this.column(win, i, kFrom, kTo));
    }
    win.i0 = i0;
    win.k0 = k0;
    this.upload(win.tufts, changed, 16, 3);
    if (!win.fine) this.upload(this.flowers, changed, 16, 3);
  }

  /**
   * Write cells i, k0..k1-1 into their slots; returns the slot ranges touched as [start, end)
   * pairs (a column's slots run on, except where the window wraps).
   */
  private column(win: Window, i: number, k0: number, k1: number): number[] {
    if (k1 <= k0) return [];
    const side = win.side;
    const mi = ((i % side) + side) % side;
    const D = (win.fine ? this.fine : this.coarse).data;
    const tm = win.tufts.instanceMatrix.array as Float32Array;
    const tc = win.tufts.instanceColor!.array as Float32Array;
    const fm = this.flowers.instanceMatrix.array as Float32Array;
    const fc = this.flowers.instanceColor!.array as Float32Array;
    const ranges: number[] = [];
    let runStart = -1;
    let last = -2;
    for (let k = k0; k < k1; k++) {
      const mk = ((k % side) + side) % side;
      const slot = mi * side + mk;
      if (slot !== last + 1) {
        if (runStart >= 0) ranges.push(runStart, last + 1);
        runStart = slot;
      }
      last = slot;
      const o = this.spot(i, k, win.fine);
      if (o < 0) {
        tm.fill(0, slot * 16, slot * 16 + 16);
        if (!win.fine) fm.fill(0, slot * 16, slot * 16 + 16);
        continue;
      }
      const size = D[o + F.SIZE]!;
      put(tm, slot, D, o, size, size * D[o + F.TALL]!, D[o + F.Y]!);
      tc[slot * 3] = D[o + F.BLADE]!;
      if (win.fine) continue;
      const chance = D[o + F.FLOWER_CHANCE]!;
      if (chance <= 0 || D[o + F.FLOWER_ROLL]! >= chance) {
        fm.fill(0, slot * 16, slot * 16 + 16);
        continue;
      }
      const fs = D[o + F.FLOWER_SIZE]!;
      const lift = FLOWER_LIFT * size + 0.04;
      put(fm, slot, D, o, fs, fs * 0.8, D[o + F.Y]! + lift);
      fm[slot * 16 + 12] = D[o + F.X]! + 0.05;
      fc[slot * 3] = D[o + F.FLOWER]!;
      // shown while the season's bloom is at least roll / chance
      fc[slot * 3 + 1] = D[o + F.FLOWER_ROLL]! / chance;
      fc[slot * 3 + 2] = lift - 0.04;
    }
    if (runStart >= 0) ranges.push(runStart, last + 1);
    return ranges;
  }

  /** Send just the touched slot ranges of a mesh's buffers to the GPU. */
  private upload(
    mesh: THREE.InstancedMesh,
    ranges: readonly number[],
    matrixStride: number,
    colourStride: number,
  ): void {
    if (!ranges.length) return;
    const m = mesh.instanceMatrix;
    const c = mesh.instanceColor!;
    m.clearUpdateRanges();
    c.clearUpdateRanges();
    for (let r = 0; r < ranges.length; r += 2) {
      const a = ranges[r]!;
      const b = ranges[r + 1]!;
      m.addUpdateRange(a * matrixStride, (b - a) * matrixStride);
      c.addUpdateRange(a * colourStride, (b - a) * colourStride);
    }
    m.needsUpdate = true;
    c.needsUpdate = true;
  }

  /** The data offset of grid point (i, k), worked out on first use; -1 if nothing grows. */
  private spot(i: number, k: number, fine: boolean): number {
    const cache = fine ? this.fine : this.coarse;
    const slot = cache.slot(i, k);
    const o = slot * STRIDE;
    const D = cache.data;
    if (cache.holds(slot, i, k)) return D[o + F.GROWS] ? o : -1;
    cache.keys[slot * 2] = i;
    cache.keys[slot * 2 + 1] = k;
    D[o + F.GROWS] = 0;
    const w = this.wilderness;
    const salt = fine ? 0x3c71 : 0x6a55;
    /** Independent 0..1 numbers for this grid point. */
    const r = (n: number): number => unit(hashInts(w.seed ^ salt, i, k, n));
    const step = fine ? NEAR_SPACING : SPACING;
    const x = (i + r(0) * 0.9) * step;
    const z = (k + r(1) * 0.9) * step;
    const cover = COVER[this.names[w.biomeAt(x, z)] ?? ''];
    if (!cover || r(2) > cover.tuft) return -1;
    const y = w.heightAt(x, z);
    const slope = Math.max(Math.abs(w.heightAt(x + 0.7, z) - y), Math.abs(w.heightAt(x, z + 0.7) - y)) / 0.7;
    // nothing grows under water or where the hillside turns to bare rock
    if (y <= WATER_LEVEL + 0.1 || slope > ROCKY) return -1;
    const a = r(4) * Math.PI * 2;
    // flowers gather in drifts of mostly one colour, with a few strays between them
    const drift = THREE.MathUtils.smoothstep(this.drifts(x / DRIFT, z / DRIFT), 0.25, 0.6);
    D[o + F.GROWS] = 1;
    D[o + F.X] = x;
    D[o + F.Y] = y;
    D[o + F.Z] = z;
    D[o + F.COS] = Math.cos(a);
    D[o + F.SIN] = Math.sin(a);
    D[o + F.SIZE] = 0.7 + 0.5 * r(3);
    // some clumps stand tall, most are knee-high
    D[o + F.TALL] = 0.65 + 0.7 * r(5) * r(5);
    D[o + F.BLADE] = color(cover.blades[Math.floor(r(6) * cover.blades.length)]!);
    D[o + F.FLOWER_ROLL] = r(7);
    D[o + F.FLOWER_CHANCE] = fine ? 0 : cover.flower * (0.25 + 4 * drift);
    D[o + F.FLOWER] = color(this.flowerColour(x, z, r(9)));
    D[o + F.FLOWER_SIZE] = 0.8 + 0.5 * r(8);
    return o;
  }

  /** A drift's own colour most of the time, now and then any other. */
  private flowerColour(x: number, z: number, roll: number): ColorKey {
    if (roll < 0.15) return FLOWERS[Math.floor((roll / 0.15) * FLOWERS.length)]!;
    const h = (this.hues(x / (DRIFT * 1.3), z / (DRIFT * 1.3)) + 1) / 2;
    return FLOWERS[Math.min(FLOWERS.length - 1, Math.floor(h * FLOWERS.length))]!;
  }

  dispose(): void {
    for (const mesh of [this.coarseWindow.tufts, this.nearWindow.tufts, this.flowers]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
    this.nearMaterial.dispose();
    this.flowerMaterial.dispose();
    this.card.dispose();
  }
}

/** Write a scale-rotate-translate matrix straight into slot `n` of an instance buffer. */
function put(
  m: Float32Array,
  n: number,
  D: Float32Array,
  o: number,
  sx: number,
  sy: number,
  y: number,
): void {
  const c = D[o + F.COS]!;
  const sn = D[o + F.SIN]!;
  const at = n * 16;
  m[at] = sx * c;
  m[at + 1] = 0;
  m[at + 2] = -sx * sn;
  m[at + 3] = 0;
  m[at + 4] = 0;
  m[at + 5] = sy;
  m[at + 6] = 0;
  m[at + 7] = 0;
  m[at + 8] = sx * sn;
  m[at + 9] = 0;
  m[at + 10] = sx * c;
  m[at + 11] = 0;
  m[at + 12] = D[o + F.X]!;
  m[at + 13] = y;
  m[at + 14] = D[o + F.Z]!;
  m[at + 15] = 1;
}
