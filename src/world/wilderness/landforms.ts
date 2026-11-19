// Regional landforms before water and settlements. Several scales have distinct jobs:
// warped regions choose plains/foothills, a stretched ridge field connects mountains,
// and small noise only supplies the surface detail appropriate to that region.
import { hashAt } from '../math/hash';
import { createNoise2D, fbm, smoothstep } from '../math/noise';

export interface LandformSample {
  height: number;
  mountain: number;
}

export function createLandforms(seed: number): (x: number, z: number) => LandformSample {
  const noise = (salt: string) => createNoise2D(hashAt(seed, `landform-${salt}`));
  const warpX = noise('warp-x'),
    warpZ = noise('warp-z'),
    region = noise('region');
  const ridge = noise('ridge'),
    base = noise('base'),
    detail = noise('detail');
  const sample = (x: number, z: number): LandformSample => {
    const u = x + 210 * warpX(x / 1900, z / 1900);
    const v = z + 210 * warpZ(x / 1900, z / 1900);
    const province = fbm(region, u / 2300, v / 2300, 2);
    const mountain = smoothstep(-0.02, 0.42, province);
    const foothill = smoothstep(-0.3, 0.12, province);
    // Elongated, softly warped ridges instead of isolated bumps of equal size.
    const spine = (1 - Math.abs(fbm(ridge, (u + v * 0.32) / 680, (v - u * 0.2) / 1300, 3))) ** 2.4;
    const plain = 4.5 + 3 * fbm(base, u / 1200, v / 1200, 2);
    const rolling = fbm(detail, u / 210, v / 210, 3);
    return {
      height:
        plain + foothill * 6 + mountain * (14 + 78 * spine) + rolling * (0.9 + foothill * 3 + mountain * 3),
      mountain,
    };
  };
  // Height, biome and mesh-normal queries revisit the same 4 m corners. Keep exact
  // double-precision values in bounded tiles; arbitrary positions are never quantized.
  const tiles = new Map<string, Float64Array>();
  return (x, z) => {
    const ix = x / 4,
      iz = z / 4;
    if (!Number.isInteger(ix) || !Number.isInteger(iz)) return sample(x, z);
    const tx = Math.floor(ix / 32),
      tz = Math.floor(iz / 32);
    const key = `${tx},${tz}`;
    let tile = tiles.get(key);
    if (!tile) {
      if (tiles.size >= 128) tiles.delete(tiles.keys().next().value!);
      tiles.set(key, (tile = new Float64Array(32 * 32 * 2).fill(NaN)));
    }
    const i = ((iz - tz * 32) * 32 + ix - tx * 32) * 2;
    if (Number.isNaN(tile[i])) {
      const value = sample(x, z);
      tile[i] = value.height;
      tile[i + 1] = value.mountain;
    }
    return { height: tile[i]!, mountain: tile[i + 1]! };
  };
}
