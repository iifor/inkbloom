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
    /** The first city, next to spawn, is small enough to finish in one sitting. */
    firstCityChunks: 2,
    /** Paid once when every block of a city has colour again. */
    completeReward: { generic: 60, ink: 40 },
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
  combat: {
    playerHp: 100,
    /** Seconds without damage before health comes back. */
    regenDelay: 4.5,
    /** design: 11 per second while exploring */
    regenPerSecond: 11,
    /** Seconds of invulnerability after respawning. */
    respawnGrace: 2,
    /** Share of held ink dropped on death, recoverable where you fell. design: half */
    deathInkShare: 0.5,
    dropPickupRadius: 2.5,
    /** Monsters per drained block's stronghold: [min, max] for the first city and the rest. */
    stronghold: { first: [2, 3], other: [3, 6] },
    /** Chance that a stronghold monster is a spitter rather than a blot. */
    spitterChance: 0.35,
    /** Monsters that come with each ink tide: [min, max]. */
    tideMonsters: [2, 4],
    /** A monster gives up and goes home beyond this distance from its post. */
    leash: 45,
  },
  rifle: {
    damage: 20,
    /** Seconds between shots. */
    interval: 0.11,
    magazine: 24,
    reloadSeconds: 1.3,
    range: 120,
    /** Radians of random spread. */
    spread: 0.012,
  },
  interaction: {
    radius: 4,
  },
  brush: {
    /** Range and speed are per brush tier: content/brush-tiers.ts */
    largeSurfaceArea: 260,
    startingGeneric: 30,
    startingColored: 6,
  },
  blocks: {
    /** Share of coloured surfaces at which a block counts as cleared, coloured, thriving. */
    clearedAt: 0.15,
    coloredAt: 0.7,
    /** Stand-in for "all resident requests done" until requests exist. */
    thrivingAt: 0.95,
    /** Cleared blocks next to a drained one lose this share of their surfaces per minute.
     * design: 10% per 10 minutes */
    erosionPerMinute: 0.01,
  },
  tide: {
    /** Seconds of play in a city between ink tides. design: 8–12 minutes */
    intervalMin: 480,
    intervalMax: 720,
    /** First tide after entering a city comes sooner, so a short visit still sees one. */
    firstDelay: 150,
    warning: 30,
    duration: 90,
    /** A wave pushed back to its entry edge only counts as repelled after this many seconds. */
    repelAfter: 3,
    /** When no block can be struck, look again after this many seconds. */
    retry: 60,
    /** Share of the block an undefended wave sweeps in `duration`; what it leaves behind is the
     * design's 30% for a lost block. */
    reach: 0.7,
    /** Metres per second the brush pushes it back while held on the wave. */
    pushSpeed: 4,
    /** Generic pigment spent per second of pushing. */
    pushCostPerSecond: 1,
    /** How far from the eye the brush reaches the wave. */
    pushRange: 12,
    /** Held when the block keeps at least this share of colour. design: 50% */
    holdRatio: 0.5,
    reward: { generic: 12, ink: 10 },
  },
  economy: {
    /** Ink from one city ink stain. Tuned so a city's own stains plus starting pigment cover
     * about 90% of getting every block to 有色; the rest comes from one wilderness trip. */
    inkPerStain: 10,
    /** Ink stains scattered on the roads of each city chunk. */
    stainsPerChunk: 14,
    /** Walk within this many metres of a stain to soak it up. */
    stainPickupRadius: 1.8,
    /** Studio refining: this much ink makes one generic pigment. design: 2 ink = 1 */
    inkPerGeneric: 2,
    /** Seconds of play before a harvested wilderness source grows back. design: 10 min */
    regrowSeconds: 600,
  },
  save: {
    debounceMs: 1500,
  },
} as const;

export type Tuning = typeof TUNING;
