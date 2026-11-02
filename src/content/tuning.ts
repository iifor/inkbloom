// Every gameplay and generation number in one place. Change values here, not in systems.
// Values marked "design" come from docs/game-design.md section 14 and are expected to move
// after playtesting.

export const TUNING = {
  world: {
    /** Metres per chunk side. */
    chunkSize: 128,
    /** Terrain cell size in metres; a chunk is chunkSize / cellSize cells across. */
    cellSize: 4,
    /** Terrace step height. Must stay below player.stepHeight so gentle slopes are walkable. */
    terraceStep: 0.5,
    /** Chunks loaded around the player (Chebyshev radius). */
    loadRadius: 2,
    /** Chunks beyond this radius are unloaded. */
    unloadRadius: 3,
    /** Spawn area is flattened grassland within this many metres. */
    spawnCalmRadius: 220,
  },
  structures: {
    /** City entrances: one per grid cell of this many chunks (design: one per 6–8 chunks). */
    cityGrid: 7,
    /** The first city is forced here so it is visible from spawn. */
    firstCityChunk: [2, 1] as const,
    /** Radius in metres flattened around an entrance landmark. */
    entranceFlatRadius: 40,
  },
  drain: {
    /** Wilderness within this distance of an unrestored city is fully drained. Cities are
     * ~900 m apart, so keep outerRadius well under half that or nothing is ever coloured. */
    innerRadius: 90,
    /** Drain fades out completely by this distance. */
    outerRadius: 260,
    /** Shader uniform capacity for nearby cities. */
    maxCities: 8,
  },
  city: {
    /** City side length in chunks (design: 5×5). */
    chunks: 5,
    /** Raster cell for road growth and lots, metres. */
    cell: 4,
    roads: {
      mainWidth: 3, // cells
      sideWidth: 2,
      alleyWidth: 1,
      /** Probability per cell that a growing road turns 90°. */
      turnChance: { main: 0.02, side: 0.06, alley: 0.1 },
      /** Probability per cell of spawning a branch. */
      branchChance: { main: 0.07, side: 0.06, alley: 0 },
      maxLength: { main: 200, side: 30, alley: 14 },
      minSegment: 4,
      /** Cells a main road runs straight from its gate before it may turn. */
      mainStraight: 10,
    },
    lots: {
      minSize: 3, // cells
      maxSize: 5,
      minFloors: 1,
      maxFloors: 6,
      floorHeight: 3.2,
    },
  },
  player: {
    eyeHeight: 1.65,
    height: 1.8,
    halfWidth: 0.35,
    stepHeight: 0.55,
    walkSpeed: 6,
    sprintSpeed: 10,
    accelGround: 60,
    accelAir: 14,
    jumpSpeed: 7.6,
    gravity: 22,
    airJumps: 1,
    mouseSensitivity: 0.0022,
    flySpeed: 36,
  },
  interaction: {
    radius: 4,
  },
  brush: {
    /** design: 1 second per surface */
    secondsPerSurface: 1,
    range: 6,
    largeSurfaceArea: 120,
    startingGeneric: 60,
    startingColored: 6,
  },
  save: {
    debounceMs: 1500,
  },
} as const;

export type Tuning = typeof TUNING;
