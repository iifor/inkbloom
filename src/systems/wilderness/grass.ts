// Grass and wildflowers around the player: clumps of painted stalks (crossed alpha cards, see
// grass-card.ts) and dots of flowers on a fixed world grid (so they stay put as you walk),
// placed again whenever the player moves a few metres.
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
/** The field is placed again after the player moves this far. */
const REPLACE = 3;
/** Rise over run where grass gives way to rock (the renderer paints rock from about here). */
const ROCKY = 0.95;
const PER_SIDE = Math.ceil((RADIUS * 2) / SPACING) + 1;
/** Close to the player a second, finer grid fills the gaps between clumps. */
const NEAR = 7;
const NEAR_SPACING = SPACING / 2;
const NEAR_SIDE = Math.ceil((NEAR * 2) / NEAR_SPACING) + 1;
/** Milliseconds a frame spent working out ground ahead of the field. */
const PREFETCH_MS = 1;
const MAX = PER_SIDE * PER_SIDE + NEAR_SIDE * NEAR_SIDE;

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
  /** A flower here if FLOWER_ROLL < FLOWER_CHANCE. */
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
  grassland: { tuft: 0.97, flower: 0.1, blades: ['grass', 'grass', 'green'] },
  forest: { tuft: 0.85, flower: 0.03, blades: ['grass', 'green', 'forest'] },
  mountain: { tuft: 0.85, flower: 0.04, blades: ['grass', 'green', 'forest'] },
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

export class GrassField {
  private readonly tufts: THREE.InstancedMesh;
  private readonly flowers: THREE.InstancedMesh;
  private readonly card = makeGrassCard();
  private readonly material = makeInkMaterial({ wind: true, side: THREE.DoubleSide, card: this.card });
  private readonly flowerMaterial = makeInkMaterial({ wind: true });
  private centre: { x: number; z: number } | null = null;
  private readonly c = new THREE.Color();
  /** Grid points worked out so far: the field's grid, and the finer one near the player. */
  private readonly coarse = new SpotCache(256);
  private readonly fine = new SpotCache(64);
  /** Where the look-ahead scan is: the band beyond the field still to work out; see warm(). */
  private ahead: { i0: number; k0: number; side: number; cx: number; cz: number; n: number } | null = null;
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
    this.tufts = new THREE.InstancedMesh(makeCardClump(1.25, 0.8), this.material, MAX);
    const head = new THREE.OctahedronGeometry(0.075, 0);
    this.flowers = new THREE.InstancedMesh(bake(head), this.flowerMaterial, MAX);
    for (const mesh of [this.tufts, this.flowers]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.layers.set(NO_SHADOW_LAYER);
      // the palette index rides in instanceColor.r; make sure the attribute exists
      mesh.setColorAt(0, this.c.setRGB(0, 0, 0));
      root.add(mesh);
    }
  }

  update(at: THREE.Vector3): void {
    const cx = Math.round(at.x / REPLACE) * REPLACE;
    const cz = Math.round(at.z / REPLACE) * REPLACE;
    if (this.centre && this.centre.x === cx && this.centre.z === cz) return;
    const reach = RADIUS + REPLACE * 2;
    const side = Math.ceil((reach * 2) / SPACING) + 1;
    this.ahead = {
      i0: Math.floor((cx - reach) / SPACING),
      k0: Math.floor((cz - reach) / SPACING),
      side,
      cx,
      cz,
      n: 0,
    };
    this.centre = { x: cx, z: cz };
    this.place(cx, cz);
  }

  /**
   * Work out the spots in a band just beyond the field a little at a time (about a millisecond
   * a frame), so when the player walks on and the field moves, its new edge is already known.
   */
  warm(): void {
    const a = this.ahead;
    if (!a) return;
    const reach = RADIUS + REPLACE * 2;
    const until = performance.now() + PREFETCH_MS;
    for (let checked = 0; a.n < a.side * a.side; a.n++) {
      // check the clock every so often, not on every cell
      if (++checked % 64 === 0 && performance.now() > until) return;
      const i = a.i0 + Math.floor(a.n / a.side);
      const k = a.k0 + (a.n % a.side);
      const d = Math.hypot((i + 0.5) * SPACING - a.cx, (k + 0.5) * SPACING - a.cz);
      // only the band beyond today's field (the field itself is already worked out)
      if (d > RADIUS - 1 && d <= reach) this.spot(i, k, false);
    }
    this.ahead = null;
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

  private place(cx: number, cz: number): void {
    const tm = this.tufts.instanceMatrix.array as Float32Array;
    const tc = this.tufts.instanceColor!.array as Float32Array;
    const fm = this.flowers.instanceMatrix.array as Float32Array;
    const fc = this.flowers.instanceColor!.array as Float32Array;
    let nt = 0;
    let nf = 0;
    /** Write a scale-rotate-translate matrix straight into an instance buffer. */
    const put = (
      m: Float32Array,
      n: number,
      D: Float32Array,
      o: number,
      sx: number,
      sy: number,
      y: number,
    ): void => {
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
    };
    const grid = (fine: boolean): void => {
      const D = (fine ? this.fine : this.coarse).data;
      const step = fine ? NEAR_SPACING : SPACING;
      const reach = fine ? NEAR : RADIUS;
      const side = fine ? NEAR_SIDE : PER_SIDE;
      const i0 = Math.floor((cx - reach) / step);
      const k0 = Math.floor((cz - reach) / step);
      for (let i = i0; i < i0 + side; i++)
        for (let k = k0; k < k0 + side; k++) {
          const o = this.spot(i, k, fine);
          if (o < 0) continue;
          const x = D[o + F.X]!;
          const z = D[o + F.Z]!;
          const y = D[o + F.Y]!;
          const d = Math.hypot(x - cx, z - cz);
          if (d > reach) continue;
          // thin out towards the rim so the field has no hard edge; a little shorter right
          // at the player's feet so the nearest clumps do not fill the view
          const fade = fine
            ? THREE.MathUtils.smoothstep(reach - d, 0, 2.5)
            : THREE.MathUtils.smoothstep(RADIUS - d, 0, RADIUS * 0.3);
          const underfoot = THREE.MathUtils.smoothstep(d, 0.8, 4);
          const size = D[o + F.SIZE]! * (0.35 + 0.65 * fade) * (0.6 + 0.4 * underfoot);
          put(tm, nt, D, o, size, size * D[o + F.TALL]!, y);
          tc[nt * 3] = D[o + F.BLADE]!;
          nt++;
          if (D[o + F.FLOWER_ROLL]! < D[o + F.FLOWER_CHANCE]!) {
            const fs = D[o + F.FLOWER_SIZE]!;
            put(fm, nf, D, o, fs, fs * 0.8, y + 0.5 * size + 0.04);
            fm[nf * 16 + 12] = x + 0.05;
            fc[nf * 3] = D[o + F.FLOWER]!;
            nf++;
          }
        }
    };
    grid(false);
    grid(true);
    this.tufts.count = nt;
    this.flowers.count = nf;
    // send only the part of each buffer in use to the GPU, not the whole capacity
    for (const [mesh, n] of [
      [this.tufts, nt],
      [this.flowers, nf],
    ] as const) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16);
      mesh.instanceMatrix.needsUpdate = true;
      const colours = mesh.instanceColor!;
      colours.clearUpdateRanges();
      colours.addUpdateRange(0, Math.max(1, n) * 3);
      colours.needsUpdate = true;
    }
  }

  /** A drift's own colour most of the time, now and then any other. */
  private flowerColour(x: number, z: number, roll: number): ColorKey {
    if (roll < 0.15) return FLOWERS[Math.floor((roll / 0.15) * FLOWERS.length)]!;
    const h = (this.hues(x / (DRIFT * 1.3), z / (DRIFT * 1.3)) + 1) / 2;
    return FLOWERS[Math.min(FLOWERS.length - 1, Math.floor(h * FLOWERS.length))]!;
  }

  dispose(): void {
    for (const mesh of [this.tufts, this.flowers]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
    this.flowerMaterial.dispose();
    this.card.dispose();
  }
}
