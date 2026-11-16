// Grass and wildflowers around the player: tufts of blades and dots of flowers on a fixed world
// grid (so they stay put as you walk), placed again whenever the player moves a few metres.
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

/** Radius of the field around the player, metres. */
const RADIUS = 34;
/** Grid spacing between tufts. */
const SPACING = 0.6;
/** The field is placed again after the player moves this far. */
const REPLACE = 3;
/** Rise over run where grass gives way to rock (the renderer paints rock from about here). */
const ROCKY = 0.95;
const PER_SIDE = Math.ceil((RADIUS * 2) / SPACING) + 1;
const MAX = PER_SIDE * PER_SIDE;

/** Per biome: chance of a tuft per grid point, chance of a flower, blade colours. */
const COVER: Partial<Record<string, { tuft: number; flower: number; blades: readonly ColorKey[] }>> = {
  grassland: { tuft: 0.9, flower: 0.1, blades: ['grass', 'grass', 'green'] },
  forest: { tuft: 0.6, flower: 0.03, blades: ['grass', 'green', 'forest'] },
  mountain: { tuft: 0.7, flower: 0.04, blades: ['grass', 'green', 'forest'] },
};
const FLOWERS: readonly ColorKey[] = ['yellow', 'yellow', 'cream', 'cream', 'pink', 'sky', 'purple'];
/** Metres across a drift of flowers. */
const DRIFT = 22;

/** A tuft of seven blades fanning out, normals pointing up so it shades like the ground. */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + i * 0.7;
    const lean = 0.08 + 0.06 * (i % 2);
    const h = 0.45 + (0.18 * ((i * 37) % 5)) / 4;
    const cx = Math.cos(a) * 0.06;
    const cz = Math.sin(a) * 0.06;
    const w = 0.03;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
    for (let k = 0; k < 3; k++) nor.push(0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

function bake(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const b = new GeometryBuilder();
  b.meshSmooth(geometry, new THREE.Matrix4(), 0);
  geometry.dispose();
  return b.build();
}

export class GrassField {
  private readonly tufts: THREE.InstancedMesh;
  private readonly flowers: THREE.InstancedMesh;
  private readonly material = makeInkMaterial({ wind: true, side: THREE.DoubleSide });
  private centre: { x: number; z: number } | null = null;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);
  /** Biome and ground height per grid point: moving a few metres only adds a thin strip. */
  private readonly ground = new Map<number, { biome: number; y: number; slope: number }>();
  /** Where flowers gather in drifts, and which colour each drift is. */
  private readonly drifts: Noise2D;
  private readonly hues: Noise2D;

  constructor(
    private readonly wilderness: Wilderness,
    root: THREE.Object3D,
  ) {
    this.drifts = createNoise2D(wilderness.seed ^ 0x51f0);
    this.hues = createNoise2D(wilderness.seed ^ 0x2b1d);
    this.tufts = new THREE.InstancedMesh(bake(tuftGeometry()), this.material, MAX);
    const head = new THREE.OctahedronGeometry(0.075, 0);
    this.flowers = new THREE.InstancedMesh(bake(head), this.material, MAX);
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
    this.centre = { x: cx, z: cz };
    this.place(cx, cz);
  }

  private place(cx: number, cz: number): void {
    const w = this.wilderness;
    const seed = w.seed;
    const names = [...BIOME_INDEX].reduce<string[]>((a, [k, i]) => ((a[i] = k), a), []);
    let nt = 0;
    let nf = 0;
    const i0 = Math.floor((cx - RADIUS) / SPACING);
    const k0 = Math.floor((cz - RADIUS) / SPACING);
    for (let i = i0; i < i0 + PER_SIDE; i++)
      for (let k = k0; k < k0 + PER_SIDE; k++) {
        /** Independent 0..1 numbers for this grid point. */
        const r = (n: number): number => unit(hashInts(seed ^ 0x6a55, i, k, n));
        const x = (i + r(0) * 0.9) * SPACING;
        const z = (k + r(1) * 0.9) * SPACING;
        const d = Math.hypot(x - cx, z - cz);
        if (d > RADIUS) continue;
        const key = (i + 32768) * 65536 + (k + 32768);
        let g = this.ground.get(key);
        if (!g) {
          const y0 = w.heightAt(x, z);
          const slope =
            Math.max(Math.abs(w.heightAt(x + 0.7, z) - y0), Math.abs(w.heightAt(x, z + 0.7) - y0)) / 0.7;
          this.ground.set(key, (g = { biome: w.biomeAt(x, z), y: y0, slope }));
        }
        const cover = COVER[names[g.biome] ?? ''];
        // nothing grows where the hillside turns to bare rock
        if (!cover || g.slope > ROCKY) continue;
        const roll = r(2);
        if (roll > cover.tuft) continue;
        const y = g.y;
        if (y <= WATER_LEVEL + 0.1) continue;
        // thin out towards the rim so the field has no hard edge
        const fade = THREE.MathUtils.smoothstep(RADIUS - d, 0, RADIUS * 0.3);
        const size = (0.6 + 0.45 * r(3)) * (0.35 + 0.65 * fade);
        this.q.setFromAxisAngle(this.up, r(4) * Math.PI * 2);
        this.s.set(size * 1.2, size * (0.75 + 0.4 * r(5)), size * 1.2);
        this.m.compose(this.p.set(x, y, z), this.q, this.s);
        this.tufts.setMatrixAt(nt, this.m);
        const blade = cover.blades[Math.floor(r(6) * cover.blades.length)]!;
        this.tufts.setColorAt(nt, this.c.setRGB(color(blade), 0, 0));
        nt++;
        // flowers gather in drifts of mostly one colour, with a few strays between them
        const drift = THREE.MathUtils.smoothstep(this.drifts(x / DRIFT, z / DRIFT), 0.25, 0.6);
        if (r(7) < cover.flower * (0.25 + 4 * drift)) {
          const fs = 0.8 + 0.5 * r(8);
          this.m.compose(
            this.p.set(x + 0.05, y + 0.3 * size + 0.04, z),
            this.q,
            this.s.set(fs, fs * 0.8, fs),
          );
          this.flowers.setMatrixAt(nf, this.m);
          this.flowers.setColorAt(nf, this.c.setRGB(color(this.flowerColour(x, z, r(9))), 0, 0));
          nf++;
        }
      }
    // forget far-away ground once the cache holds a few fields' worth
    if (this.ground.size > MAX * 4) this.ground.clear();
    this.tufts.count = nt;
    this.flowers.count = nf;
    for (const mesh of [this.tufts, this.flowers]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
  }
}
