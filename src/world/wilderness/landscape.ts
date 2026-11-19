import { TUNING } from '@/content/tuning';

export interface LandscapeTile {
  readonly x: number;
  readonly z: number;
  readonly size: number;
  readonly key: string;
}

/** Aligned world tiles, small beside the player and broad in the distance. Their boundaries
 * never drift with the camera. The smallest tier covers every interactive/unloading chunk. */
export function landscapeTiles(x: number, z: number): LandscapeTile[] {
  const { chunkSize, unloadRadius, landscape: L } = TUNING.world;
  const px = (Math.floor(x / chunkSize) + 0.5) * chunkSize;
  const pz = (Math.floor(z / chunkSize) + 0.5) * chunkSize;
  const tiles: LandscapeTile[] = [];
  const distance = (tx: number, tz: number, size: number): number =>
    Math.hypot(Math.max(tx - px, 0, px - tx - size), Math.max(tz - pz, 0, pz - tz - size));
  const visit = (tx: number, tz: number, size: number): void => {
    if (
      size > chunkSize &&
      distance(tx, tz, size) < (unloadRadius + 1) * chunkSize * Math.SQRT2 + size * 0.5
    ) {
      const half = size / 2;
      for (let dz = 0; dz < 2; dz++)
        for (let dx = 0; dx < 2; dx++) visit(tx + dx * half, tz + dz * half, half);
    } else tiles.push({ x: tx, z: tz, size, key: `${tx},${tz}:${size}` });
  };
  const cx = Math.floor(px / L.rootSize),
    cz = Math.floor(pz / L.rootSize);
  for (let dz = -L.radius; dz <= L.radius; dz++)
    for (let dx = -L.radius; dx <= L.radius; dx++)
      visit((cx + dx) * L.rootSize, (cz + dz) * L.rootSize, L.rootSize);
  return tiles.sort((a, b) => distance(a.x, a.z, a.size) - distance(b.x, b.z, b.size));
}
