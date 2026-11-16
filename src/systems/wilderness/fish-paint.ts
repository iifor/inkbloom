import * as THREE from 'three';
import { Rng } from '@/world/math/rng';

type RGB = readonly [number, number, number];
const belly: RGB = [218, 214, 180],
  flank: RGB = [159, 183, 158],
  back: RGB = [61, 101, 99];
const mix = THREE.MathUtils.lerp,
  smooth = THREE.MathUtils.smoothstep;

/** A small diffuse atlas, baked once per scene. Paint stays on the swimming body
 * and the mip chain softens fine marks when several fish are seen from the bank. */
export function makeFishPaint(): THREE.DataTexture {
  const width = 256,
    height = 256;
  const data = new Uint8Array(width * height * 4);
  const over = (i: number, rgb: RGB, alpha: number) => {
    for (let ch = 0; ch < 3; ch++) data[i + ch] = mix(data[i + ch]!, rgb[ch]!, alpha);
  };
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    const h = THREE.MathUtils.clamp((v - 0.02) / 0.72, 0, 1);
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width,
        i = (y * width + x) * 4;
      data[i + 3] = 255;
      if (v > 0.77) {
        const ray = Math.cos(((v - 0.8) / 0.18) * Math.PI * 16 + 0.6 * Math.sin(u * 4));
        const edge = smooth(u, 0.15, 1);
        over(i, [106, 120, 104], 1);
        over(i, [199, 169, 129], edge * 0.91);
        over(i, [79, 97, 90], smooth(ray, 0.38, 0.95) * (0.46 - 0.12 * edge));
        continue;
      }
      const ripple = 0.017 * Math.sin(17 * u) + 0.008 * Math.sin(42 * u + 4 * h);
      const dorsal = smooth(h + ripple, 0.47, 0.94);
      const side = smooth(h, 0.08, 0.44);
      for (let ch = 0; ch < 3; ch++) data[i + ch] = mix(mix(belly[ch]!, flank[ch]!, side), back[ch]!, dorsal);
      const line = h - 0.5 - 0.035 * Math.sin(4 * u);
      const trunk = smooth(u, 0.07, 0.18) * (1 - smooth(u, 0.7, 0.8));
      over(i, [199, 151, 120], (1 - smooth(Math.abs(line), 0.013, 0.105)) * trunk * 0.59);
      // Broken, staggered scale edges sit under the lateral wash, strongest on the flank.
      const row = h * 15;
      const wave = Math.cos(2 * Math.PI * (u * 28 + 0.5 * (Math.floor(row) % 2)));
      const arc = Math.abs((row % 1) - 0.45 - wave * 0.28);
      over(i, [225, 217, 173], (1 - smooth(arc, 0.01, 0.18)) * trunk * side * (1 - dorsal) * 0.2);
      // A curved operculum and a short mouth line follow the cheek around the snout.
      const gill = 0.755 - 0.074 * Math.cos((h - 0.52) * 6.4);
      const cheek = smooth(h, 0.18, 0.34) * (1 - smooth(h, 0.69, 0.83));
      over(i, [186, 148, 116], cheek * (1 - smooth(Math.abs(u - gill - 0.024), 0.004, 0.048)) * 0.64);
      over(i, [74, 93, 87], cheek * (1 - smooth(Math.abs(u - gill), 0.002, 0.011)) * 0.77);
      const mouth = 0.43 - 0.045 * Math.sin((u - 0.9) * 18);
      over(i, [83, 92, 85], smooth(u, 0.885, 0.94) * (1 - smooth(Math.abs(h - mouth), 0.008, 0.032)));
    }
  }
  // Coordinates on the flank, from wrist to nose and from belly to spine.
  const dab = (u: number, h: number, ru: number, rh: number, rgb: RGB, strength: number) => {
    const cx = u * width,
      cy = (0.02 + h * 0.72) * height;
    const rx = ru * width,
      ry = rh * 0.72 * height;
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(height, cy + ry); y++)
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(width, cx + rx); x++) {
        const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
        over((y * width + x) * 4, rgb, strength * (1 - smooth(d, 0.32, 1)));
      }
  };
  const rng = new Rng(3761);
  for (let band = 0; band < 8; band++) {
    dab(
      0.12 + band * 0.078,
      rng.range(0.64, 0.75),
      rng.range(0.014, 0.024),
      rng.range(0.105, 0.17),
      [63, 87, 80],
      0.37,
    );
  }
  for (let i = 0; i < 58; i++) {
    const u = rng.range(0.1, 0.77),
      h = rng.range(0.48, 1);
    const ru = rng.range(0.005, 0.013),
      rh = rng.range(0.014, 0.037);
    dab(u, h, ru * 1.52, rh * 1.48, [195, 193, 154], 0.42);
    dab(u, h, ru, rh, i % 5 === 0 ? [156, 94, 70] : [54, 77, 75], 0.9);
  }
  dab(0.844, 0.605, 0.031, 0.085, [88, 97, 85], 1);
  dab(0.844, 0.61, 0.025, 0.069, [210, 184, 126], 1);
  dab(0.848, 0.611, 0.018, 0.055, [31, 42, 45], 1);
  dab(0.852, 0.628, 0.0055, 0.017, [221, 225, 199], 0.93);
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
