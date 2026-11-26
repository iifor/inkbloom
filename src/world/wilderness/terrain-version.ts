/** Saved separately from the save schema: changing terrain must never move an existing world. */
export type TerrainVersion = 1 | 2 | 3 | 4 | 5 | 6;
export const TERRAIN_VERSION: TerrainVersion = 6;
