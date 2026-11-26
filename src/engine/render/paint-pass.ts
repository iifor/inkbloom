// The paint pass's material and its fixed inputs: the palette, the seasons, the noise lattice
// and the river table, wired to the shader in paint-shader.ts. The renderer sets the rest of
// its uniforms (camera, weather, time of day) every frame.
import * as THREE from 'three';
import { type ColorDef, MAX_COLORS, PALETTE, color } from '@/content/palette';
import { SEASONS } from '@/content/seasons';
import { TUNING } from '@/content/tuning';
import { CURRENT_STEP } from '@/world/wilderness/water-current';
import type { Daylight } from './daylight';
import { shared } from './ink-material';
import { LAMP_COUNT } from './lamps';
import { NOISE_SIZE, postFrag, postVert } from './paint-shader';
import { RIVER_SAMPLES } from './water-paint';

/** The value-noise lattice: a random value per cell, read with bilinear filtering and wrapped,
 * so one texture read is one octave of smooth noise. Seeded, so every run paints alike. */
export function makeNoise(): THREE.DataTexture {
  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE);
  let h = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) {
    // xorshift32
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    data[i] = (h >>> 0) & 0xff;
  }
  const t = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export interface PaintInputs {
  /** The G-buffer and its depth. */
  readonly scene: THREE.Texture;
  readonly depth: THREE.DepthTexture;
  readonly noise: THREE.Texture;
  readonly rivers: THREE.Texture;
  readonly wakes: THREE.Texture;
  readonly wakeBounds: THREE.Vector3;
  readonly canopyBrush: THREE.Texture;
  /** The painted surface tiles and the cumulus atlas (painted-textures.ts). */
  readonly surfaces: THREE.Texture;
  readonly clouds: THREE.Texture;
  /** Painted rooms behind lit windows. */
  readonly interiors: THREE.Texture;
  readonly camera: THREE.PerspectiveCamera;
  /** Sun, sky and shade; its vectors become the pass's uniforms. */
  readonly day: Daylight;
  /** Wind travel in metres, for cloud drift. */
  readonly drift: THREE.Vector2;
  readonly year: number;
  readonly seaTemp: number;
  /** Flower seas near by and their edges' lobes (SEA_SLOTS each; see paint-shader.ts). */
  readonly seas: readonly THREE.Vector4[];
  readonly seaLobes: readonly THREE.Vector4[];
}

export function makePaintMaterial(o: PaintInputs): THREE.ShaderMaterial {
  const colors = Array.from({ length: MAX_COLORS }, (_, i) => {
    const c = PALETTE[i]?.rgb ?? [1, 0, 1];
    return new THREE.Vector3(c[0], c[1], c[2]);
  });
  const perColor = (f: (c: ColorDef) => number, fallback: number): number[] =>
    Array.from({ length: MAX_COLORS }, (_, i) => {
      const c = PALETTE[i] as ColorDef | undefined;
      return c ? f(c) : fallback;
    });
  return new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: o.scene },
      tDepth: { value: o.depth },
      uRes: { value: new THREE.Vector2(2, 2) },
      uAspect: { value: 1 },
      uNear: { value: o.camera.near },
      uFar: { value: o.camera.far },
      uReversedDepth: shared.uReversedDepth,
      uNoise: { value: o.noise },
      uRivers: { value: o.rivers },
      uRiverGrid: { value: new THREE.Vector4(1e9, 1e9, CURRENT_STEP, RIVER_SAMPLES) },
      uColors: { value: colors },
      uSolid: { value: perColor((c) => (c.solid ? 1 : 0), 0) },
      uTexture: { value: perColor((c) => c.texture ?? 0.25, 0.25) },
      uInvProj: { value: new THREE.Matrix4() },
      uInvView: { value: new THREE.Matrix4() },
      uViewProj: { value: new THREE.Matrix4() },
      uSun: { value: o.day.dir },
      uSunColor: { value: o.day.sun },
      uShade: { value: o.day.shade },
      uZenith: { value: o.day.zenith },
      uHorizon: { value: o.day.horizon },
      uNight: { value: 0 },
      uGlass: { value: color('glass') },
      uWater: { value: color('water') },
      uWildWater: { value: false },
      uWakeField: { value: o.wakes },
      uWakeBounds: { value: o.wakeBounds },
      uHasWakes: { value: false },
      uGrass: { value: color('grass') },
      uSand: { value: color('sand') },
      uCities: shared.uCities,
      uCityCount: shared.uCityCount,
      uWells: shared.uWells,
      uWellCount: shared.uWellCount,
      uDrainInner: shared.uDrainInner,
      uDrainOuter: shared.uDrainOuter,
      uSceneSat: shared.uSceneSat,
      uArena: shared.uArena,
      uInkAreas: shared.uInkAreas,
      uInkAreaCount: shared.uInkAreaCount,
      uRock: { value: color('rock') },
      uSnow: { value: color('snow') },
      uCedar: { value: color('cedar') },
      uCanopyBrush: { value: o.canopyBrush },
      uSurfaces: { value: o.surfaces },
      uClouds: { value: o.clouds },
      uInteriors: { value: o.interiors },
      uLamps: { value: Array.from({ length: LAMP_COUNT }, () => new THREE.Vector4()) },
      uSeasonKind: { value: perColor((c) => (c.season === 'meadow' ? 1 : c.season === 'leaf' ? 2 : 0), 0) },
      uMeadow: { value: SEASONS.map(({ meadow: m }) => new THREE.Vector4(...m.rgb, m.amount)) },
      uLeaf: { value: SEASONS.map(({ leaf: l }) => new THREE.Vector4(...l.rgb, l.amount)) },
      uLeafAlt: {
        value: SEASONS.map(({ leaf: l }) => new THREE.Vector4(...(l.alt ?? l.rgb), l.altShare ?? 0)),
      },
      uYear: { value: o.year },
      uStagger: { value: TUNING.season.stagger },
      uSeaTemp: { value: o.seaTemp },
      uLapse: { value: TUNING.season.lapse },
      uCloud: { value: 0 },
      uOvercast: { value: 0 },
      uFog: { value: 0 },
      uWet: { value: 0 },
      uFreshSnow: { value: 0 },
      uDrift: { value: o.drift },
      uCloudShade: { value: 0 },
      uRainbow: { value: 0 },
      uFrost: { value: 0 },
      uRainfall: { value: 0 },
      uSeas: { value: o.seas },
      uSeaLobes: { value: o.seaLobes },
      uWarm: { value: new THREE.Vector4() },
      uSkySat: { value: 1 },
      uGloom: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: postVert,
    fragmentShader: postFrag,
    depthTest: false,
    depthWrite: false,
  });
}
