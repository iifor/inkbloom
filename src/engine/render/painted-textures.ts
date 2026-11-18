// The hand-painted textures the paint pass reads (paint-shader.ts, sky-paint.ts). They are
// baked from the source art in art/textures/ by tools/bake_textures.py into public/textures/
// and load after the game has started: until one arrives its place is held by a flat mid-grey
// (which changes nothing) or an empty sky, so nothing waits on them.
import * as THREE from 'three';
import { repaintCanopy } from './canopy-brush';

/** The grey tiles of brushwork, one layer each of the paint pass's texture array. Mid-grey is
 * no change; the shader darkens and lightens the palette colour by what is either side of it. */
export const SURFACE_LAYERS = [
  'drybrush',
  'plaster',
  'stone',
  'roof_clay',
  'roof_slate',
  'paving',
  'timber',
  // the page a drained place is drawn on: paper grain, and pen hatching (white paper, dark lines)
  'paper',
  'hatching',
] as const;
export type SurfaceLayer = (typeof SURFACE_LAYERS)[number];

/** A surface tile's layer in the array, for the shader. */
export function surfaceLayer(name: SurfaceLayer): number {
  return SURFACE_LAYERS.indexOf(name);
}

/** Pixels on a side of a surface tile. */
const TILE = 1024;
/** The cumulus atlas: two columns by three rows of clouds (see sky-paint.ts). */
const CLOUDS = 1024;
/** A side of each of the two leaf-cluster sheets (canopy-brush.ts). */
const CANOPY = 768;
/** The meadow's painted plants: cells this size, four across (PLANT_COLUMNS) and two down,
 * grass tufts in the top row and wildflowers in the bottom (see ink-material.ts, PLANTS). */
const PLANT_CELL = 384;
export const PLANT_COLUMNS = 4;
/** The painted rooms behind lit windows: six columns by four rows (paint-shader.ts). */
const INTERIORS = [1536, 1024] as const;

/** A baked image's pixels (RGBA bytes, rows from the top), `width` by `height`. */
async function pixels(url: string, width: number, height: number): Promise<Uint8ClampedArray> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return g.getImageData(0, 0, width, height).data;
}

export class PaintedTextures {
  /** The surface tiles, one layer each (`SURFACE_LAYERS`), repeating. */
  readonly surfaces: THREE.DataArrayTexture;
  /** The cumulus atlas: red is a cloud's light (bright on top, grey underneath), green how
   * much of the sky it covers. */
  readonly clouds: THREE.DataTexture;
  private readonly surfaceData = new Uint8Array(TILE * TILE * SURFACE_LAYERS.length).fill(128);
  private readonly cloudData = new Uint8Array(CLOUDS * CLOUDS * 2);
  /** The painted plants' atlas: red how light, green how much it covers, blue what it is
   * (0 leaf and stem, a half petal, 1 a flower's centre). */
  readonly plants: THREE.DataTexture;
  private readonly plantData = new Uint8Array(PLANT_COLUMNS * PLANT_CELL * 2 * PLANT_CELL * 4);
  /** Painted rooms, seen through windows that are lit at night. */
  readonly interiors: THREE.DataTexture;
  private readonly interiorData = new Uint8Array(INTERIORS[0] * INTERIORS[1] * 4);
  private disposed = false;

  /** `canopy` is the leaf brush sheet (canopy-brush.ts), repainted here once the painted
   * clusters arrive. */
  constructor(
    anisotropy: number,
    private readonly canopy: THREE.CanvasTexture,
  ) {
    const s = (this.surfaces = new THREE.DataArrayTexture(
      this.surfaceData,
      TILE,
      TILE,
      SURFACE_LAYERS.length,
    ));
    s.format = THREE.RedFormat;
    s.type = THREE.UnsignedByteType;
    s.wrapS = s.wrapT = THREE.RepeatWrapping;
    s.magFilter = THREE.LinearFilter;
    // far off a tile settles into its mid-grey: no shimmer, and no change to the colour
    s.minFilter = THREE.LinearMipmapLinearFilter;
    s.generateMipmaps = true;
    s.anisotropy = anisotropy;
    s.unpackAlignment = 1;
    s.needsUpdate = true;
    const c = (this.clouds = new THREE.DataTexture(
      this.cloudData,
      CLOUDS,
      CLOUDS,
      THREE.RGFormat,
      THREE.UnsignedByteType,
    ));
    c.magFilter = c.minFilter = THREE.LinearFilter;
    c.generateMipmaps = false;
    c.unpackAlignment = 1;
    c.needsUpdate = true;
    const p = (this.plants = new THREE.DataTexture(
      this.plantData,
      PLANT_COLUMNS * PLANT_CELL,
      2 * PLANT_CELL,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    ));
    p.magFilter = THREE.LinearFilter;
    p.minFilter = THREE.LinearMipmapLinearFilter;
    p.generateMipmaps = true;
    p.anisotropy = anisotropy;
    p.needsUpdate = true;
    const r = (this.interiors = new THREE.DataTexture(
      this.interiorData,
      INTERIORS[0],
      INTERIORS[1],
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    ));
    r.magFilter = THREE.LinearFilter;
    r.minFilter = THREE.LinearMipmapLinearFilter;
    r.generateMipmaps = true;
    r.needsUpdate = true;
  }

  /** Fetch the baked images and fill the textures as each arrives. A missing image is
   * reported and left as its placeholder. */
  async load(base = 'textures/'): Promise<void> {
    const jobs = SURFACE_LAYERS.map(async (name, layer) => {
      const data = await pixels(`${base}surface_${name}.webp`, TILE, TILE);
      if (this.disposed) return;
      const into = this.surfaceData.subarray(layer * TILE * TILE, (layer + 1) * TILE * TILE);
      for (let i = 0; i < into.length; i++) into[i] = data[i * 4]!;
      this.surfaces.needsUpdate = true;
    });
    jobs.push(
      (async () => {
        // light on the left half of the image, coverage on the right
        const data = await pixels(`${base}clouds.webp`, CLOUDS * 2, CLOUDS);
        if (this.disposed) return;
        for (let y = 0; y < CLOUDS; y++)
          for (let x = 0; x < CLOUDS; x++) {
            const i = (y * CLOUDS + x) * 2;
            const row = y * CLOUDS * 2;
            this.cloudData[i] = data[(row + x) * 4]!;
            this.cloudData[i + 1] = data[(row + CLOUDS + x) * 4]!;
          }
        this.clouds.needsUpdate = true;
      })(),
    );
    jobs.push(
      (async () => {
        const data = await pixels(`${base}canopy.webp`, CANOPY * 2, CANOPY);
        if (!this.disposed) repaintCanopy(this.canopy, data, CANOPY);
      })(),
      (async () => {
        // three panels side by side: light, cover, kind
        const width = PLANT_COLUMNS * PLANT_CELL;
        const height = 2 * PLANT_CELL;
        const data = await pixels(`${base}plants.webp`, width * 3, height);
        if (this.disposed) return;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const row = y * width * 3;
            this.plantData[i] = data[(row + x) * 4]!;
            this.plantData[i + 1] = data[(row + width + x) * 4]!;
            this.plantData[i + 2] = data[(row + 2 * width + x) * 4]!;
            this.plantData[i + 3] = 255;
          }
        this.plants.needsUpdate = true;
      })(),
    );
    jobs.push(
      (async () => {
        const data = await pixels(`${base}interiors.webp`, INTERIORS[0], INTERIORS[1]);
        if (this.disposed) return;
        this.interiorData.set(data);
        this.interiors.needsUpdate = true;
      })(),
    );
    for (const result of await Promise.allSettled(jobs))
      if (result.status === 'rejected') console.warn('Painted texture not loaded:', result.reason);
  }

  dispose(): void {
    this.disposed = true;
    this.surfaces.dispose();
    this.clouds.dispose();
    this.plants.dispose();
    this.interiors.dispose();
  }
}
