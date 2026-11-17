// Every gameplay and generation number in one place. Change values here, not in systems.
// Values marked "design" come from docs/game-design.md section 14 and are expected to move
// after playtesting.

export const TUNING = {
  world: {
    /** Metres per chunk side. */
    chunkSize: 128,
    /** Terrain cell size in metres; a chunk is chunkSize / cellSize cells across. */
    cellSize: 4,
    /** Chunks loaded around the player (Chebyshev radius). */
    loadRadius: 2,
    /** Chunks beyond this radius are unloaded. */
    unloadRadius: 3,
    /** Spawn area is flattened grassland within this many metres. */
    spawnCalmRadius: 220,
  },
  structures: {
    /** Towns: one per grid cell of this many chunks (design: one per 6–8 chunks). Each stands
     * in the middle of its cell, so neighbouring towns are always a few hundred metres apart. */
    cityGrid: 7,
    /** The first town's id comes from this chunk (ids are kept stable for saves). */
    firstCityChunk: [2, 1] as const,
    /** The first town's north-west corner, just across the river east of spawn. */
    firstTownOrigin: [260, 60] as const,
    /** A town stands this far (metres, either way) from the middle of its grid cell. */
    townJitter: 60,
    /** Share of the land's rise and fall a town keeps: its hills, gentler. */
    townRelief: 0.5,
    /** Metres over which the land eases from a town's gentler hills back to the wild ones. */
    townSkirt: 60,
    /** Trees, pigment sources, ruins and wild monsters keep this far outside a town's wall. */
    townClearance: 12,
    /** Ruins: one chance per grid cell of this many chunks. design: every 4×4 chunks, 60% */
    ruinGrid: 4,
    ruinChance: 0.6,
    /** Walk this close to a ruin's crayon to discover it. */
    ruinRadius: 6,
    /** Pigment given instead when a ruin's colour is already unlocked. */
    ruinPigment: 8,
  },
  drain: {
    /** Wilderness within this distance of an unrestored town's wall is fully drained. Town
     * walls are as little as ~140 m apart, so keep outerRadius near that or nothing between
     * two grey towns ever has colour. */
    innerRadius: 40,
    /** Drain fades out completely by this distance from the wall. */
    outerRadius: 170,
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
    /** Street widths, metres. */
    streets: { main: 7, side: 5, lane: 3.5 },
    /** How much more a street costs per cell for each unit of (rise / run)²: streets bend
     * round hills instead of climbing them. */
    climbCost: 60,
    /** Street cost added by a slow noise field, 0..this: streets wander a little. */
    wander: 0.8,
    /** Cost of a street crossing a cell of river, against 1 for open ground: streets bridge
     * the river where they must, at its narrows, and not twice where once will do. */
    bridgeCost: 30,
    /** Cost of running along an existing street, against 1 for open ground: lanes join the
     * nearest street and follow it, so they branch like a tree. */
    reuse: 0.35,
    /** Lanes reach out to points about this far apart (metres). */
    reachSpacing: 36,
    /** The town square's radius, metres. */
    square: 9,
    houses: {
      /** Width along the street and depth, metres, for a cottage; barns and shops scale it. */
      width: [7.5, 11],
      depth: [6.5, 9],
      /** Front garden between the street's edge and the house. */
      setback: [1.6, 3.4],
      /** Space between neighbouring houses along a street. */
      gap: [2.5, 7],
      /** Most the ground may rise across a house's footprint; its pad makes up the rest. */
      maxRise: 2.2,
      /** Chance of a house where there is room, from the square (first) to the wall. */
      density: [0.95, 0.4],
      floorHeight: 3.2,
    },
    /** Yards are cut into paintable patches of at most this many cells per side. */
    yardPatch: 6,
  },
  player: {
    eyeHeight: 1.65,
    height: 1.8,
    halfWidth: 0.35,
    stepHeight: 0.55,
    swimDepth: 1.15,
    swimSpeed: 3,
    walkSpeed: 6,
    sprintSpeed: 10,
    accelGround: 60,
    accelAir: 14,
    jumpSpeed: 7.6,
    gravity: 22,
    airJumps: 1,
    /** Forgiving jumps (systems/player/jump-window.ts): seconds after leaving the ground a jump
     * still counts as from the ground, and seconds a press is remembered before landing. */
    coyoteTime: 0.1,
    jumpBuffer: 0.12,
    /** Head bob at walking pace, metres (presentation only; the aim does not move). */
    bob: 0.035,
    /** Deepest camera dip on a hard landing, metres. */
    landDip: 0.22,
    /** Paper plane: hold jump while falling. design: glide ratio about 1:4 */
    glideFall: 2.6,
    glideSpeed: 11,
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
    /** Chance that the first monster of a drained wilderness chunk is a 墨巨, and that an ink
     * tide brings one along. */
    giantChance: { wild: 0.15, tide: 0.35 },
    /** Chance that a wild or tide monster that is not a spitter is a 墨鼬 rather than a blot. */
    weaselChance: 0.3,
    /** Monsters that come with each ink tide: [min, max]. */
    tideMonsters: [2, 4],
    /** A monster gives up and goes home beyond this distance from its post. */
    leash: 45,
    /** Highest ledge a monster jumps up onto, metres. Above the player's own jump (about
     * 1.3 m), so a terrace the player can jump onto is no refuge. */
    monsterJump: 1.6,
    /** Highest drop a monster's path will step down, metres. */
    monsterDrop: 4,
    /** Wilderness monsters per chunk by how drained the land is (derived saturation below
     * `drainedBelow` counts as drained, below `greyBelow` as grey): [min, max]. */
    wild: { drainedBelow: 0.35, greyBelow: 0.75, drained: [4, 7], grey: [1, 3] },
    /** Seconds of play before a defeated wilderness monster comes back. */
    wildRespawnSeconds: 900,
    /** How hits feel. design: docs/game-design.md section 8 */
    feel: {
      /** Hitting a monster while it winds up breaks the attack (破招), if the hit is at least
       * this big: the katana, sniper, launcher and staff do it, the rifle's pellets do not. */
      interruptMin: 30,
      /** Seconds a broken attack leaves the monster reeling, and the hit's damage bonus. */
      interruptStun: 0.5,
      interruptBonus: 1.3,
      /** Knockback, metres per second of shove: a katana hit, a shell's direct hit (less
       * further out), and a monster's blow on the player. About a metre each. */
      knockMelee: 6,
      knockBlast: 7,
      knockPlayer: 5,
      /** Seconds the blade and the struck monster hold still on a heavy hit (presentation). */
      hitstop: 0.05,
      /** A monster's blow slows the player to this share of their speed for a moment. */
      slowFactor: 0.7,
      slowSeconds: 0.25,
      /** A blow tips the view up this much (radians, about 1.5°); it eases back. */
      aimPunch: 0.026,
      /** Below this share of health the screen edges darken with ink. */
      lowHealth: 0.3,
    },
  },
  marks: {
    /** design: ink marks cost 10 pigment, at most 3 per world */
    cost: 10,
    max: 3,
  },
  interaction: {
    radius: 4,
  },
  brush: {
    /** Range and speed are per brush tier: content/brush-tiers.ts */
    largeSurfaceArea: 260,
    startingGeneric: 40,
  },
  blocks: {
    /** Share of coloured surfaces at which a block counts as cleared, coloured, thriving. */
    clearedAt: 0.15,
    coloredAt: 0.7,
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
    /** Metres the curtain falls back for each monster of the wave that is defeated. */
    monsterKnockBack: 6,
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
    /** A thriving block's studio makes one generic pigment per this many seconds of play.
     * design: every 5 minutes, nothing while offline */
    studioStockSeconds: 300,
    /** Most a studio holds before it is collected. */
    studioStockCap: 12,
    /** Seconds of play before a harvested wilderness source grows back. design: 10 min */
    regrowSeconds: 600,
  },
  /** Colour set free without pigment: a defeated stronghold monster gives back what it stole
   * around its post, a granted wish brightens the resident's street. Nearest drained surfaces
   * within `radius` metres, at most `max` of them. */
  release: {
    monster: { radius: 14, max: 10 },
    request: { radius: 18, max: 24 },
  },
  /** The day cycle (presentation only: light, sky, lit windows). The hour follows the world
   * clock, so it is saved with the world. */
  day: {
    /** Seconds of play for a full 24 hours. */
    length: 1440,
    /** Hour of day when a new world starts. */
    startHour: 9,
  },
  /** The year: the sun's path, plants and snow (presentation only). It follows the world
   * clock too, so no time passes while the game is closed. */
  season: {
    /** Days in each season; four seasons make a year. */
    days: 7,
    /** Day of the year a new world starts on (0 = the first day of spring). */
    startDay: 2,
    /** Degrees north. Sets how far the sun's height and the length of the day swing. */
    latitude: 35,
    /** Daily mean temperature at ground level over the year, °C: `meanTemp ± tempSwing`,
     * warmest at midsummer. */
    meanTemp: 12,
    tempSwing: 13,
    /** °C colder per metre up. Game hills are short, so far steeper than the real 6.5 °C/km:
     * peaks keep snow through spring and autumn, plains only get it in midwinter. */
    lapse: 0.4,
    /** How far apart in the year (0..1) places turn: woods change patch by patch, not at once. */
    stagger: 0.05,
  },
  /** Weather: a pure function of (seed, clock, position); see world/climate/weather.ts. */
  weather: {
    /** Metres across the two cloud fields that drift over the land and grow and fade where
     * they overlap. */
    fields: [1500, 900],
    /** The small field drifts this much faster than the wind, turned this many radians. */
    driftSpeed: 1.6,
    driftTurn: 1,
    /** Humidity (the cloud field, about -1..1) where cloud starts, and where it is overcast. */
    cloudFrom: -0.15,
    cloudFull: 0.1,
    /** Humidity where rain or snow starts, and where it is at its heaviest. */
    rainFrom: 0.13,
    rainFull: 0.45,
    /** How much the land's own moisture (forests, lakes) adds to humidity. */
    landMoisture: 0.15,
    /** °C: warmest in mid-afternoon, coldest before dawn; plus a slow wander (warm spells,
     * cold snaps) over a couple of days. */
    dayNight: 4,
    wander: 3,
    /** Gusts, as a share of the wind; and extra wind in heavy rain, metres per second. */
    gust: 0.5,
    stormWind: 6,
    /** On blustery days the prevailing wind blows up to this much stronger (1 = double),
     * rain or not; about one day in four. */
    windyDays: 1.2,
    /** Play-clock seconds: fair weather until the first, back to normal by the second. */
    calmStart: [1440, 2160],
  },
  save: {
    debounceMs: 1500,
  },
} as const;

export type Tuning = typeof TUNING;
