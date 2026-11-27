"use strict";
var Rules = (() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name);
  var __typeError = (msg) => {
    throw TypeError(msg);
  };
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  var __await = function(promise, isYieldStar) {
    this[0] = promise;
    this[1] = isYieldStar;
  };
  var __yieldStar = (value) => {
    var obj = value[__knownSymbol("asyncIterator")], isAwait = false, method, it = {};
    if (obj == null) {
      obj = value[__knownSymbol("iterator")]();
      method = (k) => it[k] = (x) => obj[k](x);
    } else {
      obj = obj.call(value);
      method = (k) => it[k] = (v) => {
        if (isAwait) {
          isAwait = false;
          if (k === "throw") throw v;
          return v;
        }
        isAwait = true;
        return {
          done: false,
          value: new __await(new Promise((resolve) => {
            var x = obj[k](v);
            if (!(x instanceof Object)) __typeError("Object expected");
            resolve(x);
          }), 1)
        };
      };
    }
    return it[__knownSymbol("iterator")] = () => it, method("next"), "throw" in obj ? method("throw") : it.throw = (x) => {
      throw x;
    }, "return" in obj && method("return"), it;
  };

  // internal/multiplayer/rules.ts
  var rules_exports = {};
  __export(rules_exports, {
    beginPlan: () => beginPlan,
    checkpoint: () => checkpoint,
    command: () => command,
    finishPlan: () => finishPlan,
    init: () => init,
    join: () => join,
    leave: () => leave,
    tick: () => tick,
    validate: () => validate
  });

  // src/world/infection.ts
  var INFECTION_RADIUS = 36;
  function sameScene(a, b) {
    return a.kind === b.kind && (a.kind === "wild" || b.kind === "city" && a.id === b.id);
  }
  function inInfectionArea(center, p) {
    return (center.x - p.x) ** 2 + (center.z - p.z) ** 2 <= INFECTION_RADIUS ** 2;
  }
  function areaKey(p) {
    return [p.scene.kind === "wild" ? "wild" : p.scene.id, Math.round(p.x), Math.round(p.z)].join(":");
  }
  function validInkSite(v) {
    var _a2, _b;
    const s = v;
    return !!s && (((_a2 = s.scene) == null ? void 0 : _a2.kind) === "wild" || ((_b = s.scene) == null ? void 0 : _b.kind) === "city" && /^c-?\d+_-?\d+$/.test(s.scene.id)) && [s.x, s.y, s.z].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e6);
  }

  // src/content/tuning.ts
  var TUNING = {
    world: {
      /** Metres per chunk side. */
      chunkSize: 128,
      /** Terrain cell size in metres; a chunk is chunkSize / cellSize cells across. */
      cellSize: 4,
      /** Chunks loaded around the player (Chebyshev radius). */
      loadRadius: 2,
      /** Chunks beyond this radius are unloaded. */
      unloadRadius: 3,
      /** Decorative ground cover streams ahead of the visible field, within a per-frame CPU budget. */
      grassStreaming: { buildMs: 1.5, ahead: 8 },
      /** Per-frame CPU allowances and disposal limit for streamed world detail. */
      streaming: { chunkMs: 2, riverMs: 0.8, sceneryMs: 0.5, unloads: 2 },
      /** Visual-only terrain beyond the interactive chunks; no actors or colliders. */
      landscape: { rootSize: 1024, radius: 3, cells: 8, far: 5e3, hazeStart: 1600, hazeEnd: 3e3 },
      /** Spawn area is flattened grassland within this many metres. */
      spawnCalmRadius: 220
    },
    structures: {
      /** Towns: one per grid cell of this many chunks (design: one per 6–8 chunks). Each stands
       * in the middle of its cell, so neighbouring towns are always a few hundred metres apart. */
      cityGrid: 7,
      /** The first town's id comes from this chunk (ids are kept stable for saves). */
      firstCityChunk: [2, 1],
      /** The first town's north-west corner, just across the river east of spawn. */
      firstTownOrigin: [260, 60],
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
      ruinPigment: 8
    },
    drain: {
      /** Wilderness within this distance of an unrestored town's wall is fully drained. Town
       * walls are as little as ~140 m apart, so keep outerRadius near that or nothing between
       * two grey towns ever has colour. */
      innerRadius: 40,
      /** Drain fades out completely by this distance from the wall. */
      outerRadius: 170,
      /** Shader uniform capacity for nearby cities. */
      maxCities: 8
    },
    city: {
      /** City side length in chunks (design: 5×5). */
      chunks: 5,
      /** The peaceful village next to spawn is smaller than other towns. */
      firstCityChunks: 2,
      /** Naturally peaceful share of other villages; the first village is always peaceful. */
      peacefulChance: 0.2,
      settlements: {
        /** Relative frequency of small villages, medium villages and larger towns. */
        smallShare: 0.45,
        mediumShare: 0.35,
        small: [1, 2],
        medium: [3],
        town: [4, 5],
        /** Other rolls split equally between the other two materials and no boundary. */
        typicalBoundary: 0.85
      },
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
        floorHeight: 3.2
      },
      /** Yards are cut into paintable patches of at most this many cells per side. */
      yardPatch: 6
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
      terminalFallSpeed: 48,
      /** Impact speeds in m/s: ordinary jumps are safe; 32 costs 100 HP before protection. */
      fallSafeSpeed: 12,
      fallSevereSpeed: 32,
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
      mouseSensitivity: 22e-4,
      flySpeed: 18,
      /** Free flight (F2) goes no higher than this, metres: the land seen as a map, still within
       * the camera's reach. */
      flyCeiling: 300
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
      /** Upper end of the wild kind roll reserved for ink frogs. */
      wildFrogChance: 0.12,
      /** Share of wild rolls reserved for imported wilderness creatures other than frogs. */
      wildCreatureChance: 0.23,
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
      /** Ink wells (墨泉) in grey land: the chance a chunk near an unrestored town has one, its
       * guards ([min, max]), what cleansing it pays, metres round it the colour comes back
       * (`bloom`), and how close a player must stand to cleanse it (`reach`). */
      wells: { chance: 0.16, guards: [2, 3], ink: 20, pigment: 8, bloom: 45, reach: 4 },
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
        lowHealth: 0.3
      }
    },
    marks: {
      /** design: ink marks cost 10 pigment, at most 3 per world */
      cost: 10,
      max: 3
    },
    interaction: {
      radius: 4
    },
    brush: {
      /** Range and speed are per brush tier: content/brush-tiers.ts */
      largeSurfaceArea: 260,
      startingGeneric: 40
    },
    blocks: {
      /** Share of coloured surfaces at which a block counts as cleared, coloured, thriving. */
      clearedAt: 0.15,
      coloredAt: 0.7,
      thrivingAt: 1,
      /** Cleared blocks next to a drained one lose this share of their surfaces per minute.
       * design: 10% per 10 minutes */
      erosionPerMinute: 0.01
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
      monsterKnockBack: 6
    },
    economy: {
      /** Metres within which a wilderness pigment source is drawn (beyond it is a few pixels). */
      sourceView: 140,
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
      regrowSeconds: 600
    },
    /** Colour set free without pigment: a defeated stronghold monster gives back what it stole
     * around its post. Nearest drained surfaces
     * within `radius` metres, at most `max` of them. */
    release: {
      monster: { radius: 14, max: 10 }
    },
    /** The day cycle (presentation only: light, sky, lit windows). The hour follows the world
     * clock, so it is saved with the world. */
    day: {
      /** Seconds of play for a full 24 hours. */
      length: 1440,
      /** Hour of day when a new world starts. */
      startHour: 9
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
      stagger: 0.05
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
      calmStart: [1440, 2160]
    },
    save: {
      debounceMs: 1500
    }
  };

  // src/world/math/rng.ts
  var Rng = class {
    constructor(seed) {
      __publicField(this, "state");
      this.state = seed >>> 0 || 1831565813;
    }
    /** Uniform in [0, 1). mulberry32. */
    next() {
      let t = this.state = this.state + 1831565813 >>> 0;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    range(min, max) {
      return min + (max - min) * this.next();
    }
    /** Integer in [min, max] inclusive. */
    int(min, max) {
      return min + Math.floor(this.next() * (max - min + 1));
    }
    chance(p) {
      return this.next() < p;
    }
    pick(items) {
      if (items.length === 0) throw new RangeError("Cannot pick from an empty list");
      return items[Math.floor(this.next() * items.length)];
    }
  };

  // src/world/wilderness/water-level.ts
  var WATER_LEVEL = -0.75;

  // src/world/city/site.ts
  var ROAD_NONE = 0;
  var ROAD_ALLEY = 1;
  var ROAD_SIDE = 2;
  var ROAD_MAIN = 3;
  var DX = [1, 0, -1, 0];
  var DZ = [0, 1, 0, -1];
  var GATE_HALF = 2;
  var WET = WATER_LEVEL + 0.2;
  function groundAt(l, x, z) {
    const n = l.n;
    const gx = Math.min(n, Math.max(0, (x - l.ox) / l.cell));
    const gz = Math.min(n, Math.max(0, (z - l.oz) / l.cell));
    const ix = Math.min(n - 1, Math.floor(gx));
    const iz = Math.min(n - 1, Math.floor(gz));
    const u = gx - ix;
    const v = gz - iz;
    const h = l.heights;
    const a = iz * (n + 1) + ix;
    const c10 = h[a + 1];
    const c01 = h[a + n + 1];
    if (u + v <= 1) return (1 - u - v) * h[a] + u * c10 + v * c01;
    return (u + v - 1) * h[a + n + 2] + (1 - v) * c10 + (1 - u) * c01;
  }
  function surveySite(seed, chunks, height) {
    const cell = TUNING.city.cell;
    const n = Math.round(chunks * TUNING.world.chunkSize / cell);
    const size = n * cell;
    const idx = (ix, iz) => iz * n + ix;
    const heights = new Float32Array((n + 1) * (n + 1));
    for (let kz = 0; kz <= n; kz++)
      for (let kx = 0; kx <= n; kx++) heights[kz * (n + 1) + kx] = height(kx * cell, kz * cell);
    const land = { ox: 0, oz: 0, n, cell, heights };
    const ground = (x, z) => groundAt(land, x, z);
    const corner = (kx, kz) => heights[Math.min(n, Math.max(0, kz)) * (n + 1) + Math.min(n, Math.max(0, kx))];
    const water = new Uint8Array(n * n);
    for (let iz = 0; iz < n; iz++)
      for (let ix = 0; ix < n; ix++)
        water[idx(ix, iz)] = ground((ix + 0.5) * cell, (iz + 0.5) * cell) < WET ? 1 : 0;
    const slope = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++)
      for (let ix = 0; ix < n; ix++) {
        const c = [corner(ix, iz), corner(ix + 1, iz), corner(ix, iz + 1), corner(ix + 1, iz + 1)];
        slope[idx(ix, iz)] = (Math.max(...c) - Math.min(...c)) / cell;
      }
    const per = TUNING.world.chunkSize;
    const surfaces = [];
    return {
      seed,
      rng: new Rng(seed),
      chunks,
      n,
      cell,
      size,
      heights,
      water,
      slope,
      surfaces,
      idx,
      inside: (ix, iz) => ix >= 1 && iz >= 1 && ix < n - 1 && iz < n - 1,
      ground,
      corner,
      nearWater: (ix, iz, r) => {
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            const x = ix + dx;
            const z = iz + dz;
            if (x >= 0 && z >= 0 && x < n && z < n && water[idx(x, z)]) return true;
          }
        return false;
      },
      centreOf: (i) => ({ x: (i % n + 0.5) * cell, z: (Math.floor(i / n) + 0.5) * cell }),
      chunkOf: (x, z) => Math.min(chunks - 1, Math.max(0, Math.floor(z / per))) * chunks + Math.min(chunks - 1, Math.max(0, Math.floor(x / per))),
      addSurface: (kind, chunk, c, area, x, z) => {
        surfaces.push({ kind, chunk, color: c, area, x, z });
        return surfaces.length - 1;
      }
    };
  }

  // src/world/city/gates.ts
  var GATE_DIR = { pz: 3, nz: 1, px: 2, nx: 0 };
  var OTHER_WALLS = {
    pz: ["nx", "px", "nz"],
    nz: ["px", "nx", "pz"],
    px: ["pz", "nz", "nx"],
    nx: ["nz", "pz", "px"]
  };
  function chooseGates(n, rng, main, nearWater) {
    const gates = [];
    const mid = Math.floor(n / 2);
    const jitter = () => rng.int(-Math.floor(n / 8), Math.floor(n / 8));
    const gateIn = (wall, wanted, isMain) => {
      const dir = GATE_DIR[wall];
      const edge = wall === "px" || wall === "pz" ? n - 1 : 0;
      const make = (at) => wall === "px" || wall === "nx" ? { ix: edge, iz: at, dir, main: isMain } : { ix: at, iz: edge, dir, main: isMain };
      for (let k = 0; k < n / 2; k++)
        for (const at of [wanted + k, wanted - k]) {
          if (at < GATE_HALF + 2 || at > n - GATE_HALF - 3) continue;
          const g = make(at);
          if (!nearWater(g.ix + DX[dir] * 2, g.iz + DZ[dir] * 2, GATE_HALF + 1)) return g;
        }
      return make(wanted);
    };
    gates.push(gateIn(main, mid + jitter(), true));
    const [left, right, across] = OTHER_WALLS[main];
    if (rng.chance(0.7)) gates.push(gateIn(left, mid + jitter(), false));
    if (rng.chance(0.7)) gates.push(gateIn(right, mid + jitter(), false));
    if (rng.chance(0.5)) gates.push(gateIn(across, mid + jitter(), false));
    return gates;
  }
  function placeGates(site, main) {
    const { n, rng, idx } = site;
    const gates = chooseGates(n, rng, main, (ix, iz, r) => site.nearWater(ix, iz, r));
    const gateCell = new Uint8Array(n * n);
    for (const g of gates)
      for (let k = -GATE_HALF; k <= GATE_HALF; k++) {
        const along = g.dir === 0 || g.dir === 2;
        gateCell[along ? idx(g.ix, g.iz + k) : idx(g.ix + k, g.iz)] = 1;
      }
    return { gates, gateCell };
  }
  function placeSquare(site) {
    const { n, cell, idx, corner } = site;
    const mid = Math.floor(n / 2);
    const reach = Math.max(2, Math.floor(n * 0.2));
    let sq = idx(mid, mid);
    let sqScore = Infinity;
    for (let iz = mid - reach; iz <= mid + reach; iz += 2)
      for (let ix = mid - reach; ix <= mid + reach; ix += 2) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let dz = -3; dz <= 3; dz++)
          for (let dx = -3; dx <= 3; dx++) {
            const h = corner(ix + dx, iz + dz);
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
          }
        const score = (hi - lo) / (6 * cell) + 0.25 * Math.hypot(ix - mid, iz - mid) / reach + (site.nearWater(ix, iz, 5) ? 10 : 0);
        if (score < sqScore) {
          sqScore = score;
          sq = idx(ix, iz);
        }
      }
    const sqx = sq % n;
    const sqz = (sq - sqx) / n;
    return { square: { x: (sqx + 0.5) * cell, z: (sqz + 0.5) * cell, r: TUNING.city.square }, at: sq };
  }
  function townGates(e, w) {
    const cell = TUNING.city.cell;
    const n = Math.round(e.chunks * TUNING.world.chunkSize / cell);
    const heights = new Float32Array((n + 1) * (n + 1)).fill(Number.NaN);
    const land = { ox: 0, oz: 0, n, cell, heights };
    const corner = (kx, kz) => {
      const i = kz * (n + 1) + kx;
      if (Number.isNaN(heights[i])) heights[i] = w.heightAt(e.ox + kx * cell, e.oz + kz * cell);
    };
    const nearWater = (ix, iz, r) => {
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const x = ix + dx;
          const z = iz + dz;
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          corner(x, z);
          corner(x + 1, z);
          corner(x, z + 1);
          corner(x + 1, z + 1);
          if (groundAt(land, (x + 0.5) * cell, (z + 0.5) * cell) < WET) return true;
        }
      return false;
    };
    return chooseGates(n, new Rng(e.seed), e.gate, nearWater).map((g) => ({
      x: e.ox + (g.ix + 0.5) * cell,
      z: e.oz + (g.iz + 0.5) * cell,
      outX: -DX[g.dir],
      outZ: -DZ[g.dir],
      main: g.main
    }));
  }

  // src/world/math/hash.ts
  function hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function mix(h) {
    h = Math.imul(h ^ h >>> 16, 2246822507);
    h = Math.imul(h ^ h >>> 13, 3266489909);
    return (h ^ h >>> 16) >>> 0;
  }
  function hashInts(seed, ...values) {
    let h = mix(seed >>> 0);
    for (const v of values) h = mix(h ^ Math.imul((v | 0) + 2654435769, 668265261));
    return h;
  }
  function hashAt(seed, salt, ...values) {
    return hashInts(seed ^ hashString(salt), ...values);
  }
  var unit = (h) => (h >>> 0) / 4294967296;

  // src/world/nav/path.ts
  var OFFSET = 1 << 15;
  var Heap = class {
    constructor() {
      __publicField(this, "keys", []);
      __publicField(this, "f", []);
    }
    get size() {
      return this.keys.length;
    }
    push(k, f) {
      this.keys.push(k);
      this.f.push(f);
      let i = this.keys.length - 1;
      while (i > 0) {
        const p = i - 1 >> 1;
        if (this.f[p] <= this.f[i]) break;
        this.swap(i, p);
        i = p;
      }
    }
    pop() {
      const top = this.keys[0];
      const lastK = this.keys.pop();
      const lastF = this.f.pop();
      if (this.keys.length) {
        this.keys[0] = lastK;
        this.f[0] = lastF;
        let i = 0;
        for (; ; ) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < this.keys.length && this.f[l] < this.f[m]) m = l;
          if (r < this.keys.length && this.f[r] < this.f[m]) m = r;
          if (m === i) break;
          this.swap(i, m);
          i = m;
        }
      }
      return top;
    }
    swap(a, b) {
      [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
      [this.f[a], this.f[b]] = [this.f[b], this.f[a]];
    }
  };

  // src/world/math/noise.ts
  var F2 = 0.5 * (Math.sqrt(3) - 1);
  var G2 = (3 - Math.sqrt(3)) / 6;
  var GRAD = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];
  function createNoise2D(seed) {
    const rng = new Rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const corner = (gi, x, y) => {
      const t = 0.5 - x * x - y * y;
      if (t < 0) return 0;
      const g = GRAD[gi & 7];
      const t2 = t * t;
      return t2 * t2 * (g[0] * x + g[1] * y);
    };
    return (xin, yin) => {
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s);
      const j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const x0 = xin - (i - t);
      const y0 = yin - (j - t);
      const i1 = x0 > y0 ? 1 : 0;
      const j1 = x0 > y0 ? 0 : 1;
      const x1 = x0 - i1 + G2;
      const y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2;
      const y2 = y0 - 1 + 2 * G2;
      const ii = i & 255;
      const jj = j & 255;
      const n0 = corner(perm[ii + perm[jj]], x0, y0);
      const n1 = corner(perm[ii + i1 + perm[jj + j1]], x1, y1);
      const n2 = corner(perm[ii + 1 + perm[jj + 1]], x2, y2);
      return 70 * (n0 + n1 + n2);
    };
  }
  function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
  var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  var lerp = (a, b, t) => a + (b - a) * t;

  // src/content/palette.ts
  var PALETTE = [
    { key: "blue", name: "\u5B9D\u84DD", rgb: [0.27, 0.43, 0.74], paintable: true },
    { key: "red", name: "\u6731\u7EA2", rgb: [0.84, 0.34, 0.33], paintable: true },
    { key: "orange", name: "\u6A59", rgb: [0.94, 0.6, 0.27], paintable: true },
    { key: "yellow", name: "\u9E45\u9EC4", rgb: [0.96, 0.84, 0.43], paintable: true },
    { key: "green", name: "\u7FE0\u7EFF", rgb: [0.36, 0.64, 0.37], paintable: true, texture: 0.4 },
    { key: "teal", name: "\u9752", rgb: [0.2, 0.55, 0.54], paintable: true },
    { key: "sky", name: "\u5929\u84DD", rgb: [0.48, 0.73, 0.88], paintable: true },
    { key: "purple", name: "\u7D2B\u7F57\u5170", rgb: [0.56, 0.44, 0.71], paintable: true },
    { key: "pink", name: "\u73AB\u7C89", rgb: [0.92, 0.6, 0.66], paintable: true },
    { key: "brown", name: "\u6817\u68D5", rgb: [0.58, 0.39, 0.25], paintable: true },
    { key: "cream", name: "\u7C73\u767D", rgb: [0.97, 0.93, 0.81], paintable: true },
    { key: "charcoal", name: "\u70AD\u7070", rgb: [0.34, 0.35, 0.39], paintable: true },
    // natural colours, not offered by the brush
    { key: "grass", name: "\u8349\u5730", rgb: [0.47, 0.74, 0.3], paintable: false, texture: 1, season: "meadow" },
    { key: "forest", name: "\u6797\u5730", rgb: [0.2, 0.45, 0.26], paintable: false, texture: 1, season: "meadow" },
    { key: "rock", name: "\u5CA9\u77F3", rgb: [0.62, 0.58, 0.52], paintable: false, texture: 0.7 },
    { key: "water", name: "\u6C34\u9762", rgb: [0.36, 0.7, 0.78], paintable: false, texture: 0.35 },
    { key: "sand", name: "\u6C99\u571F", rgb: [0.86, 0.78, 0.6], paintable: false, texture: 0.5 },
    { key: "stone", name: "\u77F3\u677F\u8DEF", rgb: [0.77, 0.75, 0.71], paintable: false, texture: 0.45 },
    { key: "bark", name: "\u6811\u76AE", rgb: [0.4, 0.3, 0.22], paintable: false, texture: 0.6 },
    { key: "snow", name: "\u96EA", rgb: [0.96, 0.97, 1], paintable: false, texture: 0.3 },
    // the ink tide's own black, darker than any paint
    { key: "ink", name: "\u58A8", rgb: [0.06, 0.06, 0.09], paintable: false, solid: true },
    // window glass: blue-grey with the sky in it
    { key: "glass", name: "\u73BB\u7483", rgb: [0.33, 0.46, 0.56], paintable: false, texture: 0.05 },
    // plants that change with the seasons; the paintable 翠绿 stays put on walls and graffiti
    { key: "leaf", name: "\u9614\u53F6", rgb: [0.36, 0.64, 0.37], paintable: false, texture: 0.4, season: "leaf" },
    { key: "canopy", name: "\u6797\u51A0", rgb: [0.2, 0.45, 0.26], paintable: false, texture: 1, season: "leaf" },
    { key: "cedar", name: "\u6749", rgb: [0.18, 0.42, 0.29], paintable: false, texture: 1 },
    { key: "sprout", name: "\u5AE9\u8349", rgb: [0.36, 0.64, 0.37], paintable: false, texture: 0.4, season: "meadow" },
    // player characters' skin, smooth: content/characters.ts
    { key: "skinLight", name: "\u6D45\u80A4", rgb: [0.96, 0.82, 0.71], paintable: false, texture: 0.1 },
    { key: "skinWarm", name: "\u6696\u80A4", rgb: [0.87, 0.67, 0.51], paintable: false, texture: 0.1 },
    { key: "skinDeep", name: "\u6DF1\u80A4", rgb: [0.55, 0.36, 0.27], paintable: false, texture: 0.1 },
    { key: "clayTile", name: "\u9676\u74E6", rgb: [0.68, 0.36, 0.26], paintable: false, texture: 0.38 },
    { key: "slateTile", name: "\u9752\u74E6", rgb: [0.32, 0.43, 0.45], paintable: false, texture: 0.35 },
    { key: "limewash", name: "\u7070\u6CE5", rgb: [0.9, 0.82, 0.66], paintable: false, texture: 0.26 }
  ];
  var INDEX = new Map(PALETTE.map((c, i) => [c.key, i]));
  function color(key) {
    const i = INDEX.get(key);
    if (i === void 0) throw new Error(`Unknown colour: ${key}`);
    return i;
  }
  var PAINTABLE = PALETTE.flatMap((c, i) => c.paintable ? [i] : []);
  var MAX_COLORS = 32;
  if (PALETTE.length > MAX_COLORS) throw new Error("Palette exceeds shader capacity");

  // src/content/biomes.ts
  var BIOMES = [
    {
      key: "water",
      name: "\u6E56\u6CB3",
      ground: color("sand"),
      cliff: color("sand"),
      treeDensity: 0,
      treeColor: color("canopy"),
      treeMaxSlope: 0
    },
    {
      key: "mountain",
      name: "\u5C71\u5730",
      // green hills; bare rock only where it is steep (painted in by the renderer)
      ground: color("grass"),
      cliff: color("rock"),
      treeDensity: 0.012,
      treeColor: color("canopy"),
      treeMaxSlope: 1
    },
    {
      key: "forest",
      name: "\u68EE\u6797",
      // a sunny floor under dark crowns
      ground: color("grass"),
      cliff: color("rock"),
      treeDensity: 0.12,
      treeColor: color("canopy"),
      treeMaxSlope: 1.5
    },
    {
      key: "grassland",
      name: "\u8349\u539F",
      ground: color("grass"),
      cliff: color("rock"),
      treeDensity: 8e-3,
      treeColor: color("leaf"),
      treeMaxSlope: 1.5
    }
  ];
  var BIOME_INDEX = new Map(BIOMES.map((b, i) => [b.key, i]));
  var RULES = [
    { biome: "water", when: (s) => s.water < 0.045 && s.wildness > 0.3 },
    { biome: "mountain", when: (s) => s.relief > 0.35 && s.wildness > 0.5 },
    { biome: "forest", when: (s) => s.moisture > 0.15 },
    { biome: "grassland", when: () => true }
  ];
  function climateBiome(s) {
    return RULES.find((rule) => rule.when(s)).biome;
  }

  // src/world/city/settlement.ts
  function settlementSize(chunks) {
    return chunks <= 2 ? "small" : chunks <= 3 ? "medium" : "town";
  }
  function settlementChunks(seed, cx, cz) {
    const roll2 = unit(hashAt(seed, "settlement-size", cx, cz));
    const sizes = TUNING.city.settlements;
    const range = roll2 < sizes.smallShare ? sizes.small : roll2 < sizes.smallShare + sizes.mediumShare ? sizes.medium : sizes.town;
    return range[hashAt(seed, "settlement-size-variant", cx, cz) % range.length];
  }
  function settlementBoundary(seed, chunks) {
    const typical = { small: "fence", medium: "wall", town: "stone" };
    const main = typical[settlementSize(chunks)];
    if (unit(hashAt(seed, "settlement-boundary")) < TUNING.city.settlements.typicalBoundary) return main;
    const others = ["fence", "wall", "stone", "none"].filter((kind) => kind !== main);
    return others[hashAt(seed, "settlement-boundary-other") % others.length];
  }

  // src/world/wilderness/landforms.ts
  function createLandforms(seed) {
    const noise = (salt) => createNoise2D(hashAt(seed, `landform-${salt}`));
    const warpX = noise("warp-x"), warpZ = noise("warp-z"), region = noise("region");
    const ridge = noise("ridge"), base = noise("base"), detail = noise("detail");
    const sample = (x, z) => {
      const u = x + 210 * warpX(x / 1900, z / 1900);
      const v = z + 210 * warpZ(x / 1900, z / 1900);
      const province = fbm(region, u / 2300, v / 2300, 2);
      const mountain = smoothstep(-0.02, 0.42, province);
      const foothill = smoothstep(-0.3, 0.12, province);
      const spine = (1 - Math.abs(fbm(ridge, (u + v * 0.32) / 680, (v - u * 0.2) / 1300, 3))) ** 2.4;
      const plain = 4.5 + 3 * fbm(base, u / 1200, v / 1200, 2);
      const rolling = fbm(detail, u / 210, v / 210, 3);
      return {
        height: plain + foothill * 6 + mountain * (14 + 78 * spine) + rolling * (0.9 + foothill * 3 + mountain * 3),
        mountain
      };
    };
    const tiles = /* @__PURE__ */ new Map();
    return (x, z) => {
      const ix = x / 4, iz = z / 4;
      if (!Number.isInteger(ix) || !Number.isInteger(iz)) return sample(x, z);
      const tx = Math.floor(ix / 32), tz = Math.floor(iz / 32);
      const key = `${tx},${tz}`;
      let tile = tiles.get(key);
      if (!tile) {
        if (tiles.size >= 128) tiles.delete(tiles.keys().next().value);
        tiles.set(key, tile = new Float64Array(32 * 32 * 2).fill(NaN));
      }
      const i = ((iz - tz * 32) * 32 + ix - tx * 32) * 2;
      if (Number.isNaN(tile[i])) {
        const value = sample(x, z);
        tile[i] = value.height;
        tile[i + 1] = value.mountain;
      }
      return { height: tile[i], mountain: tile[i + 1] };
    };
  }

  // src/world/wilderness/river-corridors.ts
  var RIVER_LANE = 720;
  var RIVER_X = 62;
  var RIVER_ORIGIN = TUNING.world.chunkSize / 2 + RIVER_X;

  // src/world/wilderness/drainage.ts
  var DRAINAGE_REACH = 1024;
  function riverPool(lane, z) {
    const reach = 0.68 * Math.sin(z / 36 + lane * 2.1) + 0.32 * Math.sin(z / 17 - lane * 1.7);
    return smoothstep(-0.7, 0.72, reach);
  }
  function riverBankWidth(half, lane, z, side) {
    const spread = lerp(0.8, 1.21, riverPool(lane, z));
    const bends = 0.1 * Math.sin(z / 27 + side * 1.5 + lane) + 0.06 * Math.sin(z / 11 + side * 1.9);
    return half * (spread + bends);
  }
  var STEP = 64;
  var COLUMNS = 13;
  var SPACING = 32;
  var HALF = 6;
  function projectChannel(channel, x, z, half) {
    var _a2;
    if (x < channel.minX || x > channel.maxX || z < channel.minZ || z > channel.maxZ) return null;
    let best = null;
    for (let i = 0; i + 1 < channel.points.length; i++) {
      const a = channel.points[i], b = channel.points[i + 1];
      if (x < Math.min(a.x, b.x) - half || x > Math.max(a.x, b.x) + half || z < Math.min(a.z, b.z) - half || z > Math.max(a.z, b.z) + half) continue;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
      const t = Math.max(0, Math.min(length, (x - a.x) * dx + (z - a.z) * dz));
      const px = a.x + dx * t, pz = a.z + dz * t;
      const distance = Math.hypot(x - px, z - pz);
      if (distance < ((_a2 = best == null ? void 0 : best.distance) != null ? _a2 : half)) best = { x: px, z: pz, dx, dz, distance, half };
    }
    return best;
  }
  var CROSS_BANK = 24;
  var STARTER_CENTER = RIVER_ORIGIN - RIVER_X;
  function createDrainage(seed, elevation, connected = false, shapedBed = false) {
    const reaches = /* @__PURE__ */ new Map();
    const anchors = /* @__PURE__ */ new Map();
    const crossChannels = /* @__PURE__ */ new Map();
    const xpos = (lane, column) => RIVER_ORIGIN + lane * RIVER_LANE + (column - HALF) * SPACING;
    const anchor = (lane, row) => {
      const key = `${lane},${row}`;
      const known = anchors.get(key);
      if (known !== void 0) return known;
      let best = HALF, score = Infinity;
      for (let c = 0; c < COLUMNS; c++) {
        const h = elevation(xpos(lane, c), row * DRAINAGE_REACH);
        const cost = h + Math.abs(c - HALF) * 0.45;
        if (cost < score) {
          score = cost;
          best = c;
        }
      }
      if (anchors.size > 512) anchors.clear();
      anchors.set(key, best);
      return best;
    };
    const reach = (lane, row) => {
      const key = `${lane},${row}`;
      const known = reaches.get(key);
      if (known) return known;
      const rows = DRAINAGE_REACH / STEP;
      const start = anchor(lane, row), end = anchor(lane, row + 1);
      const costs = new Float64Array((rows + 1) * COLUMNS).fill(Infinity);
      const parents = new Int8Array(costs.length).fill(-1);
      costs[start] = 0;
      for (let r = 1; r <= rows; r++)
        for (let c = 0; c < COLUMNS; c++) {
          const x = xpos(lane, c), z = row * DRAINAGE_REACH + r * STEP;
          const h = elevation(x, z);
          const cut = h + Math.max(0, h - 12) * 1.8;
          for (let prev = Math.max(0, c - 1); prev <= Math.min(COLUMNS - 1, c + 1); prev++) {
            const cost = costs[(r - 1) * COLUMNS + prev] + cut + 4 * (c - prev) ** 2 + 0.15 * Math.abs(c - HALF);
            if (cost < costs[r * COLUMNS + c]) {
              costs[r * COLUMNS + c] = cost;
              parents[r * COLUMNS + c] = prev;
            }
          }
        }
      const xs = new Float64Array(rows + 1);
      for (let r = rows, c = end; r >= 0; r--) {
        xs[r] = xpos(lane, c);
        if (r) c = parents[r * COLUMNS + c];
      }
      const raw = xs.slice();
      for (let r = 1; r < rows; r++) xs[r] = (raw[r - 1] + 2 * raw[r] + raw[r + 1]) / 4;
      const roll2 = hashAt(seed, "drainage-basin", lane, row);
      let lake = null;
      if (unit(roll2) < 0.58) {
        let at = 4, best = Infinity;
        for (const r of [4, 8, 12]) {
          const x = xs[r], z = row * DRAINAGE_REACH + r * STEP;
          const h = elevation(x, z);
          const rough = Math.abs(elevation(x - 64, z) - elevation(x + 64, z));
          if (h + rough < best) {
            best = h + rough;
            at = r;
          }
        }
        if (best < 22)
          lake = {
            x: xs[at] + (unit(hashAt(roll2, "side")) < 0.5 ? -22 : 22),
            z: row * DRAINAGE_REACH + at * STEP,
            rx: 55 + 32 * unit(hashAt(roll2, "width")),
            rz: 65 + 55 * unit(hashAt(roll2, "length"))
          };
      }
      const side = unit(hashAt(roll2, "feeder-side")) < 0.5 ? -1 : 1;
      const join2 = 8 + Math.floor(unit(hashAt(roll2, "join")) * 5);
      const points = [];
      let bed = Infinity;
      for (let i = 0; i <= 6; i++) {
        const t = i / 6, z = row * DRAINAGE_REACH + (join2 - 4 * (1 - t)) * STEP;
        const r = Math.max(0, Math.min(rows - 1, Math.floor((z - row * DRAINAGE_REACH) / STEP)));
        const centre = lerp(xs[r], xs[r + 1], (z - row * DRAINAGE_REACH) / STEP - r);
        const x = centre + side * 210 * (1 - t);
        bed = Math.min(bed, elevation(x, z) - 0.6);
        points.push({ x, z, y: lerp(bed, WATER_LEVEL - 2.4, t * t) });
      }
      for (let i = 1; i < points.length; i++) points[i].y = Math.min(points[i].y, points[i - 1].y);
      const built = {
        xs,
        lake,
        tributary: {
          points,
          minX: Math.min(...points.map((p) => p.x)) - 44,
          maxX: Math.max(...points.map((p) => p.x)) + 44,
          minZ: Math.min(...points.map((p) => p.z)) - 44,
          maxZ: Math.max(...points.map((p) => p.z)) + 44
        }
      };
      if (reaches.size >= 256) reaches.delete(reaches.keys().next().value);
      reaches.set(key, built);
      return built;
    };
    const riverAt = (lane, z) => {
      const row = Math.floor(z / DRAINAGE_REACH), local = (z - row * DRAINAGE_REACH) / STEP;
      const xs = reach(lane, row).xs, i = Math.floor(local), t = local - i;
      const x = lerp(xs[i], xs[i + 1], smoothstep(0, 1, t));
      const half = 12 + 6 * (0.5 + 0.5 * Math.sin(z / 280 + lane * 1.7));
      return { x, half };
    };
    const surveyCrossChannel = (lane, row, roll2) => {
      const baseZ = row * DRAINAGE_REACH;
      const midZ = baseZ + 330 + 360 * unit(hashAt(roll2, "position"));
      const direction = unit(hashAt(roll2, "turn")) < 0.5 ? -1 : 1;
      const skew = direction * (110 + 230 * unit(hashAt(roll2, "angle")));
      const bend = 45 + 55 * unit(hashAt(roll2, "bend"));
      let best;
      let bestCost = Infinity;
      for (const offset of [0, -112, 112]) {
        const startZ = midZ + offset - skew / 2;
        const endZ = midZ + offset + skew / 2;
        const startX = riverAt(lane, startZ).x;
        const endX = riverAt(lane + 1, endZ).x;
        for (const curve of [direction, -direction]) {
          const points = [];
          let peak = -Infinity;
          let total = 0;
          for (let i = 0; i <= 24; i++) {
            const t = i / 24;
            const x = lerp(startX, endX, t);
            const z = lerp(startZ, endZ, t) + curve * bend * Math.sin(Math.PI * t) * (1.4 - 0.8 * t);
            const height = elevation(x, z);
            peak = Math.max(peak, height);
            total += Math.max(0, height);
            points.push({ x, z });
          }
          if (peak > 19 || points.some(
            ({ x, z }) => z < baseZ + CROSS_BANK || z > baseZ + DRAINAGE_REACH - CROSS_BANK || Math.hypot(x - STARTER_CENTER, z - STARTER_CENTER) < 1180
          ) || Math.hypot(xpos(lane, HALF) - STARTER_CENTER, startZ - STARTER_CENTER) < 1100 || Math.hypot(xpos(lane + 1, HALF) - STARTER_CENTER, endZ - STARTER_CENTER) < 1100)
            continue;
          const cost = total / points.length + peak * 0.5 + Math.abs(offset) / 100;
          if (cost < bestCost) {
            bestCost = cost;
            best = points;
          }
        }
      }
      if (!best) return null;
      return {
        points: best,
        minX: best[0].x - CROSS_BANK,
        maxX: best[best.length - 1].x + CROSS_BANK,
        minZ: Math.min(...best.map(({ z }) => z)) - CROSS_BANK,
        maxZ: Math.max(...best.map(({ z }) => z)) + CROSS_BANK
      };
    };
    const crossChannel = (lane, row) => {
      const key = `${lane},${row}`;
      const cached2 = crossChannels.get(key);
      if (cached2 !== void 0) return cached2;
      const roll2 = hashAt(seed, "cross-channel", lane, row);
      const channel = unit(roll2) < 0.68 ? surveyCrossChannel(lane, row, roll2) : null;
      if (crossChannels.size >= 256) crossChannels.delete(crossChannels.keys().next().value);
      crossChannels.set(key, channel);
      return channel;
    };
    const crossChannelGround = (h, x, z) => {
      if (!connected) return h;
      const nearest = Math.round((x - RIVER_ORIGIN) / RIVER_LANE);
      const row = Math.floor(z / DRAINAGE_REACH);
      for (const lane of [nearest - 1, nearest]) {
        const channel = crossChannel(lane, row);
        if (!channel || x < channel.minX || x > channel.maxX || z < channel.minZ || z > channel.maxZ) continue;
        let distance = CROSS_BANK;
        for (let i = 0; i + 1 < channel.points.length; i++) {
          const a = channel.points[i];
          const b = channel.points[i + 1];
          if (x < a.x - distance || x > b.x + distance) continue;
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
          distance = Math.min(distance, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
        }
        const bed = WATER_LEVEL - 0.45 + Math.max(0, distance - 6) * 0.19;
        h = lerp(h, Math.min(h, bed), 1 - smoothstep(8, CROSS_BANK, distance));
      }
      return h;
    };
    return {
      riverAt,
      crossChannelGround,
      waterGuidesAt(x, z) {
        const nearest = Math.round((x - RIVER_ORIGIN) / RIVER_LANE);
        const row = Math.floor(z / DRAINAGE_REACH);
        let basin = 0;
        let branch = null;
        const consider = (guide) => {
          if (guide && guide.distance / guide.half < (branch ? branch.distance / branch.half : 1))
            branch = guide;
        };
        for (let lane = nearest - 1; lane <= nearest + 1; lane++) {
          if (Math.abs(x - xpos(lane, HALF)) > 450) continue;
          const { lake, tributary } = reach(lane, row);
          if (lake) {
            const d = Math.hypot((x - lake.x) / lake.rx, (z - lake.z) / lake.rz);
            basin = Math.max(basin, 1 - smoothstep(0.75, 1.18, d));
          }
          consider(projectChannel(tributary, x, z, 12));
        }
        if (connected) {
          for (const lane of [nearest - 1, nearest]) {
            const channel = crossChannel(lane, row);
            if (channel) consider(projectChannel(channel, x, z, 10));
          }
        }
        return { basin, branch };
      },
      riverGround(h, x, z, course = riverAt, valleyStrength = 1) {
        const nearest = Math.round((x - RIVER_ORIGIN) / RIVER_LANE);
        for (let lane = nearest - 1; lane <= nearest + 1; lane++) {
          if (Math.abs(x - xpos(lane, HALF)) > 400) continue;
          const river = course(lane, z);
          const offset = x - river.x;
          const distance = Math.abs(offset);
          const valley = WATER_LEVEL + 1.2 + Math.max(0, distance - river.half) * 0.025;
          h = lerp(
            h,
            Math.min(h, valley),
            valleyStrength * (1 - smoothstep(river.half + 20, river.half + 180, distance))
          );
          if (shapedBed && distance > river.half * 1.4 + 17) continue;
          const half = shapedBed ? riverBankWidth(river.half, lane, z, Math.sign(offset)) : river.half;
          let channel = lerp(WATER_LEVEL - 2.8, WATER_LEVEL, smoothstep(0, half, distance));
          if (shapedBed && distance < half) {
            const pool = riverPool(lane, z);
            const across = offset / half;
            const thalweg = 0.24 * Math.sin(z / 55 + lane * 2.3);
            const sideWidth = across < thalweg ? 1 + thalweg : 1 - thalweg;
            const shelf = smoothstep(0.09, 1, Math.abs(across - thalweg) / sideWidth);
            const bedDepth = lerp(1.25, 3.9, pool) * (1 - shelf);
            const bars = 0.16 * Math.sin(z * 0.21 + across * 7) * Math.sin(across * 10 - z * 0.08);
            channel = WATER_LEVEL - bedDepth * (1 + bars);
          }
          h = lerp(Math.min(h, channel), h, smoothstep(half * 0.8, half + 17, distance));
        }
        return h;
      },
      basinGround(h, x, z) {
        const nearest = Math.round((x - RIVER_ORIGIN) / RIVER_LANE), row = Math.floor(z / DRAINAGE_REACH);
        for (let lane = nearest - 1; lane <= nearest + 1; lane++) {
          if (Math.abs(x - xpos(lane, HALF)) > 450) continue;
          const { lake, tributary } = reach(lane, row);
          if (lake) {
            const d = Math.hypot((x - lake.x) / lake.rx, (z - lake.z) / lake.rz);
            if (d < 1.5) {
              const bed = WATER_LEVEL - 4 * (1 - smoothstep(0.25, 1.05, d));
              h = lerp(Math.min(h, bed), h, smoothstep(0.9, 1.5, d));
            }
          }
          if (x < tributary.minX || x > tributary.maxX || z < tributary.minZ || z > tributary.maxZ) continue;
          for (let i = 0; i + 1 < tributary.points.length; i++) {
            const a = tributary.points[i], b = tributary.points[i + 1];
            const dx = b.x - a.x, dz = b.z - a.z;
            if (x < Math.min(a.x, b.x) - 44 || x > Math.max(a.x, b.x) + 44 || z < Math.min(a.z, b.z) - 44 || z > Math.max(a.z, b.z) + 44)
              continue;
            const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
            const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
            const downstream = (i + t) / (tributary.points.length - 1);
            const width = 3 + 6 * downstream;
            if (d >= width + 35) continue;
            const bed = lerp(a.y, b.y, t) + Math.max(0, d - width) * 0.2;
            h = lerp(
              h,
              Math.min(h, bed),
              (1 - smoothstep(width, width + 35, d)) * smoothstep(0, 0.2, downstream)
            );
          }
        }
        return crossChannelGround(h, x, z);
      }
    };
  }

  // src/world/wilderness/terrain-version.ts
  var TERRAIN_VERSION = 6;

  // src/world/wilderness/settlement-siting.ts
  function createSettlementSiting(seed, ground) {
    const density = createNoise2D(hashAt(seed, "settlement-density"));
    const span = TUNING.structures.cityGrid * TUNING.world.chunkSize;
    const middle = TUNING.world.chunkSize / 2;
    const grid = TUNING.world.cellSize;
    return (gx, gz, size) => {
      const cx = gx * span + middle, cz = gz * span + middle;
      const chance = 0.58 + 0.36 * smoothstep(-0.45, 0.45, density(cx / 2400, cz / 2400));
      if (unit(hashAt(seed, "settlement-presence", gx, gz)) > chance) return null;
      const travel = (span - size) / 2 - TUNING.structures.townSkirt - grid;
      let best = null;
      let bestScore = Infinity;
      for (let i = 0; i < 12; i++) {
        const ox = Math.round((cx - size / 2 + (unit(hashAt(seed, "site-x", gx, gz, i)) * 2 - 1) * travel) / grid) * grid;
        const oz = Math.round((cz - size / 2 + (unit(hashAt(seed, "site-z", gx, gz, i)) * 2 - 1) * travel) / grid) * grid;
        const [sx, sz] = TUNING.structures.firstTownOrigin;
        const starterSize = TUNING.city.firstCityChunks * TUNING.world.chunkSize;
        const starterGap = Math.hypot(
          Math.max(sx - ox - size, ox - sx - starterSize, 0),
          Math.max(sz - oz - size, oz - sz - starterSize, 0)
        );
        if (starterGap < TUNING.structures.townSkirt * 2) continue;
        let low = Infinity, high = -Infinity, sum = 0, wet = 0;
        for (const u of [0.1, 0.5, 0.9])
          for (const v of [0.1, 0.5, 0.9]) {
            const h = ground(ox + size * u, oz + size * v);
            low = Math.min(low, h);
            high = Math.max(high, h);
            sum += h;
            if (h < WATER_LEVEL + 0.75) wet++;
          }
        if (wet > 1 || high - low > 32 || sum / 9 <= WATER_LEVEL + 1) continue;
        let bank = Infinity;
        for (const [u, v] of [
          [-0.15, 0.5],
          [1.15, 0.5],
          [0.5, -0.15],
          [0.5, 1.15]
        ])
          bank = Math.min(bank, Math.abs(ground(ox + size * u, oz + size * v) - WATER_LEVEL));
        const score = (high - low) * 1.4 + sum / 9 * 0.12 + wet * 20 + Math.min(bank, 12) * 0.22;
        if (score < bestScore) {
          bestScore = score;
          best = { ox, oz };
        }
      }
      return best;
    };
  }

  // src/world/wilderness/generator.ts
  function townDistance(e, x, z) {
    const dx = Math.max(e.ox - x, 0, x - e.ox - e.size);
    const dz = Math.max(e.oz - z, 0, z - e.oz - e.size);
    return Math.hypot(dx, dz);
  }
  var W = TUNING.world;
  var S = TUNING.structures;
  var unit2 = (h) => (h & 1023) / 1024;
  function cityCellOf(chunk) {
    const half = Math.floor(S.cityGrid / 2);
    return Math.floor((chunk + half) / S.cityGrid);
  }
  function createWilderness(seed, legacyTowns = [], terrainVersion = TERRAIN_VERSION) {
    const legacy = new Set(legacyTowns);
    const n = (salt) => createNoise2D(hashAt(seed, salt));
    const reliefN = n("relief");
    const moistN = n("moisture");
    const waterN = n("water");
    const baseN = n("base");
    const hillN = n("hills");
    const peakN = n("peaks");
    const bends = n("river-bends");
    const spawn = W.chunkSize / 2;
    const landforms = createLandforms(seed);
    const drainage = createDrainage(seed, (x, z) => landforms(x, z).height, terrainVersion >= 3, terrainVersion >= 6);
    const regional = (x, z) => terrainVersion === 1 ? 0 : smoothstep(700, 1100, Math.hypot(x - spawn, z - spawn));
    const riverMiddle = (lane, z) => {
      const t = (z - spawn) / 155;
      return spawn + RIVER_X + lane * RIVER_LANE + 29 * bends(lane + 0.3, t) + 12 * Math.sin(t * 1.8);
    };
    const riverHalf = (z) => 11 + 15 * smoothstep(0.1, 0.7, bends(4.3, z / 270));
    const riverDistance = (x, z) => Math.abs(x - riverMiddle(Math.round((x - spawn - RIVER_X) / RIVER_LANE), z));
    const legacyClimate = (x, z) => {
      const dist = Math.hypot(x, z);
      return {
        relief: fbm(reliefN, x / 1100, z / 1100, 3),
        moisture: fbm(moistN, x / 800, z / 800, 3),
        water: Math.abs(fbm(waterN, x / 1400, z / 1400, 3)),
        wildness: smoothstep(W.spawnCalmRadius * 0.4, W.spawnCalmRadius * 1.6, dist)
      };
    };
    const climate = (x, z) => {
      const s = legacyClimate(x, z), blend = regional(x, z);
      if (!blend) return s;
      return __spreadProps(__spreadValues({}, s), {
        relief: lerp(s.relief, landforms(x, z).mountain * 0.9, blend),
        // Wet ground is defined by the carved channel, not unrelated noise contours.
        water: lerp(s.water, Math.max(0.12, s.water), blend)
      });
    };
    const biomeAt = (x, z) => {
      if (terrainHeightAt(x, z) <= WATER_LEVEL + 0.2) return BIOME_INDEX.get("water");
      return BIOME_INDEX.get(climateBiome(climate(x, z)));
    };
    const rawHeightAt = (x, z) => {
      const blend = regional(x, z);
      if (blend === 1) return landforms(x, z).height;
      const s = legacyClimate(x, z);
      const wild = s.wildness;
      let h = 2.5 * fbm(baseN, x / 300, z / 300, 3) + 1.5;
      h += 6 * fbm(hillN, x / 140, z / 140, 3) * (0.25 + 0.75 * wild);
      const mountain = smoothstep(0.2, 0.7, s.relief) * smoothstep(0.4, 0.8, wild);
      h += mountain * 26 * (0.65 + 0.35 * fbm(peakN, x / 60, z / 60, 2));
      const river2 = smoothstep(0.09, 0.025, s.water) * smoothstep(0.25, 0.5, wild);
      h = lerp(h, -2, river2);
      return blend ? lerp(h, landforms(x, z).height, blend) : h;
    };
    const siteInCell = createSettlementSiting(
      seed,
      (x, z) => drainage.basinGround(drainage.riverGround(rawHeightAt(x, z), x, z), x, z)
    );
    const cellKey = (gx, gz) => (gx + 32768) * 65536 + (gz + 32768);
    const cache3 = /* @__PURE__ */ new Map();
    const entranceInCell = (gx, gz) => {
      const key = cellKey(gx, gz);
      const known = cache3.get(key);
      if (known !== void 0) return known;
      const half = Math.floor(S.cityGrid / 2);
      const first = gx === 0 && gz === 0;
      let cx;
      let cz;
      if (first) [cx, cz] = S.firstCityChunk;
      else {
        const h2 = hashAt(seed, "city-cell", gx, gz);
        cx = gx * S.cityGrid - half + h2 % S.cityGrid;
        cz = gz * S.cityGrid - half + (h2 >>> 8) % S.cityGrid;
      }
      const h = hashAt(seed, "city", cx, cz);
      const chunks = first ? TUNING.city.firstCityChunks : legacy.has(`c${cx}_${cz}`) ? TUNING.city.chunks : settlementChunks(seed, cx, cz);
      const size = chunks * W.chunkSize;
      let ox;
      let oz;
      if (first) [ox, oz] = S.firstTownOrigin;
      else if (terrainVersion >= 5) {
        const site = siteInCell(gx, gz, size);
        if (!site) {
          cache3.set(key, null);
          return null;
        }
        ({ ox, oz } = site);
      } else {
        const mid = (S.cityGrid * 0.5 - half) * W.chunkSize;
        ox = gx * S.cityGrid * W.chunkSize + mid - size / 2 + S.townJitter * (2 * unit2(h >>> 4) - 1);
        oz = gz * S.cityGrid * W.chunkSize + mid - size / 2 + S.townJitter * (2 * unit2(h >>> 14) - 1);
        ox = Math.round(ox / W.cellSize) * W.cellSize;
        oz = Math.round(oz / W.cellSize) * W.cellSize;
        if (regional(ox + size / 2, oz + size / 2) === 1) {
          const centreX = gx * S.cityGrid * W.chunkSize + mid;
          const centreZ = gz * S.cityGrid * W.chunkSize + mid;
          const limit = (S.cityGrid * W.chunkSize - size) / 2 - S.townSkirt;
          let best = Infinity, bestX = ox, bestZ = oz;
          for (const dx of [-limit, 0, limit])
            for (const dz of [-limit, 0, limit]) {
              const px = Math.round((centreX + dx - size / 2) / W.cellSize) * W.cellSize;
              const pz = Math.round((centreZ + dz - size / 2) / W.cellSize) * W.cellSize;
              let low = Infinity, high = -Infinity, total = 0, wet = 0;
              for (const u of [0.15, 0.5, 0.85])
                for (const v of [0.15, 0.5, 0.85]) {
                  const x = px + u * size, z = pz + v * size;
                  const height = drainage.basinGround(drainage.riverGround(rawHeightAt(x, z), x, z), x, z);
                  low = Math.min(low, height);
                  high = Math.max(high, height);
                  total += height;
                  if (height < WATER_LEVEL + 0.5) wet++;
                }
              const score = high - low + total / 9 * 0.12 + wet * 8 + Math.hypot(px - ox, pz - oz) * 3e-3;
              if (score < best) {
                best = score;
                bestX = px;
                bestZ = pz;
              }
            }
          ox = bestX;
          oz = bestZ;
        }
      }
      const surveyed = regional(ox + size / 2, oz + size / 2) === 1;
      let sum = 0;
      for (let i = 0; i < 5; i++)
        for (let k = 0; k < 5; k++) {
          const x = ox + (i + 0.5) / 5 * size, z = oz + (k + 0.5) / 5 * size;
          const raw = rawHeightAt(x, z);
          sum += surveyed ? drainage.basinGround(drainage.riverGround(raw, x, z), x, z) : raw;
        }
      const y = sum / 25;
      let entrance = null;
      if (first || y > WATER_LEVEL + 1) {
        const x = ox + size / 2;
        const z = oz + size / 2;
        const gate = Math.abs(x) > Math.abs(z) ? x > 0 ? "nx" : "px" : z > 0 ? "nz" : "pz";
        entrance = {
          cityId: `c${cx}_${cz}`,
          x,
          z,
          y: Math.max(y, WATER_LEVEL + 1.25),
          ox,
          oz,
          size,
          seed: h,
          chunks,
          gate: first ? "nx" : gate
        };
      }
      cache3.set(key, entrance);
      return entrance;
    };
    const entrancesNear = (x, z, cells = 1) => {
      const gx = cityCellOf(Math.floor(x / W.chunkSize));
      const gz = cityCellOf(Math.floor(z / W.chunkSize));
      const out = [];
      for (let dx = -cells; dx <= cells; dx++)
        for (let dz = -cells; dz <= cells; dz++) {
          const e = entranceInCell(gx + dx, gz + dz);
          if (e) out.push(e);
        }
      return out;
    };
    const nearCache = /* @__PURE__ */ new Map();
    const townsNear = (x, z) => {
      const key = cellKey(cityCellOf(Math.floor(x / W.chunkSize)), cityCellOf(Math.floor(z / W.chunkSize)));
      let near2 = nearCache.get(key);
      if (!near2) nearCache.set(key, near2 = entrancesNear(x, z, 1));
      return near2;
    };
    const townAt = (x, z, margin = 0) => {
      for (const e of townsNear(x, z))
        if (x > e.ox - margin && z > e.oz - margin && x < e.ox + e.size + margin && z < e.oz + e.size + margin)
          return e;
      return null;
    };
    const skirt = S.townSkirt;
    const river = (h, x, z) => {
      if (terrainVersion >= 2) return drainage.riverGround(h, x, z, riverAt, regional(x, z));
      const bank = riverDistance(x, z);
      const width = riverHalf(z);
      const channel = lerp(WATER_LEVEL - 2.8, WATER_LEVEL, smoothstep(0, width, bank));
      return lerp(Math.min(h, channel), h, smoothstep(width * 0.8, width + 17, bank));
    };
    const legacyLakeDistance = (x, z) => {
      const lane = Math.round((x - spawn - 90) / 720), reach = Math.round((z - spawn + 166) / 960);
      const variation = bends(lane + 0.71, reach + 0.32);
      const lakeX = spawn + 90 + lane * 720 + 13 * variation;
      const lakeZ = spawn - 166 + reach * 960 + 11 * variation;
      return Math.hypot((x - lakeX) / (152 + 14 * variation), (z - lakeZ) / (107 + 10 * variation));
    };
    const ground = (x, z) => {
      let h = rawHeightAt(x, z);
      if (h < WATER_LEVEL - 0.45) {
        const rim = Math.max(
          rawHeightAt(x - 10, z),
          rawHeightAt(x + 10, z),
          rawHeightAt(x, z - 10),
          rawHeightAt(x, z + 10)
        );
        h = lerp(h, WATER_LEVEL - 0.45, smoothstep(WATER_LEVEL - 0.8, WATER_LEVEL + 0.1, rim));
      }
      const start = 1 - smoothstep(16, 43, Math.hypot(x - spawn, z - spawn));
      h = lerp(h, Math.max(h, WATER_LEVEL + 2), start);
      h = river(h, x, z);
      const blend = regional(x, z);
      const beforeBasin = h;
      if (blend < 1) {
        const basin = legacyLakeDistance(x, z);
        if (basin < 1.45) {
          const shore = basin + 0.08 * bends(x / 48, z / 48);
          const bed = WATER_LEVEL - 4.8 * (1 - smoothstep(0.4, 1.12, shore));
          h = lerp(Math.min(h, bed), h, smoothstep(0.92, 1.35, shore));
        }
      }
      if (blend) h = lerp(h, drainage.basinGround(beforeBasin, x, z), blend);
      const puddle = Math.hypot((x - (spawn - 28)) / 8, (z - (spawn + 25)) / 6);
      if (puddle < 1.8) h = lerp(Math.min(h, WATER_LEVEL - 0.38), h, smoothstep(0.5, 1.8, puddle));
      for (const e of townsNear(x, z)) {
        const dx = Math.max(e.ox - x, 0, x - e.ox - e.size);
        const dz = Math.max(e.oz - z, 0, z - e.oz - e.size);
        if (dx >= skirt || dz >= skirt) continue;
        const surveyed = regional(e.x, e.z) === 1;
        const base = surveyed ? drainage.basinGround(river(rawHeightAt(x, z), x, z), x, z) : rawHeightAt(x, z);
        const grade = Math.max(WATER_LEVEL + 0.6, e.y + S.townRelief * (base - e.y));
        const town = surveyed ? drainage.crossChannelGround(drainage.riverGround(grade, x, z, riverAt, 0), x, z) : river(grade, x, z);
        if (dx === 0 && dz === 0) return town;
        h = lerp(h, town, smoothstep(skirt, 0, Math.hypot(dx, dz)));
      }
      return h;
    };
    const tiles = /* @__PURE__ */ new Map();
    const nSide = W.chunkSize / W.cellSize;
    const corner = (ix, iz) => {
      const cx = Math.floor(ix / nSide), cz = Math.floor(iz / nSide);
      const key = `${cx},${cz}`;
      let tile = tiles.get(key);
      if (!tile) {
        if (tiles.size >= 128) tiles.delete(tiles.keys().next().value);
        tiles.set(key, tile = new Float32Array(nSide * nSide).fill(NaN));
      }
      const i = (iz - cz * nSide) * nSide + ix - cx * nSide;
      if (Number.isNaN(tile[i])) tile[i] = ground(ix * W.cellSize, iz * W.cellSize);
      return tile[i];
    };
    const interpolate = (x, z, sample) => {
      const gx = x / W.cellSize, gz = z / W.cellSize;
      const ix = Math.floor(gx), iz = Math.floor(gz);
      const u = gx - ix, v = gz - iz;
      if (u === 0 && v === 0) return sample(ix, iz);
      const east = sample(ix + 1, iz), south = sample(ix, iz + 1);
      if (u + v <= 1) return (1 - u - v) * sample(ix, iz) + u * east + v * south;
      return (u + v - 1) * sample(ix + 1, iz + 1) + (1 - v) * east + (1 - u) * south;
    };
    const terrainHeightAt = (x, z) => interpolate(x, z, corner);
    const roadTiles = /* @__PURE__ */ new Map();
    const roadCorner = (ix, iz) => {
      const cx = Math.floor(ix / nSide), cz = Math.floor(iz / nSide);
      const key = `${cx},${cz}`;
      let tile = roadTiles.get(key);
      if (!tile) {
        if (roadTiles.size >= 128) roadTiles.delete(roadTiles.keys().next().value);
        roadTiles.set(key, tile = new Float32Array(nSide * nSide).fill(NaN));
      }
      const i = (iz - cz * nSide) * nSide + ix - cx * nSide;
      if (Number.isNaN(tile[i])) {
        const x = ix * W.cellSize, z = iz * W.cellSize, h = corner(ix, iz);
        const slope = Math.hypot(corner(ix + 1, iz) - corner(ix - 1, iz), corner(ix, iz + 1) - corner(ix, iz - 1)) / (2 * W.cellSize);
        const earthwork = smoothstep(0.1, 0.22, slope);
        tile[i] = !earthwork || h <= WATER_LEVEL + 0.25 || townAt(x, z, 4) ? h : lerp(h, pathsOf(world).groundAt(x, z, h), earthwork);
      }
      return tile[i];
    };
    const heightAt = (x, z) => interpolate(x, z, roadCorner);
    const sampleRiver = (lane, z) => {
      const old = { x: riverMiddle(lane, z), half: riverHalf(z) };
      const blend = regional(spawn + RIVER_X + lane * RIVER_LANE, z);
      if (!blend) return old;
      const next = drainage.riverAt(lane, z);
      return { x: lerp(old.x, next.x, blend), half: lerp(old.half, next.half, blend) };
    };
    const riverSections = /* @__PURE__ */ new Map();
    const riverAt = (lane, z) => {
      const key = `${lane},${z}`;
      let river2 = riverSections.get(key);
      if (!river2) {
        if (riverSections.size >= 8192) riverSections.delete(riverSections.keys().next().value);
        riverSections.set(key, river2 = sampleRiver(lane, z));
      }
      return __spreadValues({}, river2);
    };
    const world = {
      seed,
      terrainVersion,
      legacyTowns: [...legacyTowns],
      climate,
      biomeAt,
      heightAt,
      terrainHeightAt,
      rawHeightAt,
      entranceInCell,
      entrancesNear,
      townAt,
      riverAt,
      waterGuidesAt(x, z) {
        const blend = regional(x, z);
        const old = blend < 1 ? 1 - smoothstep(0.8, 1.25, legacyLakeDistance(x, z)) : 0;
        if (!blend) return { basin: old, branch: null };
        const { basin, branch } = drainage.waterGuidesAt(x, z);
        return { basin: lerp(old, basin, blend), branch };
      }
    };
    return world;
  }

  // src/content/templates.ts
  var BUILDINGS = [
    {
      key: "cottage",
      name: "\u519C\u820D",
      paintFloors: { min: 1, max: 3 },
      eaves: 3.3,
      walls: [color("cream"), color("yellow"), color("pink"), color("sky")],
      roofs: [color("clayTile"), color("slateTile")],
      doors: [color("brown"), color("teal")],
      weight: 5
    },
    {
      key: "shop",
      name: "\u6751\u4E2D\u5C0F\u94FA",
      paintFloors: { min: 2, max: 4 },
      eaves: 3.6,
      walls: [color("orange"), color("cream"), color("green")],
      roofs: [color("slateTile"), color("clayTile")],
      doors: [color("blue"), color("red")],
      weight: 3
    },
    {
      key: "barn",
      name: "\u8C37\u4ED3",
      paintFloors: { min: 4, max: 6 },
      eaves: 4.1,
      walls: [color("cream"), color("sky"), color("purple")],
      roofs: [color("clayTile"), color("slateTile")],
      doors: [color("brown"), color("charcoal")],
      weight: 2
    }
  ];
  var RUINS = [
    { key: "stone-circle", name: "\u77F3\u5708", shape: "circle", stone: color("rock") },
    { key: "broken-bridge", name: "\u65E7\u6865\u4EBA\u5BB6", shape: "bridge", stone: color("stone") },
    { key: "stele-grove", name: "\u7891\u6797", shape: "steles", stone: color("charcoal") },
    // which ruin a cell holds is picked by hash modulo this list's length: appending moves
    // existing ruins to other templates (looks only; ids, places and crayons stay)
    { key: "hill-shrine", name: "\u5C71\u795E\u5C0F\u7960", shape: "shrine", stone: color("stone") },
    { key: "old-waystation", name: "\u53E4\u4E95\u9A7F\u7AD9", shape: "waystation", stone: color("rock") }
  ];

  // src/world/wilderness/ruins.ts
  var S2 = TUNING.structures;
  var ATTEMPTS = 12;
  function ruinCellOf(chunk) {
    return Math.floor(chunk / S2.ruinGrid);
  }
  function ruinInCell(w, gx, gz) {
    const h0 = hashAt(w.seed, "ruin", gx, gz);
    if (unit(h0) >= S2.ruinChance) return null;
    const size = TUNING.world.chunkSize;
    const span = S2.ruinGrid * size;
    for (let a = 0; a < ATTEMPTS; a++) {
      const h = hashAt(w.seed, "ruin-spot", gx, gz, a);
      const x = gx * span + 24 + unit(h) * (span - 48);
      const z = gz * span + 24 + unit(h >>> 9) * (span - 48);
      const y = w.terrainHeightAt(x, z);
      if (y <= WATER_LEVEL + 0.75) continue;
      if (Math.hypot(x, z) < 80) continue;
      if (w.townAt(x, z, S2.townClearance + 20)) continue;
      return {
        id: `r${gx}_${gz}`,
        template: h0 % RUINS.length,
        x,
        y,
        z,
        color: PAINTABLE[(h0 >>> 8) % PAINTABLE.length],
        seed: h
      };
    }
    return null;
  }
  function ruinsInChunk(w, cx, cz) {
    const r = ruinInCell(w, ruinCellOf(cx), ruinCellOf(cz));
    const size = TUNING.world.chunkSize;
    return r && Math.floor(r.x / size) === cx && Math.floor(r.z / size) === cz ? [r] : [];
  }
  function ruinById(w, id) {
    const m = /^r(-?\d+)_(-?\d+)$/.exec(id);
    if (!m) return null;
    const r = ruinInCell(w, Number(m[1]), Number(m[2]));
    return (r == null ? void 0 : r.id) === id ? r : null;
  }

  // src/world/wilderness/spawn-circle.ts
  var SPAWN_CENTER = TUNING.world.chunkSize / 2;
  var SPAWN_STONE_RADIUS = 4.4;
  function spawnStoneDistance(x, z) {
    return Math.hypot(x - SPAWN_CENTER, z - SPAWN_CENTER) - SPAWN_STONE_RADIUS;
  }

  // src/world/wilderness/settlement-links.ts
  function createSettlementLinks(w) {
    const cache3 = /* @__PURE__ */ new Map();
    const reach = TUNING.structures.cityGrid * TUNING.world.chunkSize * 1.8;
    const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    return (a) => {
      const known = cache3.get(a.cityId);
      if (known) return known;
      const nearby = w.entrancesNear(a.x, a.z, 2).filter((b) => b.cityId !== a.cityId && distance(a, b) <= reach);
      const links = nearby.filter((b) => {
        const ab = distance(a, b);
        return !nearby.some((c) => c !== b && distance(a, c) < ab && distance(b, c) < ab);
      }).map((b) => {
        const [from, to] = a.cityId < b.cityId ? [a, b] : [b, a];
        return { id: `t:${from.cityId}:${to.cityId}`, a: from, b: to };
      }).sort((a2, b) => a2.id.localeCompare(b.id));
      cache3.set(a.cityId, links);
      return links;
    };
  }

  // src/world/math/steps.ts
  function finishSteps(steps) {
    let next = steps.next();
    while (!next.done) next = steps.next();
    return next.value;
  }
  var StepCache = class {
    constructor() {
      __publicField(this, "values", /* @__PURE__ */ new Map());
      __publicField(this, "pending", /* @__PURE__ */ new Map());
    }
    *prepare(key, make) {
      if (this.values.has(key)) return this.values.get(key);
      let work = this.pending.get(key);
      if (!work) this.pending.set(key, work = { steps: make(), users: 0 });
      work.users++;
      try {
        while (!this.values.has(key)) {
          const next = work.steps.next();
          if (next.done) {
            this.values.set(key, next.value);
            this.pending.delete(key);
            return next.value;
          }
          yield;
        }
        return this.values.get(key);
      } finally {
        if (--work.users === 0 && this.pending.get(key) === work) {
          this.pending.delete(key);
          work.steps.return(void 0);
        }
      }
    }
  };

  // src/world/wilderness/paths.ts
  var ROAD = 2.6;
  var TRACK = 1.8;
  var TOWN_ROOM = 22;
  var GATE_RUN = 16;
  var GRID = 16;
  var CORRIDOR = 260;
  var CROSSING_ROWS = 2;
  var DEEP = 0.45;
  var MAX_BRIDGE = 70;
  var APPROACH_POINTS = 28;
  var BUCKET = 64;
  var BENCH = TUNING.world.cellSize;
  var SHOULDER = 9;
  var MAX_EARTHWORK = 3.5;
  var S3 = TUNING.structures;
  var SIZE = TUNING.world.chunkSize;
  var CITY_SPAN = S3.cityGrid * SIZE;
  var RUIN_SPAN = S3.ruinGrid * SIZE;
  var networks = /* @__PURE__ */ new WeakMap();
  function pathsOf(w) {
    let net = networks.get(w);
    if (!net) networks.set(w, net = createNetwork(__spreadProps(__spreadValues({}, w), { heightAt: w.terrainHeightAt })));
    return net;
  }
  var cityCell = (v) => Math.floor((v / SIZE + Math.floor(S3.cityGrid / 2)) / S3.cityGrid);
  function createNetwork(w) {
    const linksOf = createSettlementLinks(w);
    const trails = new StepCache();
    const gates = /* @__PURE__ */ new Map();
    const buckets = /* @__PURE__ */ new Map();
    const bridgesBy = /* @__PURE__ */ new Map();
    const bedsBy = /* @__PURE__ */ new Map();
    const wobble = createNoise2D(hashAt(w.seed, "trail-wobble"));
    const gatesOf = (e) => {
      let g = gates.get(e.cityId);
      if (!g) gates.set(e.cityId, g = townGates(e, w));
      return g;
    };
    const gateToward = (e, x, z) => {
      let best = gatesOf(e)[0];
      let score = -Infinity;
      for (const g of gatesOf(e)) {
        const dx = x - g.x;
        const dz = z - g.z;
        const s = (g.outX * dx + g.outZ * dz) / (Math.hypot(dx, dz) || 1);
        if (s > score) {
          score = s;
          best = g;
        }
      }
      return best;
    };
    const deep = (x, z) => w.heightAt(x, z) < WATER_LEVEL - DEEP;
    const wet = (x, z) => w.heightAt(x, z) < WATER_LEVEL + 0.15;
    const route = function* (a, b, gateA, gateB) {
      const x0 = Math.floor((Math.min(a.x, b.x) - CORRIDOR) / GRID) * GRID;
      const z0 = Math.floor((Math.min(a.z, b.z) - CORRIDOR) / GRID) * GRID;
      const nx = Math.ceil((Math.max(a.x, b.x) + CORRIDOR - x0) / GRID) + 1;
      const nz = Math.ceil((Math.max(a.z, b.z) + CORRIDOR - z0) / GRID) + 1;
      const n = nx * nz;
      const px = (i) => x0 + i % nx * GRID;
      const pz = (i) => z0 + Math.floor(i / nx) * GRID;
      const heights = new Float32Array(n).fill(Number.NaN);
      const relief = new Float32Array(n).fill(Number.NaN);
      const state = new Uint8Array(n);
      const height = (i) => {
        if (Number.isNaN(heights[i])) heights[i] = w.heightAt(px(i), pz(i));
        return heights[i];
      };
      const steepness = (i) => {
        if (Number.isNaN(relief[i])) {
          const ix = i % nx, iz = Math.floor(i / nx);
          const left = ix ? i - 1 : i, right = ix + 1 < nx ? i + 1 : i;
          const north = iz ? i - nx : i, south = iz + 1 < nz ? i + nx : i;
          relief[i] = Math.hypot(
            (height(right) - height(left)) / ((right - left) * GRID),
            (height(south) - height(north)) / ((south - north) / nx * GRID)
          );
        }
        return relief[i];
      };
      const open2 = (i) => {
        if (!state[i]) {
          const x = px(i);
          const z = pz(i);
          const nearEnd = gateA && Math.hypot(x - a.x, z - a.z) < 30 || gateB && Math.hypot(x - b.x, z - b.z) < 30;
          const town = !nearEnd && w.entrancesNear(x, z, 1).some((e) => townDistance(e, x, z) < TOWN_ROOM);
          state[i] = town ? 2 : 1;
        }
        return state[i] === 1;
      };
      const at = (x, z) => Math.min(nz - 1, Math.max(0, Math.round((z - z0) / GRID))) * nx + Math.min(nx - 1, Math.max(0, Math.round((x - x0) / GRID)));
      const start = at(a.x, a.z);
      const goal = at(b.x, b.z);
      const cost = new Float32Array(n).fill(Infinity);
      const from = new Int32Array(n).fill(-1);
      const heap = new Heap();
      cost[start] = 0;
      heap.push(start, 0);
      const ford = WATER_LEVEL;
      const channel = WATER_LEVEL - DEEP;
      let pops = 0;
      while (heap.size && pops++ < n * 2) {
        if (pops % 32 === 0) yield;
        const i = heap.pop();
        if (i === goal) break;
        const ix = i % nx;
        const iz = Math.floor(i / nx);
        const hi = height(i);
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            const jx = ix + dx;
            const jz = iz + dz;
            if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
            const j = jz * nx + jx;
            if (!open2(j)) continue;
            const hj = height(j);
            const between = hi < channel || hj < channel ? 0 : w.heightAt((px(i) + px(j)) / 2, (pz(i) + pz(j)) / 2);
            const inDeep = hi < channel || hj < channel || between < channel;
            const inWater = hi < ford || hj < ford;
            if (inDeep && (dz || Math.round(pz(i) / GRID) % CROSSING_ROWS !== 0)) continue;
            const run = GRID * (dx && dz ? Math.SQRT2 : 1);
            const slope = Math.abs(hj - hi) / run;
            const ease = 1 + 0.4 * (fbm(wobble, px(j) / 220, pz(j) / 220, 2) + 1);
            const bank = inWater || inDeep ? 0 : Math.max(0, Math.max(steepness(i), steepness(j)) - 0.18);
            const c = cost[i] + run * ease * (1 + 45 * slope * slope + 24 * bank * bank) * (inDeep ? 40 : inWater ? 3 : 1);
            if (c >= cost[j]) continue;
            cost[j] = c;
            from[j] = i;
            heap.push(j, c + Math.hypot(px(j) - b.x, pz(j) - b.z));
          }
      }
      if (from[goal] === -1 && goal !== start) return null;
      const out = [];
      for (let i = goal; i !== -1 && i !== start; i = from[i]) out.push({ x: px(i), z: pz(i) });
      out.reverse();
      out.pop();
      const clear2 = (p, e) => Math.hypot(p.x - e.x, p.z - e.z) > GRID * 1.25;
      return [a, ...out.filter((p) => clear2(p, a) && clear2(p, b)), b];
    };
    const smooth2 = (pts) => {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
        out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
      }
      out.push(pts[pts.length - 1]);
      return out;
    };
    const build = function* (id, width, from, to) {
      const lead = (p) => p.outX === void 0 ? [{ x: p.x, z: p.z }] : [
        { x: p.x + p.outX * 3, z: p.z + p.outZ * 3 },
        { x: p.x + p.outX * GATE_RUN, z: p.z + p.outZ * GATE_RUN }
      ];
      const head = lead(from);
      const tail = lead(to).reverse();
      const a = head[head.length - 1];
      const b = tail[0];
      const way = yield* __yieldStar(route(a, b, from.outX !== void 0, to.outX !== void 0));
      if (!way) return null;
      const curve = smooth2(smooth2([...head.slice(0, -1), ...way, ...tail.slice(1)]));
      const pts = [];
      const segment = (out, p, q) => {
        const length = Math.hypot(q.x - p.x, q.z - p.z);
        if (length < 1e-6) return;
        const n = Math.ceil(length / 2.5);
        for (let j = 0; j < n; j++)
          out.push({ x: p.x + (q.x - p.x) * j / n, z: p.z + (q.z - p.z) * j / n });
      };
      for (let i = 0; i < curve.length - 1; i++) segment(pts, curve[i], curve[i + 1]);
      pts.push(curve[curve.length - 1]);
      const bridges = [];
      const joined = [];
      let next = 0;
      const dryLink = (a2, b2) => {
        const n = Math.max(1, Math.ceil(Math.hypot(b2.x - a2.x, b2.z - a2.z) / 0.5));
        for (let k = 0; k <= n; k++)
          if (w.heightAt(a2.x + (b2.x - a2.x) * k / n, a2.z + (b2.z - a2.z) * k / n) < WATER_LEVEL + 0.05)
            return false;
        return true;
      };
      for (let i = 0; i < pts.length; i++) {
        if (i % 16 === 0) yield;
        if (!deep(pts[i].x, pts[i].z)) continue;
        let j = i;
        while (j + 1 < pts.length && wet(pts[j + 1].x, pts[j + 1].z)) j++;
        while (i > next && wet(pts[i - 1].x, pts[i - 1].z)) i--;
        const run = pts.slice(i, j + 1);
        const deepest = run.reduce((m, p) => w.heightAt(p.x, p.z) < w.heightAt(m.x, m.z) ? p : m);
        const row = Math.round(deepest.z / (GRID * CROSSING_ROWS)) * GRID * CROSSING_ROWS;
        const z = Math.abs(row - deepest.z) < GRID / 2 ? row : deepest.z;
        const center = Math.round(deepest.x * 2) / 2;
        let lo = center;
        let hi = center;
        while (wet(lo, z) && deepest.x - lo < MAX_BRIDGE) lo -= 0.5;
        while (wet(hi, z) && hi - deepest.x < MAX_BRIDGE) hi += 0.5;
        lo -= 2;
        hi += 2;
        if (hi - lo > MAX_BRIDGE) return null;
        const y = Math.max(w.heightAt(lo, z), w.heightAt(hi, z), WATER_LEVEL + 0.6) + 0.15;
        for (let k = 0; k < 30 && w.heightAt(lo, z) < y - 0.12; k++) lo -= 0.5;
        for (let k = 0; k < 30 && w.heightAt(hi, z) < y - 0.12; k++) hi += 0.5;
        if (hi - lo > MAX_BRIDGE + 6) return null;
        const east = pts[j].x > pts[i].x;
        const entry = { x: east ? lo : hi, z };
        const exit = { x: east ? hi : lo, z };
        const sign = east ? 1 : -1;
        const approach = (end, from2, dir, side) => {
          const bank = { x: end.x + side * 1.5, z };
          if (!dryLink(end, bank)) return null;
          for (let k = from2; k >= next && k < pts.length && Math.abs(k - from2) < APPROACH_POINTS; k += dir) {
            const p = pts[k];
            if ((p.x - bank.x) * side >= 0 && dryLink(p, bank)) return { k, points: [bank] };
            if (Math.abs(p.z - z) > width + 1.5) {
              const corner = { x: bank.x, z: z + Math.sign(p.z - z) * (width + 1.5) };
              if (dryLink(bank, corner) && dryLink(corner, p)) return { k, points: [bank, corner] };
            }
            if (dir === 1 && deep(p.x, p.z)) break;
          }
          return null;
        };
        const before = approach(entry, i - 1, -1, -sign);
        const after = approach(exit, j + 1, 1, sign);
        if (!before || !after) return null;
        if ([lo, hi].some((x) => Math.abs(w.heightAt(x, z) - y) > TUNING.player.stepHeight - 0.1)) return null;
        joined.push(...pts.slice(next, before.k));
        const crossing = [
          pts[before.k],
          ...before.points.reverse(),
          entry,
          exit,
          ...after.points,
          pts[after.k]
        ];
        for (let k = 0; k + 1 < crossing.length; k++) segment(joined, crossing[k], crossing[k + 1]);
        bridges.push({ x0: lo, x1: hi, z, y, half: width / 2 + 0.4 });
        next = after.k;
        i = next - 1;
      }
      joined.push(...pts.slice(next));
      const dense = joined.flatMap((p) => [p.x, p.z]);
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < dense.length; i += 2) {
        minX = Math.min(minX, dense[i]);
        maxX = Math.max(maxX, dense[i]);
        minZ = Math.min(minZ, dense[i + 1]);
        maxZ = Math.max(maxZ, dense[i + 1]);
      }
      return { id, width, pts: dense, bridges, minX, maxX, minZ, maxZ };
    };
    const trail = (id, make) => trails.prepare(id, make);
    const road = (gx, gz, dx, dz) => trail(`t${gx}_${gz}${dx ? "e" : "s"}`, function* () {
      const a = w.entranceInCell(gx, gz);
      const b = w.entranceInCell(gx + dx, gz + dz);
      if (!a || !b) return null;
      return yield* __yieldStar(build(
        `t${gx}_${gz}${dx ? "e" : "s"}`,
        ROAD,
        gateToward(a, b.x, b.z),
        gateToward(b, a.x, a.z)
      ));
    });
    const ruinTrack = (rx, rz) => trail(`r${rx}_${rz}`, function* () {
      const r = ruinInCell(w, rx, rz);
      if (!r) return null;
      const towns = w.entrancesNear(r.x, r.z, 1);
      if (!towns.length) return null;
      const town = towns.reduce(
        (m, e) => Math.hypot(e.x - r.x, e.z - r.z) < Math.hypot(m.x - r.x, m.z - r.z) ? e : m
      );
      const g = gateToward(town, r.x, r.z);
      const d = Math.hypot(g.x - r.x, g.z - r.z) || 1;
      return yield* __yieldStar(build(`r${rx}_${rz}`, TRACK, g, {
        x: r.x + (g.x - r.x) / d * 9,
        z: r.z + (g.z - r.z) / d * 9
      }));
    });
    const firstPath = () => trail("spawn", function* () {
      const [cx, cz] = S3.firstCityChunk;
      const town = w.entrancesNear((cx + 0.5) * SIZE, (cz + 0.5) * SIZE, 0)[0];
      if (!town) return null;
      const road2 = yield* __yieldStar(build("spawn", ROAD, { x: SPAWN_CENTER + 6, z: SPAWN_CENTER }, gateToward(town, SPAWN_CENTER, SPAWN_CENTER)));
      if (!road2) return null;
      const join2 = SPAWN_CENTER + SPAWN_STONE_RADIUS - 0.8;
      return __spreadProps(__spreadValues({}, road2), { pts: [join2, SPAWN_CENTER, ...road2.pts], minX: Math.min(join2, road2.minX) });
    });
    function* prepare(x0, z0, x1, z1) {
      const out = [];
      const add = (t) => {
        if (t && t.maxX >= x0 && t.minX <= x1 && t.maxZ >= z0 && t.minZ <= z1) out.push(t);
      };
      if (w.terrainVersion >= 5) {
        const seen = /* @__PURE__ */ new Set();
        for (let gx = cityCell(x0) - 3; gx <= cityCell(x1) + 3; gx++)
          for (let gz = cityCell(z0) - 3; gz <= cityCell(z1) + 3; gz++) {
            const town = w.entranceInCell(gx, gz);
            if (town)
              for (const { id, a, b } of linksOf(town)) {
                if (seen.has(id)) continue;
                seen.add(id);
                const pad = Math.max(a.size, b.size) / 2 + CORRIDOR + GRID + GATE_RUN + TOWN_ROOM;
                if (Math.max(a.x, b.x) + pad < x0 || Math.min(a.x, b.x) - pad > x1 || Math.max(a.z, b.z) + pad < z0 || Math.min(a.z, b.z) - pad > z1)
                  continue;
                add(yield* __yieldStar(trail(id, () => build(id, ROAD, gateToward(a, b.x, b.z), gateToward(b, a.x, a.z)))));
                yield;
              }
            yield;
          }
      } else
        for (let gx = cityCell(x0) - 1; gx <= cityCell(x1) + 1; gx++)
          for (let gz = cityCell(z0) - 1; gz <= cityCell(z1) + 1; gz++) {
            add(yield* __yieldStar(road(gx, gz, 1, 0)));
            yield;
            add(yield* __yieldStar(road(gx, gz, 0, 1)));
            yield;
          }
      for (let rx = Math.floor((x0 - CITY_SPAN) / RUIN_SPAN); rx <= Math.floor((x1 + CITY_SPAN) / RUIN_SPAN); rx++)
        for (let rz = Math.floor((z0 - CITY_SPAN) / RUIN_SPAN); rz <= Math.floor((z1 + CITY_SPAN) / RUIN_SPAN); rz++) {
          add(yield* __yieldStar(ruinTrack(rx, rz)));
          yield;
        }
      if (x0 < CITY_SPAN && z0 < CITY_SPAN && x1 > -CITY_SPAN && z1 > -CITY_SPAN) add(yield* __yieldStar(firstPath()));
      return out;
    }
    const trailsNear = (x0, z0, x1, z1) => {
      const steps = prepare(x0, z0, x1, z1);
      let next = steps.next();
      while (!next.done) next = steps.next();
      return next.value;
    };
    const bucket = (bx, bz) => {
      const key = (bx + 32768) * 65536 + (bz + 32768);
      let segs = buckets.get(key);
      if (segs) return segs;
      if (buckets.size > 4096) {
        buckets.clear();
        bridgesBy.clear();
        bedsBy.clear();
      }
      segs = [];
      const bridges = [];
      const beds = [];
      const x0 = bx * BUCKET;
      const z0 = bz * BUCKET;
      const pad = Math.max(ROAD + BENCH + SHOULDER, 24);
      for (const t of trailsNear(x0 - pad, z0 - pad, x0 + BUCKET + pad, z0 + BUCKET + pad)) {
        const p = t.pts;
        for (let i = 0; i + 3 < p.length; i += 2) {
          const ax = p[i];
          const az = p[i + 1];
          const qx = p[i + 2];
          const qz = p[i + 3];
          if (Math.max(ax, qx) < x0 - pad || Math.min(ax, qx) > x0 + BUCKET + pad) continue;
          if (Math.max(az, qz) < z0 - pad || Math.min(az, qz) > z0 + BUCKET + pad) continue;
          segs.push(ax, az, qx, qz, t.width / 2);
          const ha = w.heightAt(ax, az), hb = w.heightAt(qx, qz);
          if (Math.min(ha, hb) > WATER_LEVEL + 0.5 && !t.bridges.some(
            (b) => Math.max(ax, qx) >= b.x0 - 8 && Math.min(ax, qx) <= b.x1 + 8 && Math.min(Math.abs(az - b.z), Math.abs(qz - b.z)) < b.half + 8
          )) {
            const fade = (x, z) => smoothstep(
              0,
              18,
              Math.min(
                Math.hypot(x - p[0], z - p[1]),
                Math.hypot(x - p[p.length - 2], z - p[p.length - 1])
              )
            );
            beds.push(ax, az, qx, qz, t.width / 2 + BENCH, ha, hb, fade(ax, az), fade(qx, qz));
          }
        }
        bridges.push(...t.bridges);
      }
      buckets.set(key, segs);
      bridgesBy.set(key, bridges);
      bedsBy.set(key, beds);
      return segs;
    };
    return {
      prepare,
      *prepareGround(x0, z0, x1, z1) {
        for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++)
          for (let bz = Math.floor(z0 / BUCKET); bz <= Math.floor(z1 / BUCKET); bz++) {
            if (buckets.has((bx + 32768) * 65536 + bz + 32768)) continue;
            const x = bx * BUCKET, z = bz * BUCKET;
            yield* __yieldStar(prepare(x - 24, z - 24, x + BUCKET + 24, z + BUCKET + 24));
            bucket(bx, bz);
            yield;
          }
      },
      trailsNear,
      groundAt(x, z, natural) {
        var _a2;
        const bx = Math.floor(x / BUCKET), bz = Math.floor(z / BUCKET);
        bucket(bx, bz);
        const beds = bedsBy.get((bx + 32768) * 65536 + bz + 32768);
        let landing = 1;
        for (const b of (_a2 = bridgesBy.get((bx + 32768) * 65536 + bz + 32768)) != null ? _a2 : []) {
          const d = Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(Math.abs(z - b.z) - b.half, 0));
          landing = Math.min(landing, smoothstep(6, 18, d));
        }
        if (!landing) return natural;
        let total = 0, sum = 0, strength = 0;
        for (let i = 0; i < beds.length; i += 9) {
          const ax = beds[i], az = beds[i + 1], dx = beds[i + 2] - ax, dz = beds[i + 3] - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
          const half = beds[i + 4];
          const fade = beds[i + 7] * (1 - t) + beds[i + 8] * t;
          const influence = (1 - smoothstep(half, half + SHOULDER, d)) * fade;
          if (influence <= 0) continue;
          const h = beds[i + 5] * (1 - t) + beds[i + 6] * t;
          const weight = influence / (0.05 + d * d);
          sum += Math.max(-MAX_EARTHWORK, Math.min(MAX_EARTHWORK, h - natural)) * weight;
          total += weight;
          strength = Math.max(strength, influence);
        }
        return total ? natural + sum / total * strength * landing : natural;
      },
      edgeDistance(x, z) {
        const s = bucket(Math.floor(x / BUCKET), Math.floor(z / BUCKET));
        let best = spawnStoneDistance(x, z);
        for (let i = 0; i < s.length; i += 5) {
          const ax = s[i];
          const az = s[i + 1];
          const dx = s[i + 2] - ax;
          const dz = s[i + 3] - az;
          const l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t) - s[i + 4];
          if (d < best) best = d;
        }
        return best;
      },
      bridgeAt(x, z) {
        var _a2;
        const bx = Math.floor(x / BUCKET);
        const bz = Math.floor(z / BUCKET);
        bucket(bx, bz);
        const key = (bx + 32768) * 65536 + (bz + 32768);
        for (const b of (_a2 = bridgesBy.get(key)) != null ? _a2 : [])
          if (x >= b.x0 && x <= b.x1 && Math.abs(z - b.z) <= b.half) return b;
        return null;
      }
    };
  }

  // src/world/wilderness/traveller-options.ts
  var MEMORY_LIMIT = 12;
  function validPlace(p) {
    return typeof p === "string" && /^(?:c-?\d{1,9}_-?\d{1,9}|bridge:\d{1,5}|spawn|ruin|roadside)$/.test(p);
  }
  function validSightings(value) {
    return Array.isArray(value) && value.length <= MEMORY_LIMIT && value.every(
      (s) => s && validPlace(s.place) && Number.isFinite(s.at) && s.at >= 0 && (s.place.startsWith("c") ? ["peaceful", "infected", "restored"].includes(s.kind) : s.place.startsWith("bridge:") ? s.kind === "bridge" : s.place === s.kind && s.kind !== "roadside")
    );
  }

  // src/world/wilderness/travellers.ts
  function journeyOn(seed, trail) {
    var _a2;
    const key = hashInts(seed, hashString(trail.id));
    if (trail.id.startsWith("r") && unit(key) >= 0.25) return null;
    const p = trail.pts;
    const lengths = new Float64Array(p.length / 2);
    for (let i = 1; i < lengths.length; i++) {
      const k = 2 * i;
      lengths[i] = lengths[i - 1] + Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
    }
    const distance = (_a2 = lengths.at(-1)) != null ? _a2 : 0;
    if (distance < 1) return null;
    const speed = 1.45 + unit(hashInts(key, 1)) * 0.4;
    const rest = 12 + unit(hashInts(key, 2)) * 12;
    const phase = unit(hashInts(key, 3));
    const offset = trail.id === "spawn" ? Math.min(distance / 2, 24 + phase * 22) / speed : phase * 2 * (distance / speed + rest);
    return { trail, lengths, speed, rest, offset };
  }
  function validTravelLeg(value) {
    if (!value || typeof value !== "object") return false;
    const p = value;
    return [p.at, p.from, p.to, p.origin].every((n) => Number.isFinite(n) && n >= 0) && p.from !== p.to && (p.memory === void 0 || validSightings(p.memory));
  }
  function journeyTiming(j, clock, plan) {
    var _a2, _b, _c, _d;
    const length = j.lengths.at(-1);
    const active = plan && clock >= plan.at && Math.max(plan.from, plan.to) <= length ? plan : void 0;
    const first = (_a2 = active == null ? void 0 : active.from) != null ? _a2 : 0, last = (_b = active == null ? void 0 : active.to) != null ? _b : length;
    const span = Math.abs(last - first);
    return {
      first,
      last,
      span,
      begin: (_c = active == null ? void 0 : active.at) != null ? _c : -j.offset,
      leg: span / j.speed + j.rest,
      origin: (_d = active == null ? void 0 : active.origin) != null ? _d : first
    };
  }
  function travellerPose(j, clock, plan) {
    const length = j.lengths.at(-1);
    const { first, last, span, begin, leg, origin } = journeyTiming(j, clock, plan);
    const time = (clock - begin) % (2 * leg);
    const back = time >= leg;
    const elapsed = back ? time - leg : time;
    const from = back ? last : first, to = back ? first : last;
    const direction = Math.sign(to - from);
    const travelled = Math.min(span, elapsed * j.speed);
    const distance = travelled === span ? to : from + direction * travelled;
    let lo = 0, hi = j.lengths.length - 1;
    while (hi - lo > 1) {
      const mid = lo + hi >>> 1;
      if (j.lengths[mid] < distance || j.lengths[mid] === 0) lo = mid;
      else hi = mid;
    }
    const k = lo * 2, p = j.trail.pts;
    const dx = p[k + 2] - p[k], dz = p[k + 3] - p[k + 1];
    const f = (distance - j.lengths[lo]) / (j.lengths[hi] - j.lengths[lo]);
    return {
      x: p[k] + dx * f,
      z: p[k + 1] + dz * f,
      from,
      to,
      distance,
      origin: from === 0 || from === length ? from : origin,
      angle: Math.atan2(direction * dx, direction * dz),
      motion: travelled < span ? "walk" : "idle"
    };
  }

  // src/content/brush-tiers.ts
  var BRUSH_TIERS = [
    { name: "\u57FA\u7840\u7B14\u5237", range: 6, secondsPerSurface: 1, cost: null },
    { name: "\u957F\u67C4\u7B14\u5237", range: 10, secondsPerSurface: 0.7, cost: { generic: 40, ink: 30 } },
    { name: "\u5BBD\u5934\u7B14\u5237", range: 12, secondsPerSurface: 0.45, cost: { generic: 120, ink: 80 } }
  ];

  // src/content/weapons.ts
  var WEAPONS = [
    {
      key: "rifle",
      name: "\u6B65\u67AA",
      kind: "gun",
      damage: 20,
      interval: 0.11,
      magazine: 24,
      reload: 1.3,
      range: 120,
      spread: 0.012,
      area: 0,
      skill: { name: "\u6218\u672F\u95EA\u907F", cooldown: 7, help: "\u5411\u79FB\u52A8\u65B9\u5411\u95EA\u907F\uFF0C\u5F97\u5230 4 \u79D2\u62A4\u76FE" },
      unlock: { kind: "start" },
      pvp: { damage: 9, head: 1.5 },
      look: [color("charcoal"), color("brown")],
      shot: {
        muzzle: [0, 3e-3, -0.63],
        flash: 1,
        recoil: 1,
        tracer: { speed: 320, length: 3.5, width: 0.02, color: color("yellow") }
      }
    },
    {
      key: "katana",
      name: "\u6B66\u58EB\u5200",
      kind: "melee",
      damage: 38,
      interval: 0.42,
      magazine: 0,
      reload: 0,
      range: 2.8,
      spread: 0,
      area: 0.9,
      skill: { name: "\u7A81\u8FDB\u65A9", cooldown: 6, help: "\u5411\u524D\u51B2 9 \u7C73\uFF0C\u65A9\u8FC7\u8DEF\u4E0A\u7684\u58A8\u602A" },
      unlock: { kind: "milestone", id: "first-block", text: "\u7B2C\u4E00\u6B21\u8BA9\u8857\u533A\u6709\u8272" },
      pvp: { damage: 28, head: 1 },
      look: [color("cream"), color("red")]
    },
    {
      key: "sniper",
      name: "\u72D9\u51FB\u67AA",
      kind: "gun",
      damage: 90,
      interval: 1.1,
      magazine: 5,
      reload: 2,
      range: 220,
      spread: 1e-3,
      area: 0,
      skill: { name: "\u4E13\u6CE8\u5C04\u51FB", cooldown: 10, help: "4 \u79D2\u5185\u4F24\u5BB3 \xD71.5\uFF0C\u89C6\u91CE\u62C9\u8FD1" },
      unlock: { kind: "level", level: 3, text: "\u5347\u5230 3 \u7EA7" },
      pvp: { damage: 55, head: 2 },
      look: [color("teal"), color("charcoal")],
      shot: {
        muzzle: [0, 4e-3, -0.96],
        flash: 1.7,
        recoil: 2.6,
        tracer: { speed: 520, length: 9, width: 0.03, color: color("cream") }
      }
    },
    {
      key: "launcher",
      name: "\u69B4\u5F39\u70AE",
      kind: "launcher",
      damage: 55,
      interval: 1,
      magazine: 4,
      reload: 2.2,
      range: 60,
      spread: 0,
      area: 4.5,
      skill: { name: "\u84C4\u529B\u70AE\u51FB", cooldown: 10, help: "\u4E00\u53D1\u5927\u70AE\u5F39\uFF0C\u8303\u56F4\u548C\u4F24\u5BB3\u7FFB\u500D" },
      unlock: { kind: "milestone", id: "first-tide", text: "\u7B2C\u4E00\u6B21\u5B88\u4F4F\u58A8\u6F6E" },
      pvp: { damage: 40, head: 1 },
      look: [color("orange"), color("charcoal")],
      shot: { muzzle: [0, -0.01, -0.62], flash: 2.2, recoil: 2.2 }
    },
    {
      key: "staff",
      name: "\u58A8\u80FD\u6CD5\u6756",
      kind: "gun",
      damage: 36,
      interval: 0.45,
      magazine: 0,
      reload: 0,
      range: 80,
      spread: 4e-3,
      area: 0,
      skill: { name: "\u58A8\u80FD\u6CD5\u9635", cooldown: 8, help: "\u5728\u51C6\u661F\u5904\u653E\u4E00\u4E2A 4 \u79D2\u7684\u6CD5\u9635\uFF0C\u6301\u7EED\u4F24\u5BB3" },
      unlock: { kind: "restored", count: 1, text: "\u6062\u590D\u7B2C\u4E00\u5EA7\u57CE" },
      pvp: { damage: 18, head: 1.5 },
      look: [color("purple"), color("yellow")],
      shot: {
        muzzle: [0, -0.27, -0.33],
        flash: 0.9,
        recoil: 0.5,
        tracer: { speed: 140, length: 1.6, width: 0.07, color: color("purple") }
      }
    }
  ];

  // src/world/paint/surfaces.ts
  var DRAINED = 0;
  var ORIGINAL = 1;
  var GRAFFITI_BASE = 2;
  var graffiti = (color2) => GRAFFITI_BASE + color2;
  var isColored = (state) => state !== DRAINED;
  function surfaceCost(info) {
    return info.area >= TUNING.brush.largeSurfaceArea ? 2 : 1;
  }
  var KIND_CODE = { wall: 1, roof: 2, door: 3, ground: 4 };
  var fingerprints = /* @__PURE__ */ new WeakMap();
  function surfaceFingerprint(infos) {
    let f = fingerprints.get(infos);
    if (f !== void 0) return f;
    f = hashInts(24301, infos.length);
    for (const s of infos) f = hashInts(f, KIND_CODE[s.kind], s.chunk, Math.round(s.area * 10));
    fingerprints.set(infos, f);
    return f;
  }
  function coloredRatio(states, infos, chunk) {
    let total = 0;
    let colored = 0;
    for (let i = 0; i < infos.length; i++) {
      if (chunk !== void 0 && infos[i].chunk !== chunk) continue;
      total++;
      if (isColored(states[i])) colored++;
    }
    return total === 0 ? 0 : colored / total;
  }

  // src/world/city/origin.ts
  function startsPeaceful(seed, cityId) {
    const match = /^c(-?\d+)_(-?\d+)$/.exec(cityId);
    if (!match) return false;
    const cx = Number(match[1]);
    const cz = Number(match[2]);
    const [firstX, firstZ] = TUNING.structures.firstCityChunk;
    return cx === firstX && cz === firstZ || unit(hashAt(seed, "peaceful-village", cx, cz)) < TUNING.city.peacefulChance;
  }

  // src/content/progression.ts
  var XP = {
    surface: 1,
    blockColored: 60,
    tideHeld: 40,
    cityRestored: 150,
    ruinFound: 25,
    monster: 4,
    wellCleansed: 35
  };
  var LEVEL_XP = [0, 100, 300, 600, 1e3, 1500, 2100, 2800, 3600, 4500];
  var MAX_LEVEL = LEVEL_XP.length;
  var ATTRIBUTES = [
    { key: "health", name: "\u751F\u547D", per: 8, help: "\u751F\u547D\u4E0A\u9650" },
    { key: "weapon", name: "\u6B66\u5668\u5F3A\u5EA6", per: 5, help: "\u6B66\u5668\u4F24\u5BB3\uFF08%\uFF09" },
    { key: "skill", name: "\u6280\u80FD\u5F3A\u5EA6", per: 5, help: "\u7B14\u5237\u901F\u5EA6\u3001\u63A8\u58A8\u6F6E\u3001\u6B66\u5668\u6280\u80FD\uFF08%\uFF09" },
    { key: "armor", name: "\u9632\u62A4", per: 6, help: "\u51CF\u4F24\uFF1A\u9632\u62A4 /\uFF08\u751F\u547D + \u9632\u62A4\uFF09" }
  ];
  var MILESTONES = {
    firstBlockColored: 1,
    /** Per city, at this many blocks coloured (the 5th, 10th, ...). */
    cityBlocks: [5, 10, 15, 20],
    cityBlocksPoint: 1,
    firstTideHeld: 1,
    allColors: 2,
    cityRestored: 3
  };

  // src/world/progression.ts
  function createGrowth() {
    return { xp: 0, points: 0, attrs: { health: 0, weapon: 0, skill: 0, armor: 0 }, milestones: [] };
  }
  function levelOf(xp) {
    let level = 1;
    while (level < MAX_LEVEL && xp >= LEVEL_XP[level]) level++;
    return level;
  }
  function milestone(g, id, points) {
    if (g.milestones.includes(id)) return false;
    g.milestones.push(id);
    g.points += points;
    return true;
  }
  function validGrowth(raw) {
    var _a2;
    const g = createGrowth();
    if (!raw || typeof raw !== "object") return g;
    const r = raw;
    const n = (v) => Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    g.xp = n(r.xp);
    g.points = n(r.points);
    for (const a of ATTRIBUTES) g.attrs[a.key] = n((_a2 = r.attrs) == null ? void 0 : _a2[a.key]);
    g.milestones = Array.isArray(r.milestones) ? r.milestones.filter((m) => typeof m === "string") : [];
    return g;
  }

  // src/content/wild-models.ts
  var WILD_MODELS = [
    { key: "skeleton/Skeleton_Mage", name: "\u9AB7\u9AC5\u6CD5\u5E08", halfWidth: 0.55, height: 1.6 },
    { key: "skeleton/Skeleton_Minion", name: "\u9AB7\u9AC5\u55BD\u5570", halfWidth: 0.49, height: 1.6 },
    { key: "skeleton/Skeleton_Rogue", name: "\u9AB7\u9AC5\u6E38\u8361\u8005", halfWidth: 0.46, height: 1.6 },
    { key: "skeleton/Skeleton_Warrior", name: "\u9AB7\u9AC5\u6218\u58EB", halfWidth: 0.47, height: 1.6 },
    { key: "cute/Alien", name: "\u6797\u5730\u661F\u5BA2", halfWidth: 0.57, height: 1.08 },
    { key: "cute/Alien_Tall", name: "\u6797\u5730\u957F\u8EAB\u661F\u5BA2", halfWidth: 0.52, height: 1.08 },
    { key: "cute/Bat", name: "\u6797\u5730\u8759\u8760", halfWidth: 0.72, height: 1.08, hitBottom: 0.292 },
    { key: "cute/Bee", name: "\u6797\u5730\u8702", halfWidth: 0.58, height: 1.08, hitBottom: 0.292 },
    { key: "cute/Cactus", name: "\u6797\u5730\u638C\u7403", halfWidth: 0.57, height: 1.08 },
    { key: "cute/Chicken", name: "\u6797\u5730\u96CF\u9E21", halfWidth: 0.75, height: 1.08 },
    { key: "cute/Crab", name: "\u6797\u5730\u8783\u87F9", halfWidth: 0.88, height: 1.08 },
    { key: "cute/Cthulhu", name: "\u6797\u5730\u89E6\u987B\u517D", halfWidth: 0.81, height: 1.08, hitBottom: 0.292 },
    { key: "cute/Cyclops", name: "\u6797\u5730\u72EC\u773C\u602A", halfWidth: 0.53, height: 1.08 },
    { key: "cute/Deer", name: "\u6797\u5730\u6797\u9E7F", halfWidth: 0.53, height: 1.08 },
    { key: "cute/Demon", name: "\u6797\u5730\u89D2\u9B54", halfWidth: 0.65, height: 1.08 },
    { key: "cute/Ghost", name: "\u6797\u5730\u5E7D\u7075", halfWidth: 0.56, height: 1.08 },
    { key: "cute/GreenDemon", name: "\u6797\u5730\u7EFF\u89D2\u9B54", halfWidth: 0.55, height: 1.08 },
    { key: "cute/Mushroom", name: "\u6797\u5730\u8611\u83C7", halfWidth: 0.5, height: 1.08 },
    { key: "cute/Panda", name: "\u6797\u5730\u718A\u732B", halfWidth: 0.6, height: 1.08 },
    { key: "cute/Penguin", name: "\u6797\u5730\u4F01\u9E45", halfWidth: 0.75, height: 1.08 },
    { key: "cute/Pig", name: "\u6797\u5730\u91CE\u732A", halfWidth: 0.62, height: 1.08 },
    { key: "cute/Skull", name: "\u6797\u5730\u9AB7\u9AC5\u5934", halfWidth: 0.51, height: 1.08 },
    { key: "cute/Tree", name: "\u6797\u5730\u6811\u7CBE", halfWidth: 0.53, height: 1.08 },
    { key: "cute/YellowDragon", name: "\u6797\u5730\u9EC4\u9F99", halfWidth: 0.77, height: 1.08, hitBottom: 0.292 },
    { key: "cute/Yeti", name: "\u6797\u5730\u96EA\u602A", halfWidth: 0.54, height: 1.08 },
    { key: "big/Alien", name: "\u5DE8\u578B\u661F\u5BA2", halfWidth: 0.89, height: 1.85 },
    { key: "big/Birb", name: "\u5DE8\u578B\u5706\u96C0", halfWidth: 0.96, height: 1.85 },
    { key: "big/BlueDemon", name: "\u5DE8\u578B\u84DD\u89D2\u9B54", halfWidth: 1.1, height: 1.85 },
    { key: "big/Bunny", name: "\u5DE8\u578B\u91CE\u5154", halfWidth: 0.86, height: 1.85 },
    { key: "big/Cactoro", name: "\u5DE8\u578B\u4ED9\u4EBA\u638C", halfWidth: 0.79, height: 1.85 },
    { key: "big/Demon", name: "\u5DE8\u578B\u89D2\u9B54", halfWidth: 1.15, height: 1.85 },
    { key: "big/Dino", name: "\u5DE8\u578B\u6050\u9F99", halfWidth: 0.99, height: 1.85 },
    { key: "big/Fish", name: "\u5DE8\u578B\u9C7C\u517D", halfWidth: 0.84, height: 1.85 },
    { key: "big/Frog", name: "\u5DE8\u578B\u86D9\u517D", halfWidth: 1.19, height: 1.85 },
    { key: "big/Monkroose", name: "\u5DE8\u578B\u957F\u8033\u602A", halfWidth: 1.07, height: 1.85 },
    { key: "big/MushroomKing", name: "\u5DE8\u578B\u8611\u83C7\u738B", halfWidth: 0.91, height: 1.85 },
    { key: "big/Ninja", name: "\u5DE8\u578B\u5FCD\u8005", halfWidth: 1, height: 1.85 },
    { key: "big/Orc", name: "\u5DE8\u578B\u517D\u4EBA", halfWidth: 0.99, height: 1.85 },
    { key: "big/Orc_Skull", name: "\u5DE8\u578B\u9AA8\u9762\u517D\u4EBA", halfWidth: 0.95, height: 1.85 },
    { key: "big/Tribal", name: "\u5DE8\u578B\u9762\u5177\u602A", halfWidth: 0.81, height: 1.85 },
    { key: "big/Yeti", name: "\u5DE8\u578B\u96EA\u602A", halfWidth: 1.13, height: 1.85 },
    { key: "blob/Alien", name: "\u56E2\u5B50\u661F\u5BA2", halfWidth: 0.51, height: 0.85 },
    { key: "blob/Birb", name: "\u56E2\u5B50\u5706\u96C0", halfWidth: 0.45, height: 0.85 },
    { key: "blob/Cactoro", name: "\u56E2\u5B50\u4ED9\u4EBA\u638C", halfWidth: 0.48, height: 0.85 },
    { key: "blob/Cat", name: "\u56E2\u5B50\u5C71\u732B", halfWidth: 0.46, height: 0.85 },
    { key: "blob/Chicken", name: "\u56E2\u5B50\u96CF\u9E21", halfWidth: 0.42, height: 0.85 },
    { key: "blob/Dog", name: "\u56E2\u5B50\u730E\u72AC", halfWidth: 0.5, height: 0.85 },
    { key: "blob/Fish", name: "\u56E2\u5B50\u9C7C\u517D", halfWidth: 0.44, height: 0.85 },
    { key: "blob/GreenBlob", name: "\u56E2\u5B50\u7EFF\u56E2", halfWidth: 0.51, height: 0.85 },
    { key: "blob/GreenSpikyBlob", name: "\u56E2\u5B50\u523A\u56E2", halfWidth: 0.42, height: 0.85 },
    { key: "blob/Mushnub", name: "\u56E2\u5B50\u83CC\u83C7", halfWidth: 0.35, height: 0.85 },
    { key: "blob/Mushnub_Evolved", name: "\u56E2\u5B50\u83CC\u83C7\xB7\u8FDB\u5316", halfWidth: 0.34, height: 0.85 },
    { key: "blob/Ninja", name: "\u56E2\u5B50\u5FCD\u8005", halfWidth: 0.38, height: 0.85 },
    { key: "blob/Orc", name: "\u56E2\u5B50\u517D\u4EBA", halfWidth: 0.48, height: 0.85 },
    { key: "blob/Pigeon", name: "\u56E2\u5B50\u5CA9\u9E3D", halfWidth: 0.55, height: 0.85 },
    { key: "blob/PinkBlob", name: "\u56E2\u5B50\u7C89\u56E2", halfWidth: 0.39, height: 0.85 },
    { key: "blob/Wizard", name: "\u56E2\u5B50\u5DEB\u5E08", halfWidth: 0.38, height: 0.85 },
    { key: "blob/Yeti", name: "\u56E2\u5B50\u96EA\u602A", halfWidth: 0.45, height: 0.85 },
    { key: "flying/Alpaking", name: "\u98DE\u7A7A\u9A7C\u738B", halfWidth: 0.99, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Alpaking_Evolved", name: "\u98DE\u7A7A\u9A7C\u738B\xB7\u8FDB\u5316", halfWidth: 0.67, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Armabee", name: "\u98DE\u7A7A\u7532\u8702", halfWidth: 1.12, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Armabee_Evolved", name: "\u98DE\u7A7A\u7532\u8702\xB7\u8FDB\u5316", halfWidth: 0.99, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Demon", name: "\u98DE\u7A7A\u89D2\u9B54", halfWidth: 0.99, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Dragon", name: "\u98DE\u7A7A\u7FFC\u9F99", halfWidth: 1.43, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Dragon_Evolved", name: "\u98DE\u7A7A\u7FFC\u9F99\xB7\u8FDB\u5316", halfWidth: 0.76, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Ghost", name: "\u98DE\u7A7A\u5E7D\u7075", halfWidth: 0.48, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Ghost_Skull", name: "\u98DE\u7A7A\u9AA8\u7075", halfWidth: 0.48, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Glub", name: "\u98DE\u7A7A\u6D6E\u6CE1\u517D", halfWidth: 0.9, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Glub_Evolved", name: "\u98DE\u7A7A\u6D6E\u6CE1\u517D\xB7\u8FDB\u5316", halfWidth: 0.57, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Goleling", name: "\u98DE\u7A7A\u77F3\u7075", halfWidth: 1.4, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Goleling_Evolved", name: "\u98DE\u7A7A\u77F3\u7075\xB7\u8FDB\u5316", halfWidth: 0.84, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Hywirl", name: "\u98DE\u7A7A\u65CB\u98CE\u517D", halfWidth: 0.53, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Pigeon", name: "\u98DE\u7A7A\u5CA9\u9E3D", halfWidth: 1.49, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Squidle", name: "\u98DE\u7A7A\u5C0F\u9C7F", halfWidth: 0.91, height: 1.35, hitBottom: 0.365 },
    { key: "flying/Tribal", name: "\u98DE\u7A7A\u9762\u5177\u602A", halfWidth: 0.38, height: 1.35, hitBottom: 0.365 },
    { key: "outbreak/Zombie_Basic", name: "\u6E38\u8361\u50F5\u5C38", halfWidth: 0.79, height: 1.45 },
    { key: "outbreak/Zombie_Arm", name: "\u5DE8\u81C2\u50F5\u5C38", halfWidth: 1.12, height: 1.55 },
    { key: "outbreak/Zombie_Chubby", name: "\u80D6\u50F5\u5C38", halfWidth: 0.96, height: 1.72 },
    { key: "outbreak/Zombie_Ribcage", name: "\u67AF\u9AA8\u50F5\u5C38", halfWidth: 0.32, height: 1.18 },
    { key: "dinosaurs/Apatosaurus", name: "\u8FF7\u60D1\u9F99", halfWidth: 0.43, halfLength: 3.48, height: 1.65 },
    { key: "dinosaurs/Parasaurolophus", name: "\u526F\u6809\u9F99", halfWidth: 0.27, halfLength: 1.35, height: 1.45 },
    { key: "dinosaurs/Stegosaurus", name: "\u5251\u9F99", halfWidth: 0.4, halfLength: 1.65, height: 1.6 },
    { key: "dinosaurs/Trex", name: "\u9738\u738B\u9F99", halfWidth: 0.52, halfLength: 1.8, height: 1.95 },
    { key: "dinosaurs/Triceratops", name: "\u4E09\u89D2\u9F99", halfWidth: 0.49, halfLength: 1.7, height: 1.5 },
    { key: "dinosaurs/Velociraptor", name: "\u8FC5\u731B\u9F99", halfWidth: 0.25, halfLength: 0.93, height: 1 },
    { key: "cube/Demon", name: "\u65B9\u5757\u89D2\u9B54", halfWidth: 0.82, height: 1.6 },
    { key: "cube/Giant", name: "\u65B9\u5757\u5DE8\u4EBA", halfWidth: 0.8, height: 2.1 },
    { key: "cube/Goblin", name: "\u65B9\u5757\u5730\u7CBE", halfWidth: 0.44, height: 1.2 },
    { key: "cube/Skeleton", name: "\u65B9\u5757\u9AB7\u9AC5", halfWidth: 0.47, height: 1.5 },
    { key: "cube/Skeleton_Armor", name: "\u65B9\u5757\u91CD\u7532\u9AB7\u9AC5", halfWidth: 0.53, height: 1.72 },
    { key: "cube/Wizard", name: "\u65B9\u5757\u5DEB\u5E08", halfWidth: 0.44, height: 1.8 },
    { key: "cube/Yeti", name: "\u65B9\u5757\u96EA\u602A", halfWidth: 0.91, height: 1.85 },
    { key: "cube/Zombie", name: "\u65B9\u5757\u50F5\u5C38", halfWidth: 0.45, height: 1.5 },
    { key: "cyber/Enemy_2Legs", name: "\u53CC\u8DB3\u5DE1\u903B\u673A", halfWidth: 0.82, height: 0.9 },
    { key: "cyber/Enemy_Flying", name: "\u60AC\u6D6E\u5DE1\u903B\u673A", halfWidth: 0.76, height: 1.25, hitBottom: 0.3375 },
    { key: "cyber/Enemy_Large", name: "\u91CD\u88C5\u5DE1\u903B\u673A", halfWidth: 1.32, height: 1.7 }
  ];

  // src/content/enemies.ts
  var ENEMIES = [
    {
      key: "blot",
      name: "\u58A8\u56E2",
      hp: 60,
      speed: 4.4,
      halfWidth: 0.45,
      height: 1.2,
      aggro: 22,
      ink: 5,
      attack: { kind: "melee", range: 1.8, damage: 12, cooldown: 0.9 },
      body: color("ink"),
      eyes: color("red")
    },
    {
      key: "spitter",
      name: "\u58A8\u5410",
      hp: 45,
      speed: 3.2,
      halfWidth: 0.4,
      height: 1.7,
      aggro: 28,
      ink: 6,
      attack: { kind: "spit", keepAway: [9, 16], range: 26, damage: 10, cooldown: 2.2, speed: 18 },
      body: color("ink"),
      eyes: color("yellow")
    },
    {
      // a blot that has swallowed a street's worth of colour: slow, heavy, only the sniper and
      // the launcher break its slam. Never in strongholds (saves fingerprint their types): it
      // roams the greyest wilderness and leads some ink tides
      key: "giant",
      name: "\u58A8\u5DE8",
      hp: 240,
      speed: 3.1,
      halfWidth: 0.85,
      height: 2.5,
      aggro: 24,
      ink: 20,
      attack: { kind: "melee", range: 3, damage: 26, cooldown: 1.7 },
      poise: 50,
      elite: true,
      body: color("ink"),
      eyes: color("orange")
    },
    {
      // a low, quick slick of ink that circles in, crouches, and springs straight through where
      // the player stood: step aside as it crouches. Wild and tide only, like the 墨巨
      key: "weasel",
      name: "\u58A8\u9F2C",
      hp: 35,
      speed: 5.6,
      halfWidth: 0.35,
      height: 0.8,
      aggro: 26,
      ink: 4,
      attack: { kind: "lunge", range: 7, damage: 14, cooldown: 2.6, dash: 15 },
      body: color("ink"),
      eyes: color("green")
    },
    {
      key: "frog",
      name: "\u58A8\u86D9",
      hp: 40,
      speed: 3.6,
      halfWidth: 0.78,
      height: 0.66,
      aggro: 20,
      ink: 5,
      attack: { kind: "lunge", range: 6, damage: 12, cooldown: 2.8, dash: 12 },
      body: color("ink"),
      eyes: color("green")
    },
    {
      key: "rat",
      name: "\u58A8\u9F20",
      hp: 30,
      speed: 5.1,
      halfWidth: 0.34,
      height: 0.7,
      aggro: 20,
      ink: 4,
      attack: { kind: "melee", range: 1.5, damage: 8, cooldown: 0.8 },
      body: color("ink"),
      eyes: color("pink")
    },
    {
      key: "snake",
      name: "\u58A8\u86C7",
      hp: 40,
      speed: 3.3,
      halfWidth: 0.32,
      height: 1.12,
      aggro: 20,
      ink: 5,
      attack: { kind: "melee", range: 1.7, damage: 12, cooldown: 1.3 },
      body: color("ink"),
      eyes: color("green")
    },
    {
      key: "snake-angry",
      name: "\u6012\u58A8\u86C7",
      hp: 55,
      speed: 4,
      halfWidth: 0.34,
      height: 1.22,
      aggro: 24,
      ink: 6,
      attack: { kind: "lunge", range: 5, damage: 14, cooldown: 2.6, dash: 12 },
      body: color("ink"),
      eyes: color("red")
    },
    {
      key: "spider",
      name: "\u58A8\u86DB",
      hp: 38,
      speed: 4.5,
      halfWidth: 0.74,
      height: 0.6,
      aggro: 22,
      ink: 5,
      attack: { kind: "melee", range: 1.7, damage: 10, cooldown: 1 },
      body: color("ink"),
      eyes: color("purple")
    },
    {
      key: "wasp",
      name: "\u58A8\u8702",
      hp: 32,
      speed: 4.8,
      halfWidth: 0.44,
      height: 1.2,
      aggro: 23,
      ink: 5,
      attack: { kind: "lunge", range: 5.5, damage: 11, cooldown: 2.3, dash: 13 },
      body: color("ink"),
      eyes: color("yellow")
    },
    {
      key: "star-mote",
      name: "\u58A8\u661F\u5E7C\u4F53",
      hp: 28,
      speed: 5.2,
      halfWidth: 0.31,
      height: 0.72,
      hitBottom: 0.16,
      aggro: 22,
      ink: 4,
      attack: { kind: "lunge", range: 4, damage: 8, cooldown: 2.1, dash: 12 },
      body: color("ink"),
      eyes: color("sky")
    },
    {
      key: "star-orb",
      name: "\u58A8\u661F\u6D6E\u7403",
      hp: 44,
      speed: 3.7,
      halfWidth: 0.4,
      height: 1.05,
      hitBottom: 0.24,
      aggro: 23,
      ink: 5,
      attack: { kind: "melee", range: 1.65, damage: 11, cooldown: 1.1 },
      body: color("ink"),
      eyes: color("teal")
    },
    {
      key: "star-wing",
      name: "\u58A8\u661F\u98DE\u7FFC",
      hp: 36,
      speed: 5.1,
      halfWidth: 0.53,
      height: 1.24,
      hitBottom: 0.3,
      aggro: 24,
      ink: 5,
      attack: { kind: "lunge", range: 5.5, damage: 12, cooldown: 2.5, dash: 13 },
      body: color("ink"),
      eyes: color("purple")
    },
    {
      key: "star-brute",
      name: "\u58A8\u661F\u91CD\u517D",
      hp: 95,
      speed: 3.2,
      halfWidth: 0.59,
      height: 1.8,
      aggro: 22,
      ink: 9,
      attack: { kind: "melee", range: 2.1, damage: 16, cooldown: 1.5 },
      body: color("ink"),
      eyes: color("orange")
    },
    ...WILD_MODELS.map((model) => {
      const bulky = model.key.startsWith("big/") || "halfLength" in model && model.height >= 1.5 || model.key === "outbreak/Zombie_Chubby" || model.key === "cube/Giant" || model.key === "cube/Yeti" || model.key === "cyber/Enemy_Large";
      const ranged = model.key === "skeleton/Skeleton_Mage" || model.key === "blob/Wizard" || model.key === "cube/Wizard";
      const lunges = "hitBottom" in model || model.key === "skeleton/Skeleton_Rogue" || model.key === "dinosaurs/Velociraptor";
      const attack = ranged ? { kind: "spit", keepAway: [6, 12], range: 20, damage: 10, cooldown: 2.1, speed: 15 } : lunges ? { kind: "lunge", range: 5, damage: 11, cooldown: 2.5, dash: 11 } : {
        kind: "melee",
        range: 1.3 + ("halfLength" in model ? model.halfLength : model.halfWidth),
        damage: bulky ? 17 : 10,
        cooldown: bulky ? 1.5 : 1
      };
      return __spreadProps(__spreadValues({}, model), {
        hp: bulky ? 85 : 40,
        speed: bulky ? 3.1 : 4,
        aggro: 22,
        ink: bulky ? 8 : 5,
        attack,
        body: color("ink"),
        eyes: color("teal")
      });
    })
  ];
  function enemyIndex(key) {
    const i = ENEMIES.findIndex((e) => e.key === key);
    if (i < 0) throw new Error(`Unknown enemy: ${key}`);
    return i;
  }

  // src/content/names.ts
  var CITY_PREFIX = ["\u9752", "\u767D", "\u58A8", "\u7EB8", "\u6674", "\u96FE", "\u6A58", "\u677E", "\u9E6D", "\u4E91", "\u781A", "\u67F3"];
  var CITY_SUFFIX = ["\u5DDD\u57CE", "\u6865\u9547", "\u6E2F", "\u77F3\u57CE", "\u5761\u9547", "\u6E7E", "\u539F\u57CE", "\u6EAA\u9547"];
  var RESIDENT_NAMES = [
    "\u8001\u9648",
    "\u963F\u6885",
    "\u5C0F\u6797",
    "\u5468\u5976\u5976",
    "\u5927\u5218",
    "\u963F\u9752",
    "\u5434\u8001\u5E08",
    "\u5C0F\u6EE1",
    "\u8001\u8BB8",
    "\u79E6\u59D0",
    "\u963F\u798F",
    "\u5C0F\u96E8",
    "\u4F55\u5E08\u5085",
    "\u8C46\u8C46",
    "\u65B9\u5A76",
    "\u8001\u6768",
    "\u963F\u67DA",
    "\u77F3\u5934",
    "\u5B8B\u5148\u751F",
    "\u5C0F\u67A3"
  ];

  // src/world/city/features.ts
  var BLOT = enemyIndex("blot");
  var SPITTER = enemyIndex("spitter");
  function placeFeatures(c) {
    var _a2;
    const { n, cell, roads } = c;
    const side = c.chunks;
    const chunkCells = n / side;
    const chunkOfCell = (ix, iz) => Math.min(side - 1, Math.floor(iz / chunkCells)) * side + Math.min(side - 1, Math.floor(ix / chunkCells));
    const rng = new Rng(hashInts(c.seed, 22433));
    const roadCells = Array.from({ length: side * side }, () => []);
    for (let iz = 2; iz < n - 2; iz++)
      for (let ix = 2; ix < n - 2; ix++)
        if (roads[iz * n + ix] !== 0 && !((_a2 = c.water) == null ? void 0 : _a2[iz * n + ix]))
          roadCells[chunkOfCell(ix, iz)].push(iz * n + ix);
    const stains = [];
    roadCells.forEach((cells, chunk) => {
      const pool = [...cells];
      for (let k = 0; k < TUNING.economy.stainsPerChunk && pool.length; k++) {
        const i = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
        const ix = i % n;
        const iz = (i - ix) / n;
        stains.push({
          x: (ix + 0.2 + 0.6 * rng.next()) * cell,
          z: (iz + 0.2 + 0.6 * rng.next()) * cell,
          chunk,
          size: 0.8 + 0.7 * rng.next()
        });
      }
    });
    const per = n * cell / side;
    const studios = [];
    for (let chunk = 0; chunk < side * side; chunk++) {
      const ccx = (chunk % side + 0.5) * per;
      const ccz = (Math.floor(chunk / side) + 0.5) * per;
      let best = null;
      let bestD = Infinity;
      for (const b of c.buildings) {
        if (c.surfaces[b.roof].chunk !== chunk) continue;
        const door = doorFront(b, 1.6);
        const d = Math.hypot(door.x - ccx, door.z - ccz);
        if (d < bestD) {
          bestD = d;
          best = { building: b.id, chunk, door };
        }
      }
      if (best) studios.push(best);
    }
    let homeStudio = -1;
    let homeD = Infinity;
    studios.forEach((s, i) => {
      const d = Math.hypot(s.door.x - c.spawn.x, s.door.z - c.spawn.z);
      if (d < homeD) {
        homeD = d;
        homeStudio = i;
      }
    });
    const mrng = new Rng(hashInts(c.seed, 57630));
    const [lo, hi] = side <= TUNING.city.firstCityChunks ? TUNING.combat.stronghold.first : TUNING.combat.stronghold.other;
    const monsters = [];
    roadCells.forEach((cells, chunk) => {
      if (!cells.length) return;
      const count = mrng.int(lo, hi);
      const post = cells[Math.floor(mrng.next() * cells.length)];
      const near2 = cells.map((i) => ({ i, d: Math.hypot(i % n - post % n, Math.floor(i / n) - Math.floor(post / n)) })).sort((a, b) => a.d - b.d).slice(0, Math.max(count * 3, 6));
      for (let k = 0; k < count; k++) {
        const i = near2[Math.floor(mrng.next() * near2.length)].i;
        monsters.push({
          type: mrng.chance(TUNING.combat.spitterChance) ? SPITTER : BLOT,
          x: (i % n + 0.5) * cell,
          z: (Math.floor(i / n) + 0.5) * cell,
          chunk
        });
      }
    });
    const spawnChunk = chunkOfCell(Math.floor(c.spawn.x / cell), Math.floor(c.spawn.z / cell));
    const residentsRng = new Rng(hashInts(c.seed, 24213));
    const studioBuildings = new Set(studios.map((s) => s.building));
    const residents = [];
    for (let chunk = 0; chunk < side * side; chunk++) {
      const homes2 = c.buildings.filter(
        (b) => c.surfaces[b.roof].chunk === chunk && !studioBuildings.has(b.id)
      );
      const want = residentsRng.int(1, 2);
      for (let k = 0; k < want && homes2.length; k++) {
        const b = homes2.splice(Math.floor(residentsRng.next() * homes2.length), 1)[0];
        for (let draw = 0; draw < 4; draw++) residentsRng.next();
        residents.push({ building: b.id, chunk, name: residentsRng.pick(RESIDENT_NAMES) });
      }
    }
    const guards = monsters.filter((m) => m.chunk !== spawnChunk);
    const density = new Rng(hashInts(c.seed, 32478));
    const houses = c.buildings.length;
    const targetGuards = density.int(houses, Math.floor(houses * 1.5));
    const occupied = new Set(guards.map((m) => Math.floor(m.z / cell) * n + Math.floor(m.x / cell)));
    const streets = roadCells.flatMap((cells, chunk) => {
      if (side > 1 && chunk === spawnChunk) return [];
      return cells.filter(
        (i) => !occupied.has(i) && Math.hypot((i % n + 0.5) * cell - c.spawn.x, (Math.floor(i / n) + 0.5) * cell - c.spawn.z) > 12
      );
    });
    guards.length = Math.min(guards.length, targetGuards);
    while (guards.length < targetGuards && streets.length) {
      const k = density.int(0, streets.length - 1);
      const i = streets[k];
      streets[k] = streets[streets.length - 1];
      streets.pop();
      const ix = i % n, iz = Math.floor(i / n);
      guards.push({
        x: (ix + 0.5) * cell,
        z: (iz + 0.5) * cell,
        chunk: chunkOfCell(ix, iz),
        type: density.chance(TUNING.combat.spitterChance) ? SPITTER : BLOT
      });
    }
    const families = new Rng(hashInts(c.seed, 29212));
    const targetResidents = families.int(Math.ceil(houses * 1.2), Math.floor(houses * 2.1));
    const occupiedHomes = new Set(residents.map((r) => r.building));
    let homes = c.buildings.filter((b) => !studioBuildings.has(b.id));
    if (!homes.length) homes = [...c.buildings];
    let available = homes.filter((b) => !occupiedHomes.has(b.id));
    while (residents.length < targetResidents) {
      if (!available.length) available = [...homes];
      const k = families.int(0, available.length - 1);
      const b = available[k];
      available[k] = available[available.length - 1];
      available.pop();
      residents.push({ building: b.id, chunk: c.surfaces[b.roof].chunk, name: families.pick(RESIDENT_NAMES) });
    }
    return { stains, studios, homeStudio, monsters: guards, residents };
  }
  function doorFront(b, out) {
    return { x: b.x + Math.sin(b.angle) * (b.hd + out), z: b.z + Math.cos(b.angle) * (b.hd + out) };
  }
  function studioOpen(skel, states, index2) {
    const s = skel.studios[index2];
    if (!s) return false;
    if (index2 === skel.homeStudio) return true;
    return coloredRatio(states, skel.surfaces, s.chunk) >= TUNING.blocks.coloredAt;
  }
  function stainFingerprint(stains, ox = 0, oz = 0) {
    let f = hashInts(22433, stains.length);
    for (const s of stains) f = hashInts(f, Math.round((s.x - ox) * 10), Math.round((s.z - oz) * 10));
    return f;
  }
  function monsterFingerprint(monsters, ox = 0, oz = 0) {
    let f = hashInts(57630, monsters.length);
    for (const m of monsters) f = hashInts(f, m.type, Math.round((m.x - ox) * 10), Math.round((m.z - oz) * 10));
    return f;
  }
  function standingMonsters(skel, defeated, chunk) {
    return skel.monsters.flatMap((m, i) => m.chunk === chunk && !defeated[i] ? [i] : []);
  }

  // src/world/state.ts
  var SAVE_VERSION = 13;
  var newTide = () => ({ nextIn: TUNING.tide.firstDelay, wave: null });
  function validTide(t) {
    const j = t;
    const nextIn = typeof (j == null ? void 0 : j.n) === "number" && Number.isFinite(j.n) ? Math.max(0, j.n) : TUNING.tide.firstDelay;
    const w = Array.isArray(j == null ? void 0 : j.w) && j.w.length === 5 && j.w.every((x) => typeof x === "number" && Number.isFinite(x)) ? j.w : null;
    return {
      nextIn,
      wave: w ? {
        chunk: w[0] | 0,
        from: w[1] | 0,
        startsIn: Math.max(0, w[2]),
        endsIn: Math.max(0, w[3]),
        front: Math.max(0, w[4])
      } : null
    };
  }
  var STARTING_COLORS = [color("red"), color("blue"), color("yellow"), color("green")];
  function createWorldState(id, seed, name = "\u65B0\u4E16\u754C") {
    return {
      version: SAVE_VERSION,
      terrainVersion: TERRAIN_VERSION,
      id,
      seed,
      name,
      inventory: {
        generic: TUNING.brush.startingGeneric,
        ink: 0,
        brushTier: 0,
        glider: false,
        weapons: WEAPONS.filter((w) => w.unlock.kind === "start").map((w) => w.key)
      },
      unlocked: [...STARTING_COLORS],
      cities: /* @__PURE__ */ new Map(),
      travellerMemorySince: 0,
      travellerLegs: /* @__PURE__ */ new Map(),
      legacyTowns: [],
      player: null,
      clock: 0,
      calendarOffset: 0,
      infectedAt: null,
      infectedPeople: /* @__PURE__ */ new Map(),
      inkAreas: /* @__PURE__ */ new Map(),
      harvested: /* @__PURE__ */ new Map(),
      drop: null,
      hunted: /* @__PURE__ */ new Map(),
      cleansed: /* @__PURE__ */ new Map(),
      growth: createGrowth(),
      discovered: [],
      marks: [],
      nextMark: 1
    };
  }
  function cityStates(state, cityId, skel) {
    const fingerprint = surfaceFingerprint(skel.surfaces);
    const stainFp = stainFingerprint(skel.stains, skel.ox, skel.oz);
    const monsterFp = monsterFingerprint(skel.monsters, skel.ox, skel.oz);
    let saved = state.cities.get(cityId);
    let reset = false;
    if (saved) {
      if (saved.fingerprint === null && saved.states.length === skel.surfaces.length)
        saved.fingerprint = fingerprint;
      if (saved.fingerprint !== fingerprint) {
        saved.fingerprint = fingerprint;
        saved.states = new Uint8Array(skel.surfaces.length).fill(saved.peaceful ? ORIGINAL : 0);
        saved.completed = false;
        saved.altarGuards = 0;
        saved.restoredAt = null;
        saved.coloredOnce = new Uint8Array(skel.chunks * skel.chunks).fill(saved.peaceful ? 1 : 0);
        saved.stockFrom = new Array(skel.chunks * skel.chunks).fill(-1);
        saved.tide = newTide();
        reset = true;
      }
    } else {
      const peaceful = startsPeaceful(state.seed, cityId);
      saved = {
        fingerprint,
        states: new Uint8Array(skel.surfaces.length).fill(peaceful ? ORIGINAL : 0),
        stainFingerprint: stainFp,
        stains: new Uint8Array(skel.stains.length).fill(peaceful ? 1 : 0),
        completed: false,
        restoredAt: null,
        peaceful,
        monsterFingerprint: monsterFp,
        defeated: new Uint8Array(skel.monsters.length).fill(peaceful ? 1 : 0),
        altarGuards: 0,
        coloredOnce: new Uint8Array(skel.chunks * skel.chunks).fill(peaceful ? 1 : 0),
        stockFrom: new Array(skel.chunks * skel.chunks).fill(-1),
        tide: newTide()
      };
      state.cities.set(cityId, saved);
    }
    if (saved.stainFingerprint !== stainFp) {
      saved.stainFingerprint = stainFp;
      saved.stains = new Uint8Array(skel.stains.length).fill(saved.peaceful ? 1 : 0);
    }
    if (saved.monsterFingerprint !== monsterFp) {
      const previous = saved.defeated;
      const defeated = new Uint8Array(skel.monsters.length).fill(saved.peaceful ? 1 : 0);
      if (previous.length < defeated.length && saved.monsterFingerprint === monsterFingerprint(skel.monsters.slice(0, previous.length), skel.ox, skel.oz)) {
        defeated.set(previous);
        const cleared = new Set(skel.monsters.slice(0, previous.length).map((m) => m.chunk));
        for (let i = 0; i < previous.length; i++) if (!previous[i]) cleared.delete(skel.monsters[i].chunk);
        for (let i = previous.length; i < defeated.length; i++)
          defeated[i] = saved.peaceful || saved.completed || cleared.has(skel.monsters[i].chunk) || saved.coloredOnce[skel.monsters[i].chunk] === 1 ? 1 : 0;
      }
      saved.monsterFingerprint = monsterFp;
      saved.defeated = defeated;
    }
    if (saved.stockFrom.length !== skel.chunks * skel.chunks)
      saved.stockFrom = new Array(skel.chunks * skel.chunks).fill(-1);
    if (saved.coloredOnce.length !== skel.chunks * skel.chunks)
      saved.coloredOnce = new Uint8Array(skel.chunks * skel.chunks).fill(saved.peaceful ? 1 : 0);
    const w = saved.tide.wave;
    if (w && (w.chunk < 0 || w.chunk >= skel.chunks * skel.chunks || w.from < 0 || w.from > 3))
      saved.tide.wave = null;
    return {
      states: saved.states,
      stains: saved.stains,
      defeated: saved.defeated,
      coloredOnce: saved.coloredOnce,
      tide: saved.tide,
      reset
    };
  }
  function wildMonsterBack(state, id) {
    const t = state.hunted.get(id);
    return t === void 0 || state.clock - t >= TUNING.combat.wildRespawnSeconds;
  }
  function sourceReady(state, id) {
    const t = state.harvested.get(id);
    return t === void 0 || state.clock - t >= TUNING.economy.regrowSeconds;
  }
  function peacefulVillage(state, cityId) {
    var _a2, _b;
    return (_b = (_a2 = state.cities.get(cityId)) == null ? void 0 : _a2.peaceful) != null ? _b : startsPeaceful(state.seed, cityId);
  }
  function savedProgress(state, cityId) {
    const saved = state.cities.get(cityId);
    if ((saved == null ? void 0 : saved.completed) || peacefulVillage(state, cityId)) return 1;
    if (!saved || saved.states.length === 0) return 0;
    let colored = 0;
    for (const s of saved.states) if (s !== 0) colored++;
    return colored / saved.states.length;
  }
  var toBase64 = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  };
  var fromBase64 = (text) => {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  };
  function serializeWorld(state) {
    const json = {
      version: state.version,
      terrainVersion: state.terrainVersion,
      id: state.id,
      seed: state.seed,
      name: state.name,
      inventory: state.inventory,
      unlocked: state.unlocked,
      cities: Object.fromEntries(
        [...state.cities].map(
          ([k, v]) => {
            var _a2;
            return v.fingerprint === null ? [k, toBase64(v.states)] : [
              k,
              __spreadProps(__spreadValues(__spreadProps(__spreadValues(__spreadValues(__spreadValues(__spreadValues({
                f: v.fingerprint,
                s: toBase64(v.states)
              }, v.stainFingerprint === null ? {} : { sf: v.stainFingerprint, st: toBase64(v.stains) }), v.completed ? { c: 1, restoredAt: (_a2 = v.restoredAt) != null ? _a2 : state.clock } : {}), v.peaceful ? { p: 1 } : {}), v.monsterFingerprint === null ? {} : { mf: v.monsterFingerprint, d: toBase64(v.defeated) }), {
                co: toBase64(v.coloredOnce)
              }), v.altarGuards ? { ag: v.altarGuards } : {}), {
                sk: v.stockFrom,
                td: __spreadValues({
                  n: Math.round(v.tide.nextIn * 10) / 10
                }, v.tide.wave ? {
                  w: [
                    v.tide.wave.chunk,
                    v.tide.wave.from,
                    v.tide.wave.startsIn,
                    v.tide.wave.endsIn,
                    v.tide.wave.front
                  ].map((x) => Math.round(x * 10) / 10)
                } : {})
              })
            ];
          }
        )
      ),
      travellerMemorySince: state.travellerMemorySince,
      travellerLegs: state.travellerLegs.size ? Object.fromEntries(state.travellerLegs) : void 0,
      legacyTowns: state.legacyTowns,
      player: state.player,
      clock: state.clock,
      calendarOffset: state.calendarOffset,
      drop: state.drop,
      infectedAt: state.infectedAt,
      infectedPeople: Object.fromEntries(state.infectedPeople),
      inkAreas: Object.fromEntries(state.inkAreas),
      hunted: Object.fromEntries([...state.hunted].filter(([id]) => !wildMonsterBack(state, id))),
      cleansed: Object.fromEntries(state.cleansed),
      growth: state.growth,
      discovered: state.discovered,
      marks: state.marks,
      nextMark: state.nextMark,
      // grown-back sources are the same as never harvested; drop them to keep saves small
      harvested: Object.fromEntries([...state.harvested].filter(([id]) => !sourceReady(state, id)))
    };
    return JSON.stringify(json);
  }
  var SaveError = class extends Error {
  };
  function deserializeWorld(text) {
    var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y;
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new SaveError(`\u5B58\u6863\u4E0D\u662F\u6709\u6548\u7684 JSON\uFF1A${e.message}`);
    }
    if (json.version !== 1 && json.version !== 2 && json.version !== 3 && json.version !== 4 && json.version !== 5 && json.version !== 6 && json.version !== 7 && json.version !== 8 && json.version !== 9 && json.version !== 10 && json.version !== 11 && json.version !== 12 && json.version !== SAVE_VERSION)
      throw new SaveError(`\u4E0D\u652F\u6301\u7684\u5B58\u6863\u7248\u672C ${json.version}`);
    if (json.version >= 6 && ![1, 2, 3, 4, 5, 6].some((version) => version === json.terrainVersion))
      throw new SaveError(`\u4E0D\u652F\u6301\u7684\u5730\u5F62\u7248\u672C ${json.terrainVersion}`);
    if (typeof json.id !== "string" || !Number.isInteger(json.seed))
      throw new SaveError("\u5B58\u6863\u7F3A\u5C11\u4E16\u754C\u7F16\u53F7\u6216\u79CD\u5B50");
    const colored = ((_b = (_a2 = json.inventory) == null ? void 0 : _a2.colored) != null ? _b : []).reduce(
      (a, x) => a + (Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0),
      0
    );
    const clock = Number.isFinite(json.clock) ? Math.max(0, json.clock) : 0;
    return {
      version: SAVE_VERSION,
      terrainVersion: json.version < 6 ? 1 : json.terrainVersion,
      id: json.id,
      legacyTowns: json.version < 4 ? Object.keys((_c = json.cities) != null ? _c : {}) : ((_d = json.legacyTowns) != null ? _d : []).filter((id) => typeof id === "string"),
      seed: json.seed,
      name: String((_e = json.name) != null ? _e : "\u4E16\u754C"),
      inventory: {
        generic: Math.max(0, Math.floor((_g = (_f = json.inventory) == null ? void 0 : _f.generic) != null ? _g : 0)) + colored,
        ink: Math.max(0, Math.floor((_i = (_h = json.inventory) == null ? void 0 : _h.ink) != null ? _i : 0)),
        brushTier: Math.min(BRUSH_TIERS.length - 1, Math.max(0, Math.floor((_k = (_j = json.inventory) == null ? void 0 : _j.brushTier) != null ? _k : 0))),
        glider: ((_l = json.inventory) == null ? void 0 : _l.glider) === true,
        weapons: ((_n = (_m = json.inventory) == null ? void 0 : _m.weapons) != null ? _n : ["rifle"]).filter((k) => WEAPONS.some((w) => w.key === k))
      },
      unlocked: ((_o = json.unlocked) != null ? _o : []).filter((c) => PAINTABLE.includes(c)),
      travellerMemorySince: json.version >= 10 && Number.isFinite(json.travellerMemorySince) ? Math.max(0, Math.min(clock, json.travellerMemorySince)) : clock,
      travellerLegs: new Map(Object.entries((_p = json.travellerLegs) != null ? _p : {}).filter(([, v]) => validTravelLeg(v))),
      cities: new Map(
        Object.entries((_q = json.cities) != null ? _q : {}).map(
          ([k, v]) => typeof v === "string" ? [
            k,
            {
              fingerprint: null,
              states: fromBase64(v),
              stainFingerprint: null,
              stains: new Uint8Array(),
              completed: false,
              restoredAt: null,
              peaceful: false,
              monsterFingerprint: null,
              defeated: new Uint8Array(),
              coloredOnce: new Uint8Array(),
              stockFrom: [],
              tide: newTide()
            }
          ] : [
            k,
            {
              fingerprint: Number.isInteger(v.f) ? v.f : null,
              states: fromBase64(v.s),
              stainFingerprint: Number.isInteger(v.sf) ? v.sf : null,
              stains: v.st ? fromBase64(v.st) : new Uint8Array(),
              completed: v.c === 1,
              restoredAt: v.c === 1 ? Number.isFinite(v.restoredAt) ? Math.max(0, v.restoredAt) : clock : null,
              peaceful: json.version >= 3 && v.p === 1,
              monsterFingerprint: Number.isInteger(v.mf) ? v.mf : null,
              defeated: v.d ? fromBase64(v.d) : new Uint8Array(),
              altarGuards: Number.isInteger(v.ag) && v.ag >= 0 && v.ag <= 7 ? v.ag : 0,
              coloredOnce: v.co ? fromBase64(v.co) : new Uint8Array(),
              stockFrom: Array.isArray(v.sk) ? v.sk.map((t) => Number.isFinite(t) ? t : -1) : [],
              tide: validTide(v.td)
            }
          ]
        )
      ),
      player: (_r = json.player) != null ? _r : null,
      clock,
      calendarOffset: Number.isFinite(json.calendarOffset) ? Math.max(0, json.calendarOffset) : 0,
      harvested: new Map(
        Object.entries((_s = json.harvested) != null ? _s : {}).filter((e) => Number.isFinite(e[1]))
      ),
      growth: validGrowth(json.growth),
      discovered: ((_t = json.discovered) != null ? _t : []).filter((d) => typeof d === "string"),
      marks: ((_u = json.marks) != null ? _u : []).filter(
        (m) => typeof (m == null ? void 0 : m.id) === "string" && [m.x, m.y, m.z].every(Number.isFinite)
      ),
      nextMark: Number.isInteger(json.nextMark) ? json.nextMark : 1,
      infectedAt: validInkSite(json.infectedAt) ? json.infectedAt : null,
      infectedPeople: new Map(Object.entries((_v = json.infectedPeople) != null ? _v : {}).filter(([, v]) => validInkSite(v))),
      inkAreas: new Map(Object.entries((_w = json.inkAreas) != null ? _w : {}).filter(([, v]) => validInkSite(v))),
      hunted: new Map(
        Object.entries((_x = json.hunted) != null ? _x : {}).filter((e) => Number.isFinite(e[1]))
      ),
      cleansed: new Map(
        Object.entries((_y = json.cleansed) != null ? _y : {}).filter((e) => Number.isFinite(e[1]))
      ),
      drop: json.drop && [json.drop.x, json.drop.y, json.drop.z, json.drop.ink].every(Number.isFinite) ? __spreadProps(__spreadValues({}, json.drop), { ink: Math.max(0, Math.floor(json.drop.ink)) }) : null
    };
  }

  // src/world/wilderness/traveller-memory.ts
  function townKind(state, town) {
    var _a2;
    if (peacefulVillage(state, town.cityId)) return "peaceful";
    if ((_a2 = state.cities.get(town.cityId)) == null ? void 0 : _a2.completed) return "restored";
    return savedProgress(state, town.cityId) > 0 ? "recovering" : "infected";
  }
  function landmarks(w, state, j) {
    const p = j.trail.pts;
    const endpoint = (first) => {
      const at = first ? 0 : j.lengths.at(-1);
      if (first && j.trail.id === "spawn") return { at, place: "spawn", kind: "spawn" };
      if (!first && j.trail.id.startsWith("r")) return { at, place: "ruin", kind: "ruin" };
      const k = first ? 0 : p.length - 2;
      const town = w.townAt(p[k], p[k + 1], 8);
      return town ? { at, town, place: town.cityId, kind: townKind(state, town) } : { at, place: "roadside", kind: "roadside" };
    };
    const stops = [endpoint(true), endpoint(false)];
    for (const [index2, b] of j.trail.bridges.entries()) {
      const i = p.findIndex((x, k) => k % 2 === 0 && (x === b.x0 || x === b.x1) && p[k + 1] === b.z);
      if (i >= 0) stops.push({ at: j.lengths[i / 2], place: "bridge:" + index2, kind: "bridge" });
    }
    return stops;
  }
  function rememberedSightings(w, state, j, stops = landmarks(w, state, j)) {
    var _a2, _b;
    const plan = state.travellerLegs.get(j.trail.id);
    const { first, last, leg, begin } = journeyTiming(j, state.clock, plan);
    const since = Math.max(state.travellerMemorySince, (_a2 = plan == null ? void 0 : plan.at) != null ? _a2 : 0);
    const sightings = [...(_b = plan == null ? void 0 : plan.memory) != null ? _b : []];
    if (state.clock < since) return sightings;
    const startAt = travellerPose(j, since, plan).distance;
    for (const stop of stops) {
      if (stop.kind === "roadside" || stop.at < Math.min(first, last) || stop.at > Math.max(first, last))
        continue;
      const arrivals = [];
      if (stop.at !== first) arrivals.push(begin + Math.abs(stop.at - first) / j.speed);
      if (stop.at !== last) arrivals.push(begin + leg + Math.abs(stop.at - last) / j.speed);
      const saved = stop.town && state.cities.get(stop.town.cityId);
      const restored = (saved == null ? void 0 : saved.completed) ? saved.restoredAt : null;
      const record = (limit, before) => {
        let latest = startAt === stop.at && (before ? since < limit : since <= limit) ? since : -Infinity;
        for (const arrival of arrivals) {
          const period = 2 * leg;
          let t = arrival + Math.floor((limit - arrival) / period) * period;
          if (before && t >= limit) t -= period;
          if (t >= since) latest = Math.max(latest, t);
        }
        if (!Number.isFinite(latest)) return;
        const kind = stop.town && stop.kind !== "peaceful" ? restored != null && latest >= restored ? "restored" : "infected" : stop.kind;
        sightings.push({ place: stop.place, kind, at: latest });
      };
      if (restored != null && restored >= since && restored <= state.clock) {
        record(restored, true);
        if (travellerPose(j, restored, plan).distance === stop.at)
          sightings.push({ place: stop.place, kind: "restored", at: restored });
      }
      record(state.clock, false);
    }
    const unique = /* @__PURE__ */ new Map();
    for (const s of sightings) {
      const key = s.place + "/" + s.kind;
      if (!unique.has(key) || unique.get(key).at < s.at) unique.set(key, s);
    }
    const newest = [...unique.values()].sort((a, b) => b.at - a.at);
    const towns = newest.filter((s) => s.place.startsWith("c"));
    return [...towns, ...newest.filter((s) => !s.place.startsWith("c"))].slice(0, MEMORY_LIMIT).sort((a, b) => b.at - a.at);
  }

  // src/world/wilderness/traveller-talk.ts
  function travelOptions(w, state, j) {
    const p = travellerPose(j, state.clock, state.travellerLegs.get(j.trail.id));
    const length = j.lengths.at(-1);
    const stops = landmarks(w, state, j);
    for (const at of [p.distance - 120, p.distance + 120]) {
      if (at > 0 && at < length && stops.every((s) => Math.abs(s.at - at) >= 20))
        stops.push({ at, place: "roadside", kind: "roadside" });
    }
    return stops.filter((s) => Math.abs(s.at - p.distance) >= 10).sort((a, b) => Math.abs(a.at - p.distance) - Math.abs(b.at - p.distance)).slice(0, 10).map((s) => __spreadProps(__spreadValues({}, s), {
      metres: Math.round(Math.abs(s.at - p.distance)),
      onward: (s.at - p.distance) * (p.to - p.from) > 0
    }));
  }
  function acceptStop(j, clock, previous, to) {
    const pose = travellerPose(j, clock, previous);
    const from = pose.distance;
    const origin = from === 0 || from === j.lengths.at(-1) ? from : pose.origin;
    return Number.isFinite(to) && to >= 0 && to <= j.lengths.at(-1) && Math.abs(from - to) >= 5 ? { at: clock, from, to, origin } : null;
  }
  function commitTravellerStop(w, state, j, target) {
    const leg = acceptStop(j, state.clock, state.travellerLegs.get(j.trail.id), target);
    if (leg) {
      leg.memory = rememberedSightings(w, state, j);
      state.travellerLegs.set(j.trail.id, leg);
    }
    return leg;
  }
  function decisionDue(j, clock, plan) {
    return !plan || clock >= plan.at + Math.abs(plan.to - plan.from) / j.speed + j.rest / 2;
  }

  // src/content/arena.ts
  var ARENA = {
    /** Metres from the centre to the wall. */
    radius: 45,
    /** How far from the world's spawn the site may be: far enough that nobody stumbles on it. */
    nearest: 1500,
    farthest: 3e3,
    /** No town within this many metres of the centre (towns are only a few hundred metres apart). */
    townClear: 60,
    /** The ground inside: dry, rolling (this much rise from lowest to highest), not cliffs. */
    minRelief: 2,
    maxRelief: 14,
    /** Most a sample may rise above its neighbour 6 m away. */
    maxStep: 3.5,
    minTrees: 8,
    wall: { segments: 48, height: 4.5, thickness: 0.6 },
    /** Spawn points on a ring this far out. */
    spawnRing: 36,
    spawns: 10,
    hp: 100,
    /** Seconds lying down before getting up again, then seconds nobody can hurt you. */
    respawn: 3,
    grace: 2,
    countdown: 10,
    results: 10,
    /** A round ends at this many kills (a player's in a free-for-all, a team's in teams) or time. */
    killsFfa: 10,
    killsTeams: 20,
    roundSeconds: 300,
    /** Skills are softer against players than against monsters. design: 9.3 */
    slash: { damage: 25, range: 9, halfAngle: 0.35 },
    shield: { amount: 25, seconds: 4 },
    focus: { seconds: 4, multiplier: 1.5 },
    bigShell: { damage: 60, area: 9 },
    field: { radius: 4, seconds: 4, every: 0.5, damage: 9 },
    /** A launcher shell: as systems/tools/weapons.ts fires it (forward, kicked up a little). */
    shell: { speed: 30, lift: 3, gravity: 9, life: 3, probe: 1 },
    /** Server checks: a shot leaves from within this many metres of where the shooter was, and
     * may be rewound at most this far to where its target was on the shooter's screen. */
    reach: 4,
    rewind: 0.2,
    /** Remote players are drawn this far in the past (systems/net/remote-players.ts). */
    viewDelay: 0.1
  };
  var ARENA_COVER = [
    // the middle: a low cross to fight over
    { dx: 0, dz: 0, w: 6, d: 1.2, h: 1.2 },
    { dx: 0, dz: 0, w: 1.2, d: 6, h: 1.2 },
    // an inner ring of corners
    ...[
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1]
    ].flatMap(([sx, sz]) => [
      { dx: sx * 14, dz: sz * 14, w: 5, d: 1, h: 2.2 },
      { dx: sx * 16, dz: sz * 12, w: 1, d: 4, h: 2.2 }
    ]),
    // long walls further out, to run behind
    { dx: 0, dz: 27, w: 9, d: 1.2, h: 2.6 },
    { dx: 0, dz: -27, w: 9, d: 1.2, h: 2.6 },
    { dx: 27, dz: 0, w: 1.2, d: 9, h: 2.6 },
    { dx: -27, dz: 0, w: 1.2, d: 9, h: 2.6 },
    // a few lone blocks to crouch behind
    { dx: 22, dz: 20, w: 2, d: 2, h: 1.4 },
    { dx: -22, dz: -20, w: 2, d: 2, h: 1.4 },
    { dx: -20, dz: 22, w: 2, d: 2, h: 1.4 },
    { dx: 20, dz: -22, w: 2, d: 2, h: 1.4 }
  ];

  // src/world/city/blocks.ts
  function studioStockSince(ratio, recorded = -1) {
    if (recorded >= 0) return recorded;
    return ratio >= TUNING.blocks.thrivingAt ? 0 : -1;
  }
  function blockState(ratio, stockFrom = -1) {
    const b = TUNING.blocks;
    if (ratio >= b.coloredAt) return studioStockSince(ratio, stockFrom) >= 0 ? "thriving" : "colored";
    if (ratio >= b.clearedAt) return "cleared";
    return "drained";
  }
  function blockStates(states, surfaces, side, stockFrom = []) {
    return Array.from(
      { length: side * side },
      (_, c) => blockState(coloredRatio(states, surfaces, c), stockFrom[c])
    );
  }

  // src/world/paint/release.ts
  function releaseAround(surfaces, states, x, z, rule) {
    const r2 = rule.radius * rule.radius;
    const near2 = [];
    surfaces.forEach((s, i) => {
      if (states[i] !== DRAINED) return;
      const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d2 <= r2) near2.push({ i, d2 });
    });
    near2.sort((a, b) => a.d2 - b.d2 || a.i - b.i);
    return near2.slice(0, rule.max).map((n) => n.i);
  }

  // src/world/wilderness/landmarks.ts
  var SIZE2 = TUNING.world.chunkSize;
  var SPRING_GRID = 5;
  var SPRING_CHANCE = 0.5;
  var LOOKOUT_GRID = 3;
  var LOOKOUT_HEIGHT = 15;
  var FLAGS = [color("red"), color("blue"), color("yellow"), color("orange")];
  function clear(w, x, z, room) {
    if (w.townAt(x, z, room + 20)) return false;
    const r = ruinInCell(w, ruinCellOf(Math.floor(x / SIZE2)), ruinCellOf(Math.floor(z / SIZE2)));
    if (r && Math.hypot(r.x - x, r.z - z) < room + 20) return false;
    return pathsOf(w).edgeDistance(x, z) > room;
  }
  function springInCell(w, gx, gz) {
    return finishSteps(cached(springs, w, `${gx},${gz}`, () => springSteps(w, gx, gz)));
  }
  function* springSteps(w, gx, gz) {
    const h0 = hashAt(w.seed, "spring", gx, gz);
    if (unit(h0) >= SPRING_CHANCE) return null;
    const span = SPRING_GRID * SIZE2;
    for (let a = 0; a < 24; a++) {
      const h = hashAt(w.seed, "spring-spot", gx, gz, a);
      const x = gx * span + 30 + unit(h) * (span - 60);
      const z = gz * span + 30 + unit(hashInts(h, 1)) * (span - 60);
      if (Math.hypot(x - SIZE2 / 2, z - SIZE2 / 2) < 150) continue;
      if (w.climate(x, z).relief < -0.15) continue;
      yield* __yieldStar(pathsOf(w).prepareGround(x - 12, z - 12, x + 12, z + 12));
      const y = w.heightAt(x, z);
      if (y < WATER_LEVEL + 2.5) continue;
      const r = 2.6 + unit(hashInts(h, 2)) * 1.6;
      let lo = y;
      let hi = y;
      for (let k = 0; k < 8; k++) {
        const g = w.heightAt(
          x + Math.cos(k * Math.PI / 4) * (r + 2),
          z + Math.sin(k * Math.PI / 4) * (r + 2)
        );
        lo = Math.min(lo, g);
        hi = Math.max(hi, g);
      }
      if (hi - lo > 1.2) continue;
      if (!clear(w, x, z, r + 6)) continue;
      return { id: `s${gx}_${gz}`, x, z, y, r, seed: h };
    }
    return null;
  }
  function lookoutInCell(w, gx, gz) {
    return finishSteps(cached(lookouts, w, `${gx},${gz}`, () => lookoutSteps(w, gx, gz)));
  }
  function* lookoutSteps(w, gx, gz) {
    const span = LOOKOUT_GRID * SIZE2;
    const x0 = gx * span;
    const z0 = gz * span;
    const paths = pathsOf(w);
    yield* __yieldStar(paths.prepareGround(x0 + 4, z0 + 4, x0 + span, z0 + span));
    let bx = 0;
    let bz = 0;
    let by = -Infinity;
    for (let i = 1; i < 16; i++) {
      for (let k = 1; k < 16; k++) {
        const x = x0 + i / 16 * span;
        const z = z0 + k / 16 * span;
        const y = w.heightAt(x, z);
        if (y > by) [bx, bz, by] = [x, z, y];
      }
      yield;
    }
    for (let i = -6; i <= 6; i++) {
      for (let k = -6; k <= 6; k++) {
        const x = bx + i * 4;
        const z = bz + k * 4;
        if (x < x0 + 8 || z < z0 + 8 || x > x0 + span - 8 || z > z0 + span - 8) continue;
        const y = w.heightAt(x, z);
        if (y > by) [bx, bz, by] = [x, z, y];
      }
      yield;
    }
    for (let step = 0; step < 40; step++) {
      let moved = false;
      for (const d of [3, 8, 16])
        for (let k = 0; k < 8; k++) {
          const x = bx + Math.cos(k * Math.PI / 4) * d;
          const z = bz + Math.sin(k * Math.PI / 4) * d;
          yield* __yieldStar(paths.prepareGround(x - 4, z - 4, x + 4, z + 4));
          const y = w.heightAt(x, z);
          if (y > by + 0.05) {
            [bx, bz, by] = [x, z, y];
            moved = true;
          }
        }
      if (!moved) break;
    }
    if (bx < x0 || bz < z0 || bx >= x0 + span || bz >= z0 + span) return null;
    if (by < LOOKOUT_HEIGHT) return null;
    if (!clear(w, bx, bz, 4)) return null;
    const h = hashAt(w.seed, "lookout", gx, gz);
    return { id: `l${gx}_${gz}`, x: bx, z: bz, y: by, flag: FLAGS[h % FLAGS.length], seed: h };
  }
  var springs = /* @__PURE__ */ new WeakMap();
  var lookouts = /* @__PURE__ */ new WeakMap();
  function cached(store, w, key, make) {
    let m = store.get(w);
    if (!m) store.set(w, m = new StepCache());
    return m.prepare(key, make);
  }
  function* prepareLandmarks(w, cx, cz) {
    const sx = Math.floor(cx / SPRING_GRID), sz = Math.floor(cz / SPRING_GRID);
    yield* __yieldStar(cached(springs, w, `${sx},${sz}`, () => springSteps(w, sx, sz)));
    const lx = Math.floor(cx / LOOKOUT_GRID), lz = Math.floor(cz / LOOKOUT_GRID);
    yield* __yieldStar(cached(lookouts, w, `${lx},${lz}`, () => lookoutSteps(w, lx, lz)));
  }
  var cellOf = (v, grid) => Math.floor(v / (grid * SIZE2));
  function springsInChunk(w, cx, cz) {
    const gx = Math.floor(cx / SPRING_GRID);
    const gz = Math.floor(cz / SPRING_GRID);
    const s = springInCell(w, gx, gz);
    return s && Math.floor(s.x / SIZE2) === cx && Math.floor(s.z / SIZE2) === cz ? [s] : [];
  }
  function lookoutsInChunk(w, cx, cz) {
    const gx = Math.floor(cx / LOOKOUT_GRID);
    const gz = Math.floor(cz / LOOKOUT_GRID);
    const l = lookoutInCell(w, gx, gz);
    return l && Math.floor(l.x / SIZE2) === cx && Math.floor(l.z / SIZE2) === cz ? [l] : [];
  }
  function springsNear(w, x, z, reach) {
    return finishSteps(springsNearSteps(w, x, z, reach));
  }
  function* springsNearSteps(w, x, z, reach) {
    const out = [];
    for (let gx = cellOf(x - reach, SPRING_GRID); gx <= cellOf(x + reach, SPRING_GRID); gx++)
      for (let gz = cellOf(z - reach, SPRING_GRID); gz <= cellOf(z + reach, SPRING_GRID); gz++) {
        const s = yield* __yieldStar(cached(springs, w, `${gx},${gz}`, () => springSteps(w, gx, gz)));
        if (s && Math.hypot(s.x - x, s.z - z) <= reach) out.push(s);
      }
    return out.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  }

  // src/content/pigment-sources.ts
  var PIGMENT_SOURCES = [
    {
      key: "flowers",
      name: "\u82B1\u7530",
      biomes: ["grassland"],
      placement: "land",
      colors: [color("yellow"), color("orange"), color("pink"), color("red")],
      amount: 3,
      ink: 2,
      perChunk: 0.9,
      base: color("grass")
    },
    {
      key: "berries",
      name: "\u6D46\u679C\u4E1B",
      biomes: ["forest"],
      placement: "land",
      colors: [color("purple"), color("red"), color("blue")],
      amount: 3,
      ink: 3,
      perChunk: 0.8,
      base: color("forest")
    },
    {
      key: "ore",
      name: "\u77FF\u8109",
      biomes: ["mountain"],
      placement: "high",
      colors: [color("teal"), color("brown"), color("sky"), color("charcoal")],
      amount: 4,
      ink: 4,
      perChunk: 0.8,
      base: color("rock")
    },
    {
      key: "reeds",
      name: "\u82A6\u82C7\u4E1B",
      biomes: ["grassland", "forest", "water"],
      placement: "shore",
      colors: [color("green"), color("teal"), color("sky")],
      amount: 3,
      ink: 2,
      perChunk: 0.6,
      base: color("sand")
    },
    {
      key: "shells",
      name: "\u6247\u8D1D\u6EE9",
      biomes: ["grassland", "forest", "water"],
      placement: "shallows",
      colors: [color("cream")],
      amount: 2,
      ink: 1,
      perChunk: 0.38,
      base: color("sand")
    }
  ];

  // src/world/wilderness/sources.ts
  var ATTEMPTS2 = 16;
  function fits(placement, h) {
    switch (placement) {
      case "land":
        return h > WATER_LEVEL + 0.75;
      case "shore":
        return h >= WATER_LEVEL + 0.25 && h <= WATER_LEVEL + 1.75;
      case "shallows":
        return h >= WATER_LEVEL - 0.55 && h <= WATER_LEVEL;
      case "high":
        return h >= 8;
    }
  }
  function sourcesInChunk(w, cx, cz) {
    const size = TUNING.world.chunkSize;
    const cell = TUNING.world.cellSize;
    const n = size / cell;
    const out = [];
    PIGMENT_SOURCES.forEach((def, kind) => {
      const roll2 = hashAt(w.seed, "source", cx, cz, kind);
      const starterShells = def.key === "shells" && cx === 0 && cz === 0;
      if (!starterShells && unit(roll2) >= def.perChunk) return;
      for (let attempt = 0; attempt < (starterShells ? n * n : ATTEMPTS2); attempt++) {
        const h = hashAt(w.seed, "source-cell", cx, cz, kind, attempt);
        const cellIndex = starterShells ? (roll2 % (n * n) + attempt) % (n * n) : h;
        const ix = cellIndex % n;
        const iz = starterShells ? Math.floor(cellIndex / n) : (h >>> 8) % n;
        const x = cx * size + (ix + 0.5) * cell;
        const z = cz * size + (iz + 0.5) * cell;
        const biome = BIOMES[w.biomeAt(x, z)].key;
        if (!def.biomes.includes(biome)) continue;
        const y = w.heightAt(x, z);
        if (!fits(def.placement, y)) continue;
        if (Math.hypot(x, z) < 12) continue;
        if (w.townAt(x, z, TUNING.structures.townClearance)) continue;
        out.push({
          id: `${cx},${cz}:${kind}`,
          kind,
          x,
          y,
          z,
          color: def.colors[(h >>> 16) % def.colors.length],
          amount: def.amount,
          ink: def.ink
        });
        return;
      }
    });
    return out;
  }
  function sourceById(w, id) {
    var _a2;
    const m = /^(-?\d+),(-?\d+):(\d+)$/.exec(id);
    if (!m) return null;
    return (_a2 = sourcesInChunk(w, Number(m[1]), Number(m[2])).find((s) => s.id === id)) != null ? _a2 : null;
  }

  // src/world/wilderness/ink-wells.ts
  var GUARD_BASE = 50;
  var cache = /* @__PURE__ */ new WeakMap();
  function near9(cx, cz, of) {
    const out = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) out.push(...of(cx + dx, cz + dz));
    return out;
  }
  function inkWellInChunk(w, cx, cz) {
    let m = cache.get(w);
    if (!m) cache.set(w, m = /* @__PURE__ */ new Map());
    const key = `${cx},${cz}`;
    if (!m.has(key)) m.set(key, findWell(w, cx, cz));
    return m.get(key);
  }
  function findWell(w, cx, cz) {
    const W2 = TUNING.combat.wells;
    const h0 = hashAt(w.seed, "ink-well", cx, cz);
    if (unit(h0) >= W2.chance) return null;
    const size = TUNING.world.chunkSize;
    for (let a = 0; a < 8; a++) {
      const h = hashAt(w.seed, "ink-well-spot", cx, cz, a);
      const x = cx * size + 16 + unit(h) * (size - 32);
      const z = cz * size + 16 + unit(hashInts(h, 1)) * (size - 32);
      const wall = Math.min(
        ...w.entrancesNear(x, z, 1).map(
          (e) => Math.hypot(
            Math.max(Math.abs(x - e.x) - e.size / 2, 0),
            Math.max(Math.abs(z - e.z) - e.size / 2, 0)
          )
        )
      );
      if (!(wall > 30 && wall < TUNING.drain.innerRadius + 50)) continue;
      const y = w.terrainHeightAt(x, z);
      if (y < WATER_LEVEL + 1) continue;
      if (Math.hypot(w.terrainHeightAt(x + 4, z) - y, w.terrainHeightAt(x, z + 4) - y) > 1.5) continue;
      if (pathsOf(w).edgeDistance(x, z) < 6) continue;
      if (near9(cx, cz, (ax, az) => ruinsInChunk(w, ax, az)).some((r) => Math.hypot(r.x - x, r.z - z) < 25))
        continue;
      if (sourcesInChunk(w, cx, cz).some((s) => Math.hypot(s.x - x, s.z - z) < 10)) continue;
      if (springsNear(w, x, z, 20).length) continue;
      return { id: `w${cx}_${cz}`, cx, cz, x, y: w.heightAt(x, z), z, seed: h };
    }
    return null;
  }
  function inkWellById(w, id) {
    const m = /^w(-?\d+)_(-?\d+)$/.exec(id);
    if (!m) return null;
    const well = inkWellInChunk(w, Number(m[1]), Number(m[2]));
    return (well == null ? void 0 : well.id) === id ? well : null;
  }
  function wellOfGuard(monster) {
    const m = /^(-?\d+),(-?\d+):(\d+)$/.exec(monster);
    return m && Number(m[3]) >= GUARD_BASE && Number(m[3]) < 100 ? `w${m[1]}_${m[2]}` : null;
  }
  var wellSeeping = (saturation) => saturation < TUNING.combat.wild.greyBelow;
  function wellGuards(w, well, saturation, cleansed = false) {
    if (cleansed || !wellSeeping(saturation)) return [];
    const [lo, hi] = TUNING.combat.wells.guards;
    const count = lo + Math.floor(unit(hashInts(well.seed, 7)) * (hi - lo + 1));
    const out = [];
    for (let k = 0; k < count; k++) {
      const a = (k + unit(hashInts(well.seed, 10 + k)) * 0.5) / count * Math.PI * 2;
      const r = 5 + 3 * unit(hashInts(well.seed, 20 + k));
      let x = well.x + Math.cos(a) * r;
      let z = well.z + Math.sin(a) * r;
      if (w.heightAt(x, z) <= WATER_LEVEL + 0.5)
        [x, z] = [well.x + Math.cos(a) * 2.5, well.z + Math.sin(a) * 2.5];
      const kind = unit(hashInts(well.seed, 30 + k));
      const type = kind < 0.4 ? enemyIndex("spitter") : kind < 0.7 ? enemyIndex("weasel") : enemyIndex("blot");
      out.push({ id: `${well.cx},${well.cz}:${GUARD_BASE + k}`, type, x, y: w.heightAt(x, z), z });
    }
    return out;
  }

  // src/world/city/liberation.ts
  var ALTAR_GUARDS = [enemyIndex("giant"), enemyIndex("blot"), enemyIndex("spitter")];
  var ALTAR_CAPTURED = (1 << ALTAR_GUARDS.length) - 1;
  function liberation(skel, saved) {
    var _a2;
    const total = skel.monsters.length;
    let defeated = 0;
    for (let i = 0; i < total; i++) if (saved.defeated[i] === 1) defeated++;
    const required = Math.ceil(total / 2);
    const guards = (_a2 = saved.altarGuards) != null ? _a2 : 0;
    const remaining = ALTAR_GUARDS.filter((_, i) => !(guards & 1 << i)).length;
    return {
      total,
      defeated,
      required,
      unlocked: defeated >= required,
      remaining,
      captured: guards === ALTAR_CAPTURED
    };
  }

  // src/world/patch.ts
  var fail = (reason) => ({ ok: false, reason });
  var OK = { ok: true };
  function markThriving(state, city, skel, states, chunk) {
    var _a2;
    const saved = state.cities.get(city);
    if (((_a2 = saved.stockFrom[chunk]) != null ? _a2 : -1) >= 0) return;
    if (coloredRatio(states, skel.surfaces, chunk) < TUNING.blocks.thrivingAt) return;
    saved.stockFrom[chunk] = state.clock;
  }
  function blockMilestones(state, city, surfaces, states, coloredOnce, chunk, reward = true) {
    var _a2;
    if ((_a2 = state.cities.get(city)) == null ? void 0 : _a2.peaceful) return;
    if (coloredOnce[chunk] || coloredRatio(states, surfaces, chunk) < TUNING.blocks.coloredAt) return;
    coloredOnce[chunk] = 1;
    if (!reward) return;
    const g = state.growth;
    g.xp += XP.blockColored;
    milestone(g, "first-block", MILESTONES.firstBlockColored);
    const count = coloredOnce.reduce((a, b) => a + b, 0);
    if (MILESTONES.cityBlocks.includes(count))
      milestone(g, `city:${city}:blocks:${count}`, MILESTONES.cityBlocksPoint);
  }
  function release(state, city, skel, states, coloredOnce, x, z, rule, reward = true) {
    const freed = releaseAround(skel.surfaces, states, x, z, rule);
    const chunks = /* @__PURE__ */ new Set();
    for (const i of freed) {
      states[i] = ORIGINAL;
      if (reward) state.growth.xp += XP.surface;
      chunks.add(skel.surfaces[i].chunk);
    }
    for (const c of chunks) {
      blockMilestones(state, city, skel.surfaces, states, coloredOnce, c, reward);
      markThriving(state, city, skel, states, c);
    }
  }
  function applyPatch(state, patch, ctx) {
    const r = applyRules(state, patch, ctx);
    if (r.ok) unlockWeapons(state);
    return r;
  }
  function unlockWeapons(state) {
    const restored = [...state.cities.values()].filter((c) => c.completed).length;
    const level = levelOf(state.growth.xp);
    const fresh = [];
    for (const w of WEAPONS) {
      if (state.inventory.weapons.includes(w.key)) continue;
      const u = w.unlock;
      const met = u.kind === "start" || u.kind === "milestone" && state.growth.milestones.includes(u.id) || u.kind === "level" && level >= u.level || u.kind === "restored" && restored >= u.count;
      if (met) fresh.push(w.key);
    }
    state.inventory.weapons.push(...fresh);
    return fresh;
  }
  function applyRules(state, patch, ctx) {
    var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q;
    const inv = state.inventory;
    switch (patch.kind) {
      case "grant": {
        for (const c of (_a2 = patch.unlock) != null ? _a2 : []) if (!((_b = PALETTE[c]) == null ? void 0 : _b.paintable)) return fail(`\u672A\u77E5\u989C\u8272 ${c}`);
        if (patch.generic) inv.generic = Math.max(0, inv.generic + patch.generic);
        if (patch.ink) inv.ink = Math.max(0, inv.ink + patch.ink);
        for (const c of (_c = patch.unlock) != null ? _c : []) if (!state.unlocked.includes(c)) state.unlocked.push(c);
        return OK;
      }
      case "upgrade": {
        const next = BRUSH_TIERS[inv.brushTier + 1];
        if (!(next == null ? void 0 : next.cost)) return fail("\u7B14\u5237\u5DF2\u7ECF\u662F\u6700\u597D\u7684\u4E86");
        if (inv.generic < next.cost.generic) return fail(`\u989C\u6599\u4E0D\u591F\uFF08\u9700\u8981 ${next.cost.generic}\uFF09`);
        if (inv.ink < next.cost.ink) return fail(`\u58A8\u4E0D\u591F\uFF08\u9700\u8981 ${next.cost.ink}\uFF09`);
        inv.generic -= next.cost.generic;
        inv.ink -= next.cost.ink;
        inv.brushTier += 1;
        return OK;
      }
      case "hunt": {
        const m = ctx.wildMonsterOf(patch.monster);
        if (!m) return fail("\u8FD9\u91CC\u6CA1\u6709\u58A8\u602A");
        if (!wildMonsterBack(state, m.id)) return fail("\u5DF2\u7ECF\u6253\u8D25\u4E86");
        const kept = wellOfGuard(m.id);
        if (kept && state.cleansed.has(kept)) return fail("\u8FD9\u91CC\u6CA1\u6709\u58A8\u602A");
        state.hunted.set(m.id, state.clock);
        if (!patch.npc) inv.ink += (_e = (_d = ENEMIES[m.type]) == null ? void 0 : _d.ink) != null ? _e : 0;
        if (!patch.npc) state.growth.xp += XP.monster;
        return OK;
      }
      case "cleanse": {
        const found2 = (_f = ctx.inkWellOf) == null ? void 0 : _f.call(ctx, patch.well);
        if (!found2) return fail("\u8FD9\u91CC\u6CA1\u6709\u58A8\u6CC9");
        if (state.cleansed.has(found2.well.id)) return fail("\u5DF2\u7ECF\u51C0\u5316\u8FC7\u4E86");
        if (!found2.seeping) return fail("\u58A8\u6CC9\u5DF2\u7ECF\u5E72\u4E86");
        const standing = found2.guards.filter((g) => wildMonsterBack(state, g.id)).length;
        if (standing) return fail(`\u8FD8\u6709 ${standing} \u53EA\u58A8\u602A\u5B88\u7740\u58A8\u6CC9`);
        const W2 = TUNING.combat.wells;
        state.cleansed.set(found2.well.id, state.clock);
        inv.ink += W2.ink;
        inv.generic += W2.pigment;
        state.growth.xp += XP.wellCleansed;
        return OK;
      }
      case "infectNpc": {
        if (!state.infectedPeople.has(patch.person)) state.infectedPeople.set(patch.person, patch.site);
        return OK;
      }
      case "defeatInfected": {
        const person = state.infectedPeople.get(patch.person);
        if (!person) return fail("\u6CA1\u6709\u8FD9\u540D\u611F\u67D3\u8005");
        if (person.defeated) return fail("\u5DF2\u7ECF\u6253\u8D25\u4E86");
        state.infectedPeople.set(patch.person, __spreadProps(__spreadValues({}, person), { defeated: true }));
        return OK;
      }
      case "overrun": {
        if (patch.person !== "player" && ((_g = state.infectedPeople.get(patch.person)) == null ? void 0 : _g.defeated))
          return fail("\u611F\u67D3\u6E90\u5DF2\u88AB\u6253\u8D25");
        const site = patch.person === "player" ? state.infectedAt : state.infectedPeople.get(patch.person);
        if (!site || !sameScene(site.scene, patch.site.scene) || site.x !== patch.site.x || site.z !== patch.site.z) return fail("\u6B64\u5904\u6CA1\u6709\u611F\u67D3\u6E90");
        state.inkAreas.set(areaKey(site), site);
        return OK;
      }
      case "death": {
        if (patch.inkMonster) state.infectedAt = { scene: patch.scene, x: patch.x, y: patch.y, z: patch.z };
        const lost = Math.floor(inv.ink * TUNING.combat.deathInkShare);
        inv.ink -= lost;
        state.drop = { scene: patch.scene, x: patch.x, y: patch.y, z: patch.z, ink: lost };
        return OK;
      }
      case "recover": {
        if (!state.drop) return fail("\u6CA1\u6709\u6389\u843D\u7684\u58A8");
        inv.ink += state.drop.ink;
        state.drop = null;
        return OK;
      }
      case "spend": {
        const g = Math.max(0, (_h = patch.generic) != null ? _h : 0);
        const k = Math.max(0, (_i = patch.ink) != null ? _i : 0);
        if (inv.generic < g) return fail("\u989C\u6599\u4E0D\u8DB3");
        if (inv.ink < k) return fail("\u58A8\u4E0D\u8DB3");
        inv.generic -= g;
        inv.ink -= k;
        return OK;
      }
      case "discover": {
        const r = ctx.ruinOf(patch.ruin);
        if (!r) return fail("\u8FD9\u91CC\u6CA1\u6709\u9057\u8FF9");
        if (state.discovered.includes(r.id)) return fail("\u5DF2\u7ECF\u627E\u5230\u8FC7\u4E86");
        state.discovered.push(r.id);
        state.growth.xp += XP.ruinFound;
        if (!state.unlocked.includes(r.color)) state.unlocked.push(r.color);
        else inv.generic += TUNING.structures.ruinPigment;
        if (PAINTABLE.every((c) => state.unlocked.includes(c)))
          milestone(state.growth, "all-colors", MILESTONES.allColors);
        return OK;
      }
      case "mark": {
        if (state.marks.length >= TUNING.marks.max)
          return fail(`\u6700\u591A ${TUNING.marks.max} \u4E2A\u58A8\u8FF9\u6807\u8BB0\uFF08\u53F3\u952E\u6536\u56DE\u4E00\u4E2A\uFF09`);
        if (inv.generic < TUNING.marks.cost) return fail(`\u989C\u6599\u4E0D\u591F\uFF08\u8981 ${TUNING.marks.cost}\uFF09`);
        inv.generic -= TUNING.marks.cost;
        state.marks.push({ id: `m${state.nextMark++}`, x: patch.x, y: patch.y, z: patch.z });
        return OK;
      }
      case "unmark": {
        const i = state.marks.findIndex((m) => m.id === patch.id);
        if (i < 0) return fail("\u6CA1\u6709\u8FD9\u4E2A\u6807\u8BB0");
        state.marks.splice(i, 1);
        return OK;
      }
      case "assign": {
        if (!ATTRIBUTES.some((a) => a.key === patch.attr)) return fail("\u6CA1\u6709\u8FD9\u4E2A\u5C5E\u6027");
        if (state.growth.points < 1) return fail("\u6CA1\u6709\u5C5E\u6027\u70B9");
        state.growth.points -= 1;
        state.growth.attrs[patch.attr] += 1;
        return OK;
      }
      case "harvest": {
        const src = ctx.sourceOf(patch.source);
        if (!src) return fail("\u8FD9\u91CC\u6CA1\u6709\u989C\u6599");
        if (!sourceReady(state, src.id)) return fail("\u8FD8\u6CA1\u957F\u56DE\u6765");
        state.harvested.set(src.id, state.clock);
        inv.generic += src.amount;
        inv.ink += src.ink;
        if (((_j = PALETTE[src.color]) == null ? void 0 : _j.paintable) && !state.unlocked.includes(src.color))
          state.unlocked.push(src.color);
        if (PAINTABLE.every((c) => state.unlocked.includes(c)))
          milestone(state.growth, "all-colors", MILESTONES.allColors);
        return OK;
      }
      default:
        break;
    }
    const skel = ctx.cityOf(patch.city);
    if (!skel) return fail("\u57CE\u5E02\u4E0D\u5B58\u5728");
    const { states, stains, defeated, coloredOnce } = cityStates(state, patch.city, skel);
    if (state.cities.get(patch.city).peaceful && (patch.kind === "complete" || patch.kind === "drain" || patch.kind === "tideHeld" || patch.kind === "restoreAltar" || patch.kind === "defeatAltarGuard"))
      return fail("\u8FD9\u5EA7\u6751\u5E84\u672A\u53D7\u6C61\u67D3\uFF0C\u65E0\u9700\u4FEE\u590D\u6216\u62B5\u5FA1\u58A8\u6F6E");
    switch (patch.kind) {
      case "defeatAltarGuard": {
        const saved = state.cities.get(patch.city);
        if (saved.completed) return fail("\u6751\u5E84\u5DF2\u7ECF\u6062\u590D");
        if (!((_k = ctx.altarOf) == null ? void 0 : _k.call(ctx, patch.city))) return fail("\u8FD9\u91CC\u6CA1\u6709\u796D\u575B\u5927\u672C\u8425");
        const type = ALTAR_GUARDS[patch.guard];
        if (!Number.isInteger(patch.guard) || type === void 0) return fail("\u6CA1\u6709\u8FD9\u540D\u9A7B\u5B88\u58A8\u602A");
        if (!liberation(skel, saved).unlocked) return fail("\u5148\u6E05\u9664\u81F3\u5C11 50% \u7684\u6751\u5E84\u58A8\u602A");
        const bit = 1 << patch.guard;
        if (((_l = saved.altarGuards) != null ? _l : 0) & bit) return fail("\u5DF2\u7ECF\u6253\u8D25\u4E86");
        saved.altarGuards = ((_m = saved.altarGuards) != null ? _m : 0) | bit;
        if (!patch.npc) {
          inv.ink += ENEMIES[type].ink;
          state.growth.xp += XP.monster;
        }
        return OK;
      }
      case "restoreAltar":
      case "complete": {
        const saved = state.cities.get(patch.city);
        const restored = `city:${patch.city}:restored`;
        if (state.growth.milestones.includes(restored)) return fail("\u8FD9\u5EA7\u57CE\u5DF2\u7ECF\u6062\u590D\u4E86");
        if (patch.kind === "restoreAltar") {
          if (saved.completed) return fail("\u796D\u575B\u5DF2\u7ECF\u6062\u590D");
          if (!((_n = ctx.altarOf) == null ? void 0 : _n.call(ctx, patch.city))) return fail("\u8FD9\u91CC\u6CA1\u6709\u796D\u575B\u5927\u672C\u8425");
          const progress = liberation(skel, saved);
          if (!progress.unlocked) return fail("\u5148\u6E05\u9664\u81F3\u5C11 50% \u7684\u6751\u5E84\u58A8\u602A");
          if (!progress.captured) return fail("\u5148\u51FB\u8D25\u796D\u575B\u5927\u672C\u8425\u7684\u5168\u90E8\u9A7B\u5B88\u58A8\u602A");
          for (let i = 0; i < states.length; i++) if (states[i] === DRAINED) states[i] = ORIGINAL;
          defeated.fill(1);
          stains.fill(1);
          coloredOnce.fill(1);
          for (let i = 0; i < saved.stockFrom.length; i++) if (saved.stockFrom[i] < 0) saved.stockFrom[i] = state.clock;
          saved.tide.wave = null;
        } else if (!saved.completed) {
          const blocks = blockStates(states, skel.surfaces, skel.chunks);
          if (!blocks.every((b) => b === "colored" || b === "thriving")) return fail("\u8FD8\u6709\u8857\u533A\u6CA1\u6709\u989C\u8272");
        }
        (_o = saved.restoredAt) != null ? _o : saved.restoredAt = state.clock;
        saved.completed = true;
        inv.generic += TUNING.city.completeReward.generic;
        inv.ink += TUNING.city.completeReward.ink;
        state.growth.xp += XP.cityRestored;
        milestone(state.growth, restored, MILESTONES.cityRestored);
        inv.glider = true;
        return OK;
      }
      case "tideHeld": {
        inv.generic += TUNING.tide.reward.generic;
        inv.ink += TUNING.tide.reward.ink;
        state.growth.xp += XP.tideHeld;
        milestone(state.growth, "first-tide", MILESTONES.firstTideHeld);
        return OK;
      }
      case "defeat": {
        const m = skel.monsters[patch.monster];
        if (!m) return fail("\u6CA1\u6709\u8FD9\u53EA\u58A8\u602A");
        if (defeated[patch.monster]) return fail("\u5DF2\u7ECF\u6253\u8D25\u4E86");
        defeated[patch.monster] = 1;
        if (!patch.npc) inv.ink += (_q = (_p = ENEMIES[m.type]) == null ? void 0 : _p.ink) != null ? _q : 0;
        if (!patch.npc) state.growth.xp += XP.monster;
        release(state, patch.city, skel, states, coloredOnce, m.x, m.z, TUNING.release.monster, !patch.npc);
        return OK;
      }
      case "collectStock": {
        const s = skel.studios[patch.studio];
        if (!s) return fail("\u753B\u5BA4\u4E0D\u5B58\u5728");
        const saved = state.cities.get(patch.city);
        const from = studioStockSince(coloredRatio(states, skel.surfaces, s.chunk), saved.stockFrom[s.chunk]);
        if (from < 0) return fail("\u8FD9\u4E2A\u8857\u533A\u8FD8\u6CA1\u6709\u7E41\u8363");
        const period = TUNING.economy.studioStockSeconds;
        const made = Math.min(TUNING.economy.studioStockCap, Math.floor((state.clock - from) / period));
        if (made < 1) return fail("\u8FD8\u6CA1\u6709\u65B0\u7684\u989C\u6599");
        inv.generic += made;
        saved.stockFrom[s.chunk] = made >= TUNING.economy.studioStockCap ? state.clock : from + made * period;
        return OK;
      }
      case "collect": {
        if (!skel.stains[patch.stain]) return fail("\u58A8\u6E0D\u4E0D\u5B58\u5728");
        if (stains[patch.stain]) return fail("\u5DF2\u7ECF\u64E6\u6389\u4E86");
        stains[patch.stain] = 1;
        inv.ink += TUNING.economy.inkPerStain;
        return OK;
      }
      case "refine": {
        if (!skel.studios[patch.studio]) return fail("\u753B\u5BA4\u4E0D\u5B58\u5728");
        if (!studioOpen(skel, states, patch.studio)) return fail("\u753B\u5BA4\u8FD8\u6CA1\u5F00\u95E8");
        const made = Math.floor(inv.ink / TUNING.economy.inkPerGeneric);
        if (made === 0) return fail(`\u58A8\u4E0D\u591F\uFF08\u9700\u8981 ${TUNING.economy.inkPerGeneric}\uFF09`);
        inv.ink -= made * TUNING.economy.inkPerGeneric;
        inv.generic += made;
        return OK;
      }
      default:
        break;
    }
    const info = skel.surfaces[patch.surface];
    if (!info) return fail("\u8868\u9762\u4E0D\u5B58\u5728");
    if (patch.kind !== "drain" && standingMonsters(skel, defeated, info.chunk).length)
      return fail("\u8FD9\u4E2A\u8857\u533A\u8FD8\u6709\u58A8\u602A\uFF0C\u5148\u8D76\u8D70\u5B83\u4EEC");
    const current = states[patch.surface];
    switch (patch.kind) {
      case "drain":
        if (state.cities.get(patch.city).completed) return fail("\u6751\u5E84\u5DF2\u7ECF\u6062\u590D\uFF0C\u4E0D\u518D\u5931\u8272");
        states[patch.surface] = DRAINED;
        return OK;
      case "restore": {
        if (current === ORIGINAL) return fail("\u5DF2\u7ECF\u662F\u539F\u8272");
        const cost = surfaceCost(info);
        if (inv.generic < cost) return fail("\u989C\u6599\u4E0D\u8DB3");
        inv.generic -= cost;
        states[patch.surface] = ORIGINAL;
        if (current === DRAINED) state.growth.xp += XP.surface;
        blockMilestones(state, patch.city, skel.surfaces, states, coloredOnce, info.chunk);
        if (current === DRAINED) markThriving(state, patch.city, skel, states, info.chunk);
        return OK;
      }
      case "paint": {
        const def = PALETTE[patch.color];
        if (!(def == null ? void 0 : def.paintable)) return fail("\u8FD9\u79CD\u989C\u8272\u4E0D\u80FD\u6D82\u9E26");
        if (!state.unlocked.includes(patch.color)) return fail("\u8FD8\u6CA1\u6709\u8FD9\u652F\u8721\u7B14");
        if (current === graffiti(patch.color)) return fail("\u5DF2\u7ECF\u662F\u8FD9\u4E2A\u989C\u8272");
        const cost = surfaceCost(info);
        if (inv.generic < cost) return fail("\u989C\u6599\u4E0D\u8DB3");
        inv.generic -= cost;
        states[patch.surface] = graffiti(patch.color);
        if (current === DRAINED) state.growth.xp += XP.surface;
        blockMilestones(state, patch.city, skel.surfaces, states, coloredOnce, info.chunk);
        if (current === DRAINED) markThriving(state, patch.city, skel, states, info.chunk);
        return OK;
      }
    }
  }

  // src/content/crew-characters.ts
  var FRONTIER_CHARACTERS = [
    { key: "cube/Character_Female_1", name: "\u65B9\u5757\u6A59\u8863\u65C5\u4EBA" },
    { key: "cube/Character_Female_2", name: "\u65B9\u5757\u53CC\u9A6C\u5C3E\u65C5\u4EBA" },
    { key: "cube/Character_Male_1", name: "\u65B9\u5757\u91D1\u53D1\u65C5\u4EBA" },
    { key: "cube/Character_Male_2", name: "\u65B9\u5757\u9752\u886B\u65C5\u4EBA" },
    { key: "cyber/Character", name: "\u9713\u8679\u884C\u8005" },
    { key: "platformer/Character", name: "\u8DC3\u53F0\u5154" }
  ];
  var CREW_CHARACTERS = [
    { key: "pirate/Anne", name: "\u6D77\u76D7\u5B89\u59AE" },
    { key: "pirate/Captain_Barbarossa", name: "\u5DF4\u5DF4\u7F57\u8428\u8239\u957F" },
    { key: "pirate/Henry", name: "\u6C34\u624B\u4EA8\u5229" },
    { key: "pirate/Mako", name: "\u6D77\u76D7\u9A6C\u79D1" },
    { key: "pirate/Sharky", name: "\u9CA8\u9C7C\u6C34\u624B" },
    { key: "pirate/Skeleton", name: "\u9AB7\u9AC5\u8239\u5458" },
    { key: "pirate/Skeleton_Headless", name: "\u65E0\u5934\u9AB7\u9AC5\u8239\u5458" },
    { key: "kenney/character-alien", name: "\u8FF7\u4F60\u5916\u661F\u4EBA" },
    { key: "kenney/character-knight", name: "\u8FF7\u4F60\u9A91\u58EB" },
    { key: "kenney/character-raider", name: "\u8FF7\u4F60\u63A0\u593A\u8005" },
    { key: "kenney/character-robot", name: "\u8FF7\u4F60\u673A\u5668\u4EBA" },
    { key: "kenney/character-soldier", name: "\u8FF7\u4F60\u58EB\u5175" },
    { key: "kenney/character-worker", name: "\u8FF7\u4F60\u5DE5\u4EBA" },
    { key: "kenney/character-zombie", name: "\u8FF7\u4F60\u50F5\u5C38" },
    ...["a", "b", "c", "d", "e", "f"].map((id) => ({
      key: `kenney/character-female-${id}`,
      name: `\u8FF7\u4F60\u5973\u65C5\u4EBA ${id.toUpperCase()}`
    })),
    ...["a", "b", "c", "d", "e", "f", "g"].map((id) => ({
      key: `kenney/character-male-${id}`,
      name: `\u8FF7\u4F60\u7537\u65C5\u4EBA ${id.toUpperCase()}`
    })),
    { key: "outbreak/Lis", name: "\u5E78\u5B58\u8005\u8389\u4E1D" },
    { key: "outbreak/Matt", name: "\u5E78\u5B58\u8005\u9A6C\u7279" },
    { key: "outbreak/Sam", name: "\u5E78\u5B58\u8005\u5C71\u59C6" },
    { key: "outbreak/Shaun", name: "\u5E78\u5B58\u8005\u8096\u6069" },
    { key: "sushi/Panda", name: "\u718A\u732B\u5BFF\u53F8\u5E08\u5085" },
    { key: "sushi/Rabbit_Bald", name: "\u7D20\u989C\u5154\u5E97\u5458" },
    { key: "sushi/Rabbit_Blond", name: "\u91D1\u53D1\u5154\u5E97\u5458" },
    { key: "sushi/Rabbit_Cyan", name: "\u9752\u53D1\u5154\u5E97\u5458" },
    { key: "sushi/Rabbit_Green", name: "\u7EFF\u53D1\u5154\u5E97\u5458" },
    { key: "sushi/Rabbit_Grey", name: "\u7070\u53D1\u5154\u5E97\u5458" },
    { key: "sushi/Rabbit_Pink", name: "\u7C89\u53D1\u5154\u5E97\u5458" },
    { key: "sushi/Rabbit_Purple", name: "\u7D2B\u53D1\u5154\u5E97\u5458" },
    ...FRONTIER_CHARACTERS
  ];

  // src/content/quaternius-characters.ts
  var animatedCharacters = {
    BaseCharacter: "\u7D20\u6A21\u6751\u6C11",
    BlueSoldierFemale: "\u84DD\u8863\u5973\u536B\u5175",
    BlueSoldierMale: "\u84DD\u8863\u7537\u536B\u5175",
    Casual2Female: "\u5973\u6E38\u5BA2",
    Casual2Male: "\u7537\u6E38\u5BA2",
    Casual3Female: "\u5973\u8857\u574A",
    Casual3Male: "\u7537\u8857\u574A",
    CasualBald: "\u5149\u5934\u8857\u574A",
    CasualFemale: "\u4F11\u95F2\u88C5\u5973\u6751\u6C11",
    CasualMale: "\u4F11\u95F2\u88C5\u7537\u6751\u6C11",
    ChefFemale: "\u5973\u53A8\u5E08",
    ChefHat: "\u9AD8\u5E3D\u53A8\u5E08",
    ChefMale: "\u7537\u53A8\u5E08",
    Cow: "\u5976\u725B\u88C5\u6751\u6C11",
    CowboyFemale: "\u5973\u725B\u4ED4",
    CowboyHair: "\u77ED\u53D1\u725B\u4ED4",
    CowboyMale: "\u7537\u725B\u4ED4",
    DoctorFemaleOld: "\u5E74\u957F\u5973\u533B\u751F",
    DoctorFemaleYoung: "\u5E74\u8F7B\u5973\u533B\u751F",
    DoctorMaleOld: "\u5E74\u957F\u7537\u533B\u751F",
    DoctorMaleYoung: "\u5E74\u8F7B\u7537\u533B\u751F",
    Elf: "\u7CBE\u7075",
    GoblinFemale: "\u5973\u5730\u7CBE",
    GoblinMale: "\u7537\u5730\u7CBE",
    KimonoFemale: "\u548C\u670D\u5973\u6751\u6C11",
    KimonoMale: "\u548C\u670D\u7537\u6751\u6C11",
    KnightGoldenFemale: "\u91D1\u7532\u5973\u9A91\u58EB",
    KnightGoldenMale: "\u91D1\u7532\u7537\u9A91\u58EB",
    KnightMale: "\u94E0\u7532\u9A91\u58EB",
    NinjaFemale: "\u5973\u5FCD\u8005",
    NinjaMale: "\u7537\u5FCD\u8005",
    NinjaMaleHair: "\u77ED\u53D1\u5FCD\u8005",
    NinjaSand: "\u6C99\u5730\u7537\u5FCD\u8005",
    NinjaSandFemale: "\u6C99\u5730\u5973\u5FCD\u8005",
    OldClassyFemale: "\u8001\u592B\u4EBA",
    OldClassyMale: "\u8001\u7EC5\u58EB",
    PirateFemale: "\u5973\u6D77\u76D7",
    PirateMale: "\u7537\u6D77\u76D7",
    Pug: "\u5DF4\u54E5\u72AC\u88C5\u6751\u6C11",
    SoldierFemale: "\u5973\u58EB\u5175",
    SoldierMale: "\u7537\u58EB\u5175",
    SuitFemale: "\u897F\u88C5\u5973\u58EB",
    SuitMale: "\u897F\u88C5\u7537\u58EB",
    VikingFemale: "\u7EF4\u4EAC\u5973\u6751\u6C11",
    VikingHelmet: "\u76D4\u5E3D\u7EF4\u4EAC\u4EBA",
    VikingMale: "\u7EF4\u4EAC\u7537\u6751\u6C11",
    Witch: "\u6751\u4E2D\u5973\u5DEB",
    Wizard: "\u6751\u4E2D\u5DEB\u5E08",
    WorkerFemale: "\u5973\u5DE5\u5320",
    WorkerMale: "\u7537\u5DE5\u5320",
    ZombieFemale: "\u5973\u50F5\u5C38",
    ZombieMale: "\u7537\u50F5\u5C38"
  };
  var rpgCharacters = {
    Cleric: "\u7267\u5E08",
    Monk: "\u6B66\u50E7",
    Ranger: "\u5F13\u624B",
    Rogue: "\u6E38\u8361\u8005",
    Warrior: "\u6218\u58EB",
    Wizard: "\u6301\u6756\u6CD5\u5E08"
  };
  var PACK_CHARACTERS = [
    ...Object.entries(animatedCharacters).map(([id, name]) => ({
      key: `animated/${id}`,
      name
    })),
    ...Object.entries(rpgCharacters).map(([id, name]) => ({ key: `rpg/${id}`, name }))
  ];
  var SPACE_CHARACTERS = [
    { key: "space/BarbaraTheBee", name: "\u871C\u8702\u5B87\u822A\u5458\u82AD\u82AD\u62C9" },
    { key: "space/FernandoTheFlamingo", name: "\u706B\u70C8\u9E1F\u5B87\u822A\u5458\u8D39\u5C14\u5357\u591A" },
    { key: "space/FinnTheFrog", name: "\u9752\u86D9\u5B87\u822A\u5458\u82AC\u6069" },
    { key: "space/RaeTheRedPanda", name: "\u5C0F\u718A\u732B\u5B87\u822A\u5458\u857E" }
  ];

  // src/content/characters.ts
  var SKIN_TONES = ["skinLight", "skinWarm", "skinDeep"];
  var HAIR_COLORS = ["charcoal", "brown", "sand", "cream"];
  var PLAYER_PACK_NAMES = {
    classic: "\u539F\u6709\u89D2\u8272",
    animated: "Quaternius \u52A8\u753B\u89D2\u8272\u5305",
    rpg: "Quaternius RPG \u89D2\u8272\u5305",
    space: "Quaternius \u592A\u7A7A\u63A2\u9669\u5305",
    pirate: "Quaternius \u6D77\u76D7\u5305",
    kenney: "Kenney \u8FF7\u4F60\u4EBA\u7269\u5305",
    outbreak: "Quaternius \u5E78\u5B58\u8005\u5305",
    sushi: "Quaternius \u5BFF\u53F8\u5E97\u89D2\u8272\u5305",
    cube: "Quaternius \u65B9\u5757\u4E16\u754C\u5305",
    cyber: "Quaternius \u8D5B\u535A\u670B\u514B\u5305",
    platformer: "Quaternius \u5E73\u53F0\u5192\u9669\u5305"
  };
  var CHARACTERS = [
    {
      key: "courier",
      name: "\u4FE1\u4F7F",
      model: "adventurer",
      blurb: "\u77ED\u5916\u5957\u3001\u957F\u9774\u548C\u65C5\u884C\u80CC\u5305\uFF0C\u5E26\u7740\u989C\u8272\u4E0A\u8DEF",
      colors: { coat: "limewash", trousers: "charcoal", boots: "brown", bag: "brown", plane: "cream" },
      defaults: { skin: 0, hair: 1, accent: "teal" }
    },
    {
      key: "mason",
      name: "\u77F3\u5320",
      model: "kaykit:barbarian",
      blurb: "KayKit \u6751\u6C11 \xB7 \u539A\u5B9E\u62A4\u8155\u3001\u76AE\u9769\u88C5\u675F\uFF0C\u5E38\u5E74\u5728\u77F3\u6599\u95F4\u5FD9\u788C",
      colors: {
        coat: "limewash",
        overalls: "sky",
        trousers: "sky",
        boots: "brown",
        pouch: "brown",
        lamp: "cream"
      },
      defaults: { skin: 2, hair: 0, accent: "yellow" }
    },
    {
      key: "apprentice",
      name: "\u5B66\u5F92",
      model: "kaykit:mage",
      blurb: "KayKit \u6751\u6C11 \xB7 \u5C16\u5E3D\u4E0E\u957F\u888D\uFF0C\u8DDF\u7740\u5E08\u5085\u5B66\u4E60\u7ED8\u8272",
      colors: {
        coat: "limewash",
        trousers: "charcoal",
        boots: "brown",
        belt: "brown",
        brush: "brown",
        ferrule: "yellow"
      },
      defaults: { skin: 1, hair: 0, accent: "purple" }
    },
    {
      key: "ranger",
      name: "\u5DE1\u6797\u4EBA",
      model: "kaykit:rogue-hooded",
      blurb: "KayKit \u6751\u6C11 \xB7 \u515C\u5E3D\u4E0E\u77ED\u62AB\u98CE\uFF0C\u719F\u6089\u6797\u95F4\u7684\u5C0F\u8DEF",
      colors: { coat: "teal", vest: "brown", trousers: "sand", boots: "brown", band: "brown", goggles: "sky" },
      defaults: { skin: 0, hair: 2, accent: "orange" }
    },
    {
      key: "boatman",
      name: "\u8239\u592B",
      model: "kaykit:rogue",
      blurb: "KayKit \u6751\u6C11 \xB7 \u8F7B\u88C5\u77ED\u8863\uFF0C\u5728\u6CB3\u5CB8\u4E0E\u6E21\u53E3\u5F80\u8FD4",
      colors: {
        coat: "limewash",
        trousers: "charcoal",
        boots: "brown",
        hat: "sand",
        rope: "brown",
        towel: "cream"
      },
      defaults: { skin: 1, hair: 0, accent: "blue" }
    },
    {
      key: "gardener",
      name: "\u56ED\u4E01",
      model: "kaykit:rogue",
      blurb: "KayKit \u6751\u6C11 \xB7 \u7EFF\u8272\u8F7B\u88C5\uFF0C\u7167\u6599\u6751\u91CC\u7684\u82B1\u8349",
      colors: {
        coat: "limewash",
        trousers: "brown",
        boots: "brown",
        hat: "sand",
        petal: "pink",
        bud: "yellow"
      },
      defaults: { skin: 0, hair: 1, accent: "green" }
    },
    {
      key: "beach",
      name: "\u6D77\u6EE8\u65C5\u4EBA",
      model: "beach",
      blurb: "\u77ED\u88E4\u4E0E\u51C9\u978B\uFF0C\u8F7B\u88C5\u8D70\u8FC7\u6D77\u5CB8",
      colors: { coat: "cream", trousers: "red", boots: "sand" },
      defaults: { skin: 1, hair: 1, accent: "red" }
    },
    {
      key: "casual",
      name: "\u8857\u5934\u9752\u5E74",
      model: "casual",
      blurb: "\u5BBD\u677E\u4E0A\u8863\u3001\u725B\u4ED4\u88E4\u548C\u8FD0\u52A8\u978B",
      colors: { coat: "purple", trousers: "blue", boots: "cream" },
      defaults: { skin: 0, hair: 0, accent: "purple" }
    },
    {
      key: "casual2",
      name: "\u4F11\u95F2\u65C5\u4EBA",
      model: "casual2",
      blurb: "\u886C\u8863\u3001\u957F\u88E4\uFF0C\u968F\u6027\u51FA\u95E8",
      colors: { coat: "cream", trousers: "blue", boots: "sand" },
      defaults: { skin: 1, hair: 1, accent: "red" }
    },
    {
      key: "farmer",
      name: "\u519C\u592B",
      model: "farmer",
      blurb: "\u8349\u5E3D\u3001\u80CC\u5E26\u88E4\u548C\u5DE5\u4F5C\u9774",
      colors: { coat: "limewash", trousers: "blue", boots: "bark" },
      defaults: { skin: 1, hair: 1, accent: "blue" }
    },
    {
      key: "king",
      name: "\u56FD\u738B",
      model: "king",
      blurb: "\u738B\u51A0\u3001\u94E0\u7532\u4E0E\u62AB\u98CE",
      colors: { coat: "blue", trousers: "charcoal", boots: "bark" },
      defaults: { skin: 0, hair: 3, accent: "blue" }
    },
    {
      key: "punk",
      name: "\u670B\u514B",
      model: "punk",
      blurb: "\u9192\u76EE\u53D1\u578B\u3001\u76AE\u8863\u548C\u957F\u9774",
      colors: { coat: "ink", trousers: "blue", boots: "ink" },
      defaults: { skin: 0, hair: 1, accent: "red" }
    },
    {
      key: "spacesuit",
      name: "\u5B87\u822A\u5458",
      model: "spacesuit",
      blurb: "\u5BC6\u5C01\u5934\u76D4\u4E0E\u539A\u5B9E\u592A\u7A7A\u670D",
      colors: { coat: "cream", trousers: "teal", boots: "charcoal" },
      defaults: { skin: 0, hair: 0, accent: "orange" }
    },
    {
      key: "suit",
      name: "\u7EC5\u58EB",
      model: "suit",
      blurb: "\u6574\u9F50\u897F\u88C5\u3001\u9886\u5E26\u4E0E\u76AE\u978B",
      colors: { coat: "charcoal", trousers: "charcoal", boots: "ink" },
      defaults: { skin: 0, hair: 0, accent: "blue" }
    },
    {
      key: "swat",
      name: "\u7279\u52E4",
      model: "swat",
      blurb: "\u5934\u76D4\u3001\u62A4\u76EE\u955C\u4E0E\u6218\u672F\u88C5\u5907",
      colors: { coat: "charcoal", trousers: "charcoal", boots: "ink" },
      defaults: { skin: 1, hair: 0, accent: "charcoal" }
    },
    {
      key: "worker",
      name: "\u5DE5\u4EBA",
      model: "worker",
      blurb: "\u5B89\u5168\u5E3D\u3001\u53CD\u5149\u80CC\u5FC3\u548C\u5DE5\u5177\u8170\u5E26",
      colors: { coat: "sand", trousers: "bark", boots: "ink" },
      defaults: { skin: 1, hair: 1, accent: "orange" }
    },
    {
      key: "witch",
      name: "\u7ED8\u8272\u5973\u5DEB",
      model: "witch",
      blurb: "\u6234\u7740\u5C16\u5E3D\uFF0C\u63D0\u7B14\u4E3A\u65C5\u9014\u4E2D\u7684\u98CE\u666F\u8FD8\u8272",
      colors: { coat: "purple", trousers: "bark", boots: "brown" },
      defaults: { skin: 1, hair: 0, accent: "purple" }
    },
    {
      key: "women-adventurer",
      model: "women-adventurer",
      name: "\u5973\u5192\u9669\u5BB6",
      blurb: "\u65C5\u884C\u76AE\u9774\u548C\u7EFF\u8272\u77ED\u886B\uFF0C\u9002\u5408\u957F\u9014\u8DCB\u6D89",
      colors: { coat: "green", trousers: "charcoal", boots: "brown" },
      defaults: { skin: 1, hair: 1, accent: "green" }
    },
    {
      key: "women-casual",
      model: "women-casual",
      name: "\u8857\u5934\u753B\u5E08",
      blurb: "\u6A59\u8272\u4F11\u95F2\u88C5\u4E0E\u8FD0\u52A8\u978B",
      colors: { coat: "orange", trousers: "charcoal", boots: "brown" },
      defaults: { skin: 0, hair: 2, accent: "orange" }
    },
    {
      key: "women-formal",
      model: "women-formal",
      name: "\u793C\u670D\u5BBE\u5BA2",
      blurb: "\u4EAE\u8272\u793C\u670D\u914D\u91D1\u8272\u9970\u7269",
      colors: { coat: "green", trousers: "charcoal", boots: "brown" },
      defaults: { skin: 1, hair: 1, accent: "green" }
    },
    {
      key: "women-medieval",
      model: "women-medieval",
      name: "\u53E4\u9547\u65C5\u4EBA",
      blurb: "\u76AE\u9769\u675F\u8170\u4E0E\u957F\u9774",
      colors: { coat: "cream", trousers: "charcoal", boots: "brown" },
      defaults: { skin: 1, hair: 1, accent: "cream" }
    },
    {
      key: "women-punk",
      model: "women-punk",
      name: "\u670B\u514B\u4E50\u624B",
      blurb: "\u7C89\u8272\u88C5\u9970\u4E0E\u6DF1\u8272\u76AE\u8863",
      colors: { coat: "pink", trousers: "charcoal", boots: "brown" },
      defaults: { skin: 0, hair: 0, accent: "pink" }
    },
    {
      key: "women-scifi",
      model: "women-scifi",
      name: "\u661F\u9645\u6280\u5E08",
      blurb: "\u84DD\u8272\u62A4\u7532\u4E0E\u91D1\u5C5E\u90E8\u4EF6",
      colors: { coat: "sky", trousers: "charcoal", boots: "brown" },
      defaults: { skin: 0, hair: 0, accent: "sky" }
    },
    {
      key: "women-soldier",
      model: "women-soldier",
      name: "\u5973\u4FA6\u5BDF\u5175",
      blurb: "\u6218\u672F\u5236\u670D\u4E0E\u6DF1\u8272\u62A4\u5177",
      colors: { coat: "teal", trousers: "charcoal", boots: "brown" },
      defaults: { skin: 1, hair: 1, accent: "teal" }
    },
    {
      key: "women-suit",
      model: "women-suit",
      name: "\u5973\u529E\u4E8B\u5458",
      blurb: "\u6DF1\u8272\u897F\u88C5\u4E0E\u6D45\u8272\u886C\u8863",
      colors: { coat: "cream", trousers: "charcoal", boots: "brown" },
      defaults: { skin: 0, hair: 2, accent: "cream" }
    },
    {
      key: "women-worker",
      model: "women-worker",
      name: "\u5973\u5DE5\u7A0B\u5E08",
      blurb: "\u5B89\u5168\u5E3D\u4E0E\u53CD\u5149\u80CC\u5FC3",
      colors: { coat: "orange", trousers: "charcoal", boots: "brown" },
      defaults: { skin: 1, hair: 1, accent: "orange" }
    },
    ...[...PACK_CHARACTERS, ...SPACE_CHARACTERS, ...CREW_CHARACTERS].map(({ key, name }) => ({
      key,
      name,
      model: key,
      blurb: PLAYER_PACK_NAMES[playerPack(key)],
      colors: { coat: "cream", trousers: "charcoal", boots: "bark" },
      defaults: { skin: 0, hair: 0, accent: "teal" }
    }))
  ];
  function playerPack(key) {
    const prefix = key.split("/")[0];
    return Object.hasOwn(PLAYER_PACK_NAMES, prefix) ? prefix : "classic";
  }
  var CHARACTER_KEYS = CHARACTERS.map((c) => c.key);

  // src/world/profile.ts
  var NAME_MAX = 12;
  var DEFAULT_NAME = "\u65C5\u4EBA";
  var index = (v, count) => Number.isInteger(v) && v >= 0 && v < count ? v : null;
  function validLook(v) {
    const l = v;
    if (!l || !CHARACTER_KEYS.includes(l.character)) return null;
    const skin = index(l.skin, SKIN_TONES.length);
    const hair = index(l.hair, HAIR_COLORS.length);
    const accent = index(l.accent, PALETTE.length);
    if (skin === null || hair === null || accent === null || !PALETTE[accent].paintable) return null;
    return { character: l.character, skin, hair, accent };
  }
  function cleanName(v) {
    const s = typeof v === "string" ? [...v.trim()].slice(0, NAME_MAX).join("") : "";
    return s || DEFAULT_NAME;
  }

  // src/world/arena/hits.ts
  var BODY = { half: 0.35, height: 1.42 };
  var HEAD = { half: 0.18, centre: 1.62 };
  function bodyBox(p) {
    return {
      min: { x: p.x - BODY.half, y: p.y, z: p.z - BODY.half },
      max: { x: p.x + BODY.half, y: p.y + BODY.height, z: p.z + BODY.half }
    };
  }
  function headBox(p) {
    const y = p.y + HEAD.centre;
    return {
      min: { x: p.x - HEAD.half, y: y - HEAD.half, z: p.z - HEAD.half },
      max: { x: p.x + HEAD.half, y: y + HEAD.half, z: p.z + HEAD.half }
    };
  }
  var chest = (p) => ({ x: p.x, y: p.y + 0.9, z: p.z });
  function rayBox(o, d, box, max) {
    let near2 = 0;
    let far = max;
    for (const k of ["x", "y", "z"]) {
      if (Math.abs(d[k]) < 1e-9) {
        if (o[k] < box.min[k] || o[k] > box.max[k]) return null;
        continue;
      }
      let t0 = (box.min[k] - o[k]) / d[k];
      let t1 = (box.max[k] - o[k]) / d[k];
      if (t0 > t1) [t0, t1] = [t1, t0];
      near2 = Math.max(near2, t0);
      far = Math.min(far, t1);
      if (near2 > far) return null;
    }
    return near2;
  }
  var STEP2 = 0.5;
  function clearDistance(solid, o, d, max) {
    let end = max;
    for (const b of solid.boxes) {
      const t = rayBox(o, d, b, end);
      if (t !== null) end = t;
    }
    for (let t = STEP2; t < end; t += STEP2) {
      const y = o.y + d.y * t;
      if (y < solid.heightAt(o.x + d.x * t, o.z + d.z * t) - 0.05) return Math.max(0, t - STEP2);
    }
    return end;
  }
  function sees(solid, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return true;
    const d = { x: dx / len, y: dy / len, z: dz / len };
    return clearDistance(solid, a, d, len) >= len - 0.05;
  }
  function positionAt(track, t) {
    if (!track.length) return null;
    if (t <= track[0].t) return track[0].p;
    for (let i = 1; i < track.length; i++) {
      const b = track[i];
      if (b.t < t) continue;
      const a = track[i - 1];
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      return { x: a.p.x + (b.p.x - a.p.x) * f, y: a.p.y + (b.p.y - a.p.y) * f, z: a.p.z + (b.p.z - a.p.z) * f };
    }
    return track[track.length - 1].p;
  }
  function judgedAt(now, shooterSaw) {
    return Math.min(now, Math.max(now - ARENA.rewind, shooterSaw - ARENA.viewDelay));
  }
  function traceShot(solid, o, d, range, targets) {
    let best = null;
    for (const c of targets) {
      const head = rayBox(o, d, headBox(c.p), range);
      const body = rayBox(o, d, bodyBox(c.p), range);
      const t = head !== null && (body === null || head <= body) ? head : body;
      if (t === null || best && t >= best.dist) continue;
      best = { id: c.id, head: t === head, dist: t };
    }
    if (!best) return null;
    return clearDistance(solid, o, d, best.dist) >= best.dist - 0.05 ? best : null;
  }
  function inArc(solid, o, d, range, halfAngle, targets) {
    const out = [];
    for (const c of targets) {
      const m = chest(c.p);
      const dx = m.x - o.x;
      const dy = m.y - o.y;
      const dz = m.z - o.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > range + BODY.half) continue;
      const cos = dist < 0.6 ? 1 : (dx * d.x + dy * d.y + dz * d.z) / dist;
      if (cos < Math.cos(halfAngle + Math.atan2(BODY.half, Math.max(dist, 0.1)))) continue;
      if (sees(solid, o, m)) out.push(c.id);
    }
    return out;
  }
  function inBlast(solid, at, radius, targets) {
    const out = [];
    for (const c of targets) {
      const m = chest(c.p);
      const dist = Math.max(0, Math.hypot(m.x - at.x, m.y - at.y, m.z - at.z) - BODY.half);
      if (dist > radius) continue;
      if (!sees(solid, { x: at.x, y: at.y + 0.3, z: at.z }, m)) continue;
      out.push({ id: c.id, share: 0.4 + 0.6 * (1 - dist / radius) });
    }
    return out;
  }
  function shellBurst(solid, o, d, targets) {
    const S4 = ARENA.shell;
    const dt = 1 / 60;
    let p = o;
    let v = { x: d.x * S4.speed, y: d.y * S4.speed + S4.lift, z: d.z * S4.speed };
    for (let t = 0; t < S4.life; t += dt) {
      v = { x: v.x, y: v.y - S4.gravity * dt, z: v.z };
      const step = Math.hypot(v.x, v.y, v.z) * dt;
      const dir = { x: v.x * dt / step, y: v.y * dt / step, z: v.z * dt / step };
      const stop = clearDistance(solid, p, dir, step);
      const next = { x: p.x + dir.x * stop, y: p.y + dir.y * stop, z: p.z + dir.z * stop };
      if (stop < step - 1e-6 || next.y <= solid.heightAt(next.x, next.z)) return next;
      for (const c of targets) {
        const m = chest(c.p);
        if (Math.hypot(m.x - next.x, m.y - next.y, m.z - next.z) < S4.probe + BODY.half) return next;
      }
      p = next;
    }
    return p;
  }

  // src/world/arena/match.ts
  var STATE = { kind: "state" };
  var ArenaMatch = class {
    constructor(site, where) {
      __publicField(this, "site", site);
      __publicField(this, "where", where);
      __publicField(this, "phase", "waiting");
      __publicField(this, "mode", "ffa");
      __publicField(this, "phaseEnds", 0);
      __publicField(this, "winner", null);
      __publicField(this, "fighters", /* @__PURE__ */ new Map());
      __publicField(this, "joins", 0);
    }
    get count() {
      return this.fighters.size;
    }
    has(id) {
      return this.fighters.has(id);
    }
    isAlive(id) {
      var _a2, _b;
      return (_b = (_a2 = this.fighters.get(id)) == null ? void 0 : _a2.alive) != null ? _b : false;
    }
    join(id, now) {
      if (this.fighters.has(id)) return [];
      const f = {
        id,
        order: this.joins++,
        team: -1,
        kills: 0,
        deaths: 0,
        hp: ARENA.hp,
        shield: 0,
        shieldUntil: 0,
        focusUntil: 0,
        alive: true,
        respawnAt: 0,
        graceUntil: 0,
        vote: this.mode,
        last: /* @__PURE__ */ new Map()
      };
      this.fighters.set(id, f);
      if (this.phase === "fighting" && this.mode === "teams") f.team = this.smallerTeam(id);
      return [this.spawn(f, now), STATE];
    }
    leave(id) {
      return this.fighters.delete(id) ? [STATE] : [];
    }
    vote(id, mode) {
      const f = this.fighters.get(id);
      if (!f || f.vote === mode) return [];
      f.vote = mode;
      return [STATE];
    }
    /** Whether `id` may act again: at most once per `gap` seconds for each `key`. */
    allow(id, key, gap, now) {
      var _a2;
      const f = this.fighters.get(id);
      if (!f || !f.alive) return false;
      if (now - ((_a2 = f.last.get(key)) != null ? _a2 : -Infinity) < gap) return false;
      f.last.set(key, now);
      return true;
    }
    shield(id, now) {
      const f = this.fighters.get(id);
      if (!f) return;
      f.shield = ARENA.shield.amount;
      f.shieldUntil = now + ARENA.shield.seconds;
    }
    focus(id, now) {
      const f = this.fighters.get(id);
      if (f) f.focusUntil = now + ARENA.focus.seconds;
    }
    focused(id, now) {
      var _a2, _b;
      return ((_b = (_a2 = this.fighters.get(id)) == null ? void 0 : _a2.focusUntil) != null ? _b : 0) > now;
    }
    /** Whom `id` can hurt right now: up, past their grace, not a teammate, during a round. */
    targetsFor(id, now) {
      const me = this.fighters.get(id);
      if (!me || this.phase !== "fighting") return [];
      const out = [];
      for (const f of this.fighters.values()) {
        if (f.id === id || !f.alive || f.graceUntil > now) continue;
        if (this.mode === "teams" && f.team === me.team) continue;
        out.push(f.id);
      }
      return out;
    }
    /** `from` hurts `to` with weapon `w`. Checks targetsFor again, so stale hits do nothing. */
    damage(from, to, amount, head, w, now) {
      if (!this.targetsFor(from, now).includes(to)) return [];
      const f = this.fighters.get(to);
      let rest = Math.round(amount);
      if (f.shield > 0 && f.shieldUntil > now) {
        const soak = Math.min(f.shield, rest);
        f.shield -= soak;
        rest -= soak;
      }
      f.hp = Math.max(0, f.hp - rest);
      const out = [{ kind: "hit", from, to, amount: Math.round(amount), head, hp: f.hp }];
      if (f.hp > 0) return out;
      f.alive = false;
      f.deaths++;
      f.respawnAt = now + ARENA.respawn;
      const killer = this.fighters.get(from);
      if (killer && killer !== f) killer.kills++;
      out.push({ kind: "down", who: to, by: from, w }, STATE);
      if (this.reachedTarget()) this.endRound(now);
      return out;
    }
    /** Time passes: rounds start and end, the fallen get up. */
    tick(now) {
      const out = [];
      for (const f of this.fighters.values())
        if (!f.alive && f.respawnAt <= now) out.push(this.spawn(f, now), STATE);
      const enough = this.fighters.size >= 2;
      switch (this.phase) {
        case "waiting":
          if (enough) this.setPhase("countdown", now + ARENA.countdown, out);
          break;
        case "countdown":
          if (!enough) this.setPhase("waiting", 0, out);
          else if (now >= this.phaseEnds) this.startRound(now, out);
          break;
        case "fighting":
          if (!enough) this.setPhase("waiting", 0, out);
          else if (now >= this.phaseEnds) {
            this.endRound(now);
            out.push(STATE);
          } else if (this.mode === "teams") this.balance(out);
          break;
        case "results":
          if (now >= this.phaseEnds)
            this.setPhase(enough ? "countdown" : "waiting", now + ARENA.countdown, out);
          break;
      }
      return out;
    }
    state(now) {
      return {
        phase: this.phase,
        mode: this.mode,
        left: this.phase === "waiting" ? 0 : Math.max(0, Math.round((this.phaseEnds - now) * 10) / 10),
        members: [...this.fighters.values()].map((f) => ({
          id: f.id,
          team: f.team,
          kills: f.kills,
          deaths: f.deaths,
          hp: f.hp,
          alive: f.alive,
          vote: f.vote
        })),
        winner: this.phase === "results" ? this.winner : null
      };
    }
    setPhase(phase, ends, out) {
      this.phase = phase;
      this.phaseEnds = ends;
      out.push(STATE);
    }
    startRound(now, out) {
      let teams = 0;
      for (const f of this.fighters.values()) teams += f.vote === "teams" ? 1 : -1;
      if (teams !== 0) this.mode = teams > 0 ? "teams" : "ffa";
      const order = [...this.fighters.values()].sort((a, b) => a.order - b.order);
      order.forEach((f, i) => {
        f.team = this.mode === "teams" ? i % 2 : -1;
        f.kills = 0;
        f.deaths = 0;
        f.hp = ARENA.hp;
        f.alive = false;
      });
      this.winner = null;
      this.setPhase("fighting", now + ARENA.roundSeconds, out);
      for (const f of order) out.push(this.spawn(f, now));
    }
    teamKills(team) {
      let n = 0;
      for (const f of this.fighters.values()) if (f.team === team) n += f.kills;
      return n;
    }
    reachedTarget() {
      if (this.phase !== "fighting") return false;
      if (this.mode === "teams") return Math.max(this.teamKills(0), this.teamKills(1)) >= ARENA.killsTeams;
      return [...this.fighters.values()].some((f) => f.kills >= ARENA.killsFfa);
    }
    endRound(now) {
      if (this.mode === "teams") {
        const red = this.teamKills(0);
        const blue = this.teamKills(1);
        this.winner = red === blue ? null : { team: red > blue ? 0 : 1 };
      } else {
        const best = [...this.fighters.values()].sort(
          (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.order - b.order
        )[0];
        this.winner = best && best.kills > 0 ? { id: best.id } : null;
      }
      this.phase = "results";
      this.phaseEnds = now + ARENA.results;
    }
    smallerTeam(except) {
      let red = 0;
      let blue = 0;
      for (const f of this.fighters.values()) {
        if (f.id === except) continue;
        if (f.team === 0) red++;
        if (f.team === 1) blue++;
      }
      return red <= blue ? 0 : 1;
    }
    /** Someone left and a side is empty or two short: move the newest from the bigger side. */
    balance(out) {
      const sides = [[], []];
      for (const f of this.fighters.values()) if (f.team >= 0) sides[f.team].push(f);
      const [red, blue] = sides;
      if (Math.abs(red.length - blue.length) < 2 && red.length && blue.length) return;
      const big = red.length > blue.length ? red : blue;
      const moved = big.sort((a, b) => b.order - a.order)[0];
      if (!moved) return;
      moved.team = big === red ? 1 : 0;
      out.push(STATE);
    }
    /** Up again (or for the first time), full health, a moment of grace, at the spawn point
     * farthest from anyone who could shoot them. */
    spawn(f, now) {
      f.alive = true;
      f.hp = ARENA.hp;
      f.shield = 0;
      f.graceUntil = now + ARENA.grace;
      const threats = [];
      for (const o of this.fighters.values()) {
        if (o === f || !o.alive || this.mode === "teams" && o.team === f.team && f.team >= 0) continue;
        const p = this.where(o.id);
        if (p) threats.push(p);
      }
      let best = this.site.spawns[0];
      let bestScore = -Infinity;
      for (const s of this.site.spawns) {
        const score = threats.length ? Math.min(...threats.map((t) => Math.hypot(t.x - s.x, t.z - s.z))) : 0;
        const tie = score + Math.random() * 6;
        if (tie > bestScore) {
          bestScore = tie;
          best = s;
        }
      }
      return { kind: "spawn", who: f.id, p: { x: best.x, y: best.y, z: best.z }, yaw: best.yaw };
    }
  };

  // src/world/wilderness/groves.ts
  var SEA_FLOWERS = [
    { name: "\u6CB9\u83DC\u82B1", colour: color("yellow"), dot: color("cream"), from: 0.02, to: 0.22 },
    { name: "\u85B0\u8863\u8349", colour: color("purple"), dot: color("sky"), from: 0.27, to: 0.47 },
    { name: "\u683C\u6851\u82B1", colour: color("pink"), dot: color("cream"), from: 0.4, to: 0.6 },
    { name: "\u5F7C\u5CB8\u82B1", colour: color("red"), dot: color("red"), from: 0.52, to: 0.68 }
  ];
  var SIZE3 = TUNING.world.chunkSize;
  var GROVE_GRID = 3;
  var GROVE_CHANCE = 0.6;
  var SEA_GRID = 3;
  var SEA_CHANCE = 0.55;
  function patchMask(p, x, z) {
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > p.r * 1.3) return 0;
    const a = Math.atan2(dz, dx);
    const edge = p.r * (1 + 0.16 * Math.sin(3 * a + p.lobes[0]) + 0.09 * Math.sin(5 * a + p.lobes[1]));
    return smoothstep(edge, edge * 0.7, d);
  }
  function* open(w, x, z, r, steep) {
    if (Math.hypot(x - SIZE3 / 2, z - SIZE3 / 2) < 120) return false;
    if (w.townAt(x, z, r + 15)) return false;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 9; k++) {
      const a = k * Math.PI * 2 / 8;
      const f = k === 8 ? 0 : 0.7;
      const px = x + Math.cos(a) * r * f, pz = z + Math.sin(a) * r * f;
      yield* __yieldStar(pathsOf(w).prepareGround(px - 4, pz - 4, px + 4, pz + 4));
      const g = w.heightAt(px, pz);
      if (g < WATER_LEVEL + 0.6) return false;
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    return hi - lo <= steep;
  }
  var roll = (h, k) => unit(hashInts(h, k));
  var lobesOf = (h) => [roll(h, 4) * 6.283, roll(h, 5) * 6.283];
  function* groveSteps(w, gx, gz) {
    if (unit(hashAt(w.seed, "grove", gx, gz)) >= GROVE_CHANCE) return null;
    const span = GROVE_GRID * SIZE3;
    for (let a = 0; a < 16; a++) {
      const h = hashAt(w.seed, "grove-spot", gx, gz, a);
      const x = gx * span + 40 + unit(h) * (span - 80);
      const z = gz * span + 40 + roll(h, 1) * (span - 80);
      const c = w.climate(x, z);
      if (c.moisture < 0.12 || c.relief > 0.3) continue;
      const r = 20 + roll(h, 2) * 16;
      if (!(yield* __yieldStar(open(w, x, z, r, 9)))) continue;
      return { id: `b${gx}_${gz}`, x, z, r, lobes: lobesOf(h), seed: h };
    }
    return null;
  }
  function* seaSteps(w, gx, gz) {
    const h0 = hashAt(w.seed, "flower-sea", gx, gz);
    if (unit(h0) >= SEA_CHANCE) return null;
    const span = SEA_GRID * SIZE3;
    for (let a = 0; a < 16; a++) {
      const h = hashAt(w.seed, "flower-sea-spot", gx, gz, a);
      const x = gx * span + 40 + unit(h) * (span - 80);
      const z = gz * span + 40 + roll(h, 1) * (span - 80);
      const c = w.climate(x, z);
      if (c.moisture > 0.15 || c.relief > 0.25) continue;
      const r = 22 + roll(h, 2) * 20;
      if (!(yield* __yieldStar(open(w, x, z, r, 5)))) continue;
      const kind = Math.floor(roll(h0, 3) * SEA_FLOWERS.length);
      return { id: `f${gx}_${gz}`, x, z, r, lobes: lobesOf(h), seed: h, kind };
    }
    return null;
  }
  var groves = /* @__PURE__ */ new WeakMap();
  var seas = /* @__PURE__ */ new WeakMap();
  function* near(store, make, grid, w, x, z, reach) {
    let m = store.get(w);
    if (!m) store.set(w, m = new StepCache());
    const cell = (v) => Math.floor(v / (grid * SIZE3));
    const out = [];
    const pad = reach + 60;
    for (let gx = cell(x - pad); gx <= cell(x + pad); gx++)
      for (let gz = cell(z - pad); gz <= cell(z + pad); gz++) {
        const key = `${gx},${gz}`;
        const p = yield* __yieldStar(m.prepare(key, () => make(w, gx, gz)));
        if (p && Math.hypot(p.x - x, p.z - z) <= reach + p.r * 1.3) out.push(p);
      }
    return out.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  }
  var grovesNear = (w, x, z, reach) => finishSteps(near(groves, groveSteps, GROVE_GRID, w, x, z, reach));
  var seasNear = (w, x, z, reach) => finishSteps(seasNearSteps(w, x, z, reach));
  var seasNearSteps = (w, x, z, reach) => near(seas, seaSteps, SEA_GRID, w, x, z, reach);
  function* prepareGroves(w, x, z, reach) {
    yield* __yieldStar(near(groves, groveSteps, GROVE_GRID, w, x, z, reach));
    yield* __yieldStar(near(seas, seaSteps, SEA_GRID, w, x, z, reach));
  }

  // src/world/wilderness/farmsteads.ts
  var OUTSKIRTS_RANGE = 180;
  var SIZE4 = TUNING.world.chunkSize;
  var CELL = TUNING.world.cellSize;
  var GRID2 = 3;
  function farmsteadInChunk(w, cx, cz, obstacles, isPeaceful = (id) => startsPeaceful(w.seed, id)) {
    if (w.terrainVersion < 4) return null;
    const region = hashAt(w.seed, "farmstead", Math.floor(cx / GRID2), Math.floor(cz / GRID2));
    const original = unit(region) < 0.85 && (cx % GRID2 + GRID2) % GRID2 === hashInts(region, 1) % GRID2 && (cz % GRID2 + GRID2) % GRID2 === hashInts(region, 2) % GRID2;
    const h = original ? region : hashAt(w.seed, "refuge-homes", cx, cz);
    const centreX = (cx + 0.5) * SIZE4, centreZ = (cz + 0.5) * SIZE4;
    const towns = w.entrancesNear(centreX, centreZ, 1);
    function nearbyVillage(x, z) {
      let nearest, distance = OUTSKIRTS_RANGE;
      for (const town of towns) {
        const d = townDistance(town, x, z);
        if (d < distance) {
          nearest = town;
          distance = d;
        }
      }
      return nearest;
    }
    if (!original && (unit(h) > 0.65 || !towns.some((t) => townDistance(t, centreX, centreZ) < OUTSKIRTS_RANGE + SIZE4 / 2)))
      return null;
    const roll2 = unit(hashInts(h, 3));
    const paths = pathsOf(w);
    for (let i = 0; i < 12; i++) {
      const spot = hashInts(h, 10 + i);
      const x = cx * SIZE4 + 32 + unit(spot) * (SIZE4 - 64);
      const z = cz * SIZE4 + 32 + unit(hashInts(spot, 1)) * (SIZE4 - 64);
      const nearest = nearbyVillage(x, z);
      const refuge = !!nearest && !isPeaceful(nearest.cityId);
      if (!original && (!nearest || !refuge && unit(h) >= 0.12)) continue;
      const count = original ? roll2 < 0.52 ? 1 : roll2 < 0.85 ? 2 : 3 : refuge ? roll2 < 0.6 ? 2 : 3 : 1;
      const hw = count === 1 ? 9 : 14;
      const hd = count === 3 ? 13 : 10;
      if (Math.hypot(x - SIZE4 / 2, z - SIZE4 / 2) < 155 || w.townAt(x, z, 43)) continue;
      if (obstacles.some(
        (o) => Math.hypot(Math.max(0, Math.abs(x - o.x) - hw), Math.max(0, Math.abs(z - o.z) - hd)) < o.room + 1
      ))
        continue;
      const front = paths.edgeDistance(x, z + hd + 5) <= paths.edgeDistance(x, z - hd - 5) ? 1 : -1;
      const yard = groundRange(w, x, z, hw + 2, hd + 2);
      if (yard.low < WATER_LEVEL + 0.65 || yard.high - yard.low > 2.1) continue;
      let clear2 = true;
      for (let dx = -hw; dx <= hw && clear2; dx += 2)
        for (let dz = -hd; dz <= hd && clear2; dz += 2) clear2 = paths.edgeDistance(x + dx, z + dz) > 3;
      if (!clear2) continue;
      const plans = count === 1 ? [[0, -2, 4.2, 3.1]] : [
        [-6, -4.5, 4, 3],
        [6, -4, 3.4, 2.8]
      ];
      if (count === 3) plans.push([7.5, 6, 2.8, 2.45]);
      const buildings = plans.map(([dx, dz, width, depth], index2) => {
        const bx = x + dx;
        const bz = z + dz * front;
        const range = groundRange(w, bx, bz, width + 0.25, depth + 0.25);
        return {
          x: bx,
          z: bz,
          hw: width,
          hd: depth,
          foot: range.low - 0.14,
          base: range.high + 0.08,
          height: (index2 === 2 ? 2.8 : 3.25) + unit(hashInts(h, 40 + index2)) * 0.65,
          barn: original && index2 === 1,
          residents: original && index2 === 1 ? 0 : (refuge ? 2 : 1) + hashInts(h, 50, index2) % 2
        };
      });
      if (buildings.some((b) => b.base - b.foot > 1.05)) continue;
      return {
        refugeFor: refuge ? nearest.cityId : void 0,
        x,
        z,
        hw,
        hd,
        front,
        stoneWall: unit(hashInts(h, 4)) < 0.45,
        seed: h,
        buildings
      };
    }
    return null;
  }
  function groundRange(w, x, z, hw, hd) {
    let low = Infinity;
    let high = -Infinity;
    for (let gx = Math.floor((x - hw) / CELL) * CELL; gx <= Math.ceil((x + hw) / CELL) * CELL; gx += CELL)
      for (let gz = Math.floor((z - hd) / CELL) * CELL; gz <= Math.ceil((z + hd) / CELL) * CELL; gz += CELL) {
        const y = w.heightAt(gx, gz);
        low = Math.min(low, y);
        high = Math.max(high, y);
      }
    return { low, high };
  }

  // src/world/wilderness/ground-props.ts
  function groundPropsInChunk(w, cx, cz, trees, clear2) {
    const size = TUNING.world.chunkSize;
    const props = [];
    const paths = pathsOf(w);
    for (let iz = 0; iz < 4; iz++)
      for (let ix = 0; ix < 4; ix++) {
        const seed = hashAt(w.seed, "ground-prop", cx * 4 + ix, cz * 4 + iz);
        const rng = new Rng(seed);
        if (!rng.chance(0.58)) continue;
        const x = (cx + (ix + rng.range(0.17, 0.83)) / 4) * size;
        const z = (cz + (iz + rng.range(0.17, 0.83)) / 4) * size;
        const y = w.heightAt(x, z);
        if (y < WATER_LEVEL - 0.12 || w.townAt(x, z, 6) || !clear2(x, z)) continue;
        const road = paths.edgeDistance(x, z);
        if (road < 5 || trees.some((t) => Math.hypot(x - t.x, z - t.z) < (t.kind === "great" ? 12 : 4)))
          continue;
        const nearWater = y < WATER_LEVEL + 2 && [
          [8, 0],
          [-8, 0],
          [0, 8],
          [0, -8]
        ].some(([dx, dz]) => w.heightAt(x + dx, z + dz) < WATER_LEVEL);
        const biome = BIOMES[w.biomeAt(x, z)].key;
        const wooded = biome === "forest" || trees.some((t) => Math.hypot(x - t.x, z - t.z) < 10);
        let kind;
        if (nearWater) kind = rng.chance(0.65) ? "shingle" : "driftwood";
        else if (y < WATER_LEVEL + 0.2) continue;
        else if (road < 25 && rng.chance(wooded ? 0.5 : 0.25)) kind = "stump";
        else if (wooded) kind = rng.chance(0.48) ? "windfall" : "mossRock";
        else kind = "outcrop";
        const scale = rng.range(0.72, 1.28);
        let yaw = rng.range(0, Math.PI * 2);
        if (kind === "driftwood") {
          const dx = w.heightAt(x + 2, z) - w.heightAt(x - 2, z);
          const dz = w.heightAt(x, z + 2) - w.heightAt(x, z - 2);
          yaw = Math.atan2(dz, -dx) + rng.range(-0.3, 0.3);
        }
        let rise = 0, base = y;
        if (kind === "windfall" || kind === "driftwood") {
          const dx = Math.sin(yaw) * 1.8 * scale, dz = Math.cos(yaw) * 1.8 * scale;
          const a = w.heightAt(x - dx, z - dz), b = w.heightAt(x + dx, z + dz);
          rise = b - a;
          base = (a + b) / 2;
          if (Math.abs(rise) > 1.4 || Math.abs(base - y) > 0.23 || Math.min(a, b) < WATER_LEVEL - 0.18)
            continue;
        }
        props.push({ kind, seed, x, y: base, z, yaw, scale, rise });
      }
    return props;
  }

  // src/world/wilderness/chunk.ts
  var BAMBOO = { density: 0.75, maxSlope: 2.2, height: [7, 11], crown: [1.3, 2.1] };
  var PATH_ROOM = 2.5;
  function generateWildChunk(w, cx, cz) {
    const steps = generateWildChunkSteps(w, cx, cz);
    let next = steps.next();
    while (!next.done) next = steps.next();
    return next.value;
  }
  function* generateWildChunkSteps(w, cx, cz, isPeaceful) {
    const size = TUNING.world.chunkSize;
    const cell = TUNING.world.cellSize;
    const n = size / cell;
    const x0 = cx * size;
    const z0 = cz * size;
    yield* __yieldStar(pathsOf(w).prepare(x0 - 96, z0 - 96, x0 + size + 96, z0 + size + 96));
    const heights = new Float32Array(n * n);
    const biomes = new Uint8Array(n * n);
    let hasWater = false;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = x0 + (ix + 0.5) * cell;
        const z = z0 + (iz + 0.5) * cell;
        const h = w.heightAt(x, z);
        heights[iz * n + ix] = h;
        biomes[iz * n + ix] = w.biomeAt(x, z);
        if (h < WATER_LEVEL) hasWater = true;
      }
      yield;
    }
    const trees = [];
    const mid = { x: x0 + size / 2, z: z0 + size / 2 };
    yield* __yieldStar(prepareGroves(w, mid.x, mid.z, size * 0.75));
    const groves2 = grovesNear(w, mid.x, mid.z, size * 0.75);
    const seas2 = seasNear(w, mid.x, mid.z, size * 0.75);
    const at = (ix, iz) => ix >= 0 && iz >= 0 && ix < n && iz < n ? heights[iz * n + ix] : w.heightAt(x0 + (ix + 0.5) * cell, z0 + (iz + 0.5) * cell);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const biome = BIOMES[biomes[iz * n + ix]];
        const h = hashAt(w.seed, "tree", cx * n + ix, cz * n + iz);
        const cxz = { x: x0 + (ix + 0.5) * cell, z: z0 + (iz + 0.5) * cell };
        const grove = groves2.reduce((m, g) => Math.max(m, patchMask(g, cxz.x, cxz.z)), 0);
        const bamboo = grove > 0.2;
        if (unit(h) >= (bamboo ? BAMBOO.density * grove : biome.treeDensity)) continue;
        if (!bamboo && seas2.some((f) => patchMask(f, cxz.x, cxz.z) > 0.05)) continue;
        const y = heights[iz * n + ix];
        if (y < WATER_LEVEL + 0.5) continue;
        const slope = Math.max(
          Math.abs(at(ix + 1, iz) - y),
          Math.abs(at(ix - 1, iz) - y),
          Math.abs(at(ix, iz + 1) - y),
          Math.abs(at(ix, iz - 1) - y)
        );
        if (slope > (bamboo ? BAMBOO.maxSlope : biome.treeMaxSlope)) continue;
        const x = x0 + (ix + 0.2 + 0.6 * unit(bamboo ? hashInts(h, 3) : h >>> 3)) * cell;
        const z = z0 + (iz + 0.2 + 0.6 * unit(bamboo ? hashInts(h, 4) : h >>> 11)) * cell;
        if (Math.hypot(x, z) < 14) continue;
        if (w.townAt(x, z, TUNING.structures.townClearance)) continue;
        if (bamboo) {
          trees.push({
            x,
            z,
            y: w.heightAt(x, z) - 0.15,
            // taller in the heart of the grove, shorter shoots at its edge
            height: (BAMBOO.height[0] + (BAMBOO.height[1] - BAMBOO.height[0]) * unit(hashInts(h, 1))) * (0.6 + 0.4 * grove),
            crown: BAMBOO.crown[0] + (BAMBOO.crown[1] - BAMBOO.crown[0]) * unit(hashInts(h, 2)),
            color: color("cedar"),
            kind: "bamboo"
          });
          continue;
        }
        trees.push({
          x,
          z,
          // rooted a little into the slope where it actually stands
          y: w.heightAt(x, z) - 0.2,
          height: 4 + 5 * unit(h >>> 5),
          crown: 1.6 + 1.4 * unit(h >>> 17),
          color: biome.treeColor
        });
      }
      yield;
    }
    const { sources, ruins, great, springs: springs2, lookouts: lookouts2, marks, farmstead } = yield* __yieldStar(ruralSites(
      w,
      cx,
      cz,
      isPeaceful
    ));
    const paths = pathsOf(w);
    const offPath = (x, z) => paths.edgeDistance(x, z) > PATH_ROOM;
    const clearTrees = trees.filter(
      (t) => !sources.some((src) => Math.hypot(t.x - src.x, t.z - src.z) < 4) && !ruins.some((r) => Math.hypot(t.x - r.x, t.z - r.z) < 14) && !(great && Math.hypot(t.x - great.x, t.z - great.z) < GREAT.room) && !marks.some((m) => Math.hypot(t.x - m.x, t.z - m.z) < m.room) && !(farmstead && Math.abs(t.x - farmstead.x) < farmstead.hw + 2.5 && Math.abs(t.z - farmstead.z) < farmstead.hd + 2.5) && offPath(t.x, t.z)
    );
    if (great) clearTrees.push(great);
    const groundProps = groundPropsInChunk(
      w,
      cx,
      cz,
      clearTrees,
      (x, z) => !sources.some((p) => Math.hypot(x - p.x, z - p.z) < 8) && !ruins.some((p) => Math.hypot(x - p.x, z - p.z) < 18) && !marks.some((p) => Math.hypot(x - p.x, z - p.z) < p.room + 4) && !(farmstead && Math.abs(x - farmstead.x) < farmstead.hw + 5 && Math.abs(z - farmstead.z) < farmstead.hd + 5)
    );
    const bridges = [];
    const trails = paths.trailsNear(x0, z0, x0 + size, z0 + size);
    for (const t of trails)
      for (const b of t.bridges) {
        const mx = (b.x0 + b.x1) / 2;
        if (mx < x0 || mx >= x0 + size || b.z < z0 || b.z >= z0 + size) continue;
        const at2 = bridges.findIndex((o) => b.x0 === o.x0 && b.x1 === o.x1 && b.z === o.z);
        if (at2 < 0) bridges.push(b);
        else if (b.half > bridges[at2].half) bridges[at2] = b;
      }
    return {
      cx,
      cz,
      x0,
      z0,
      n,
      cell,
      heights,
      biomes,
      trees: clearTrees,
      groundProps,
      hasWater,
      sources,
      ruins,
      trails,
      bridges,
      springs: springs2,
      lookouts: lookouts2,
      farmstead
    };
  }
  function* ruralSites(w, cx, cz, isPeaceful) {
    const sources = sourcesInChunk(w, cx, cz);
    yield;
    const ruins = ruinsInChunk(w, cx, cz);
    yield;
    const great = greatTreeIn(w, cx, cz, sources, ruins);
    yield;
    yield* __yieldStar(prepareLandmarks(w, cx, cz));
    const springs2 = springsInChunk(w, cx, cz);
    const lookouts2 = lookoutsInChunk(w, cx, cz);
    const marks = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        yield* __yieldStar(prepareLandmarks(w, cx + dx, cz + dz));
        const size = TUNING.world.chunkSize;
        yield* __yieldStar(pathsOf(w).prepareGround(
          (cx + dx) * size - 4,
          (cz + dz) * size - 4,
          (cx + dx + 1) * size + 4,
          (cz + dz + 1) * size + 4
        ));
        for (const s of springsInChunk(w, cx + dx, cz + dz)) marks.push({ x: s.x, z: s.z, room: s.r + 5 });
        for (const l of lookoutsInChunk(w, cx + dx, cz + dz)) marks.push({ x: l.x, z: l.z, room: 7 });
        const well = inkWellInChunk(w, cx + dx, cz + dz);
        if (well) marks.push({ x: well.x, z: well.z, room: 6 });
        yield;
      }
    const farmstead = farmsteadInChunk(
      w,
      cx,
      cz,
      [
        ...marks,
        ...sources.map((p) => ({ x: p.x, z: p.z, room: 4 })),
        ...ruins.map((r) => ({ x: r.x, z: r.z, room: 16 })),
        ...great ? [{ x: great.x, z: great.z, room: GREAT.room }] : []
      ],
      isPeaceful
    );
    return { sources, ruins, great, springs: springs2, lookouts: lookouts2, marks, farmstead };
  }
  var GREAT = { chance: 0.35, height: [16, 22], crown: [8.5, 11.5], room: 14, steep: 1.6 };
  function greatTreeIn(w, cx, cz, sources = sourcesInChunk(w, cx, cz), ruins = ruinsInChunk(w, cx, cz)) {
    const size = TUNING.world.chunkSize;
    const h = hashAt(w.seed, "great-tree", cx, cz);
    if (unit(h) >= GREAT.chance) return null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = hashAt(w.seed, "great-tree-spot", cx, cz, attempt);
      const x = cx * size + 20 + unit(r) * (size - 40);
      const z = cz * size + 20 + unit(r >>> 7) * (size - 40);
      if (Math.hypot(x - size / 2, z - size / 2) < 70) continue;
      if (w.townAt(x, z, 30)) continue;
      if (sources.some((p) => Math.hypot(p.x - x, p.z - z) < GREAT.room)) continue;
      if (ruins.some((p) => Math.hypot(p.x - x, p.z - z) < GREAT.room + 10)) continue;
      if (grovesNear(w, x, z, 0).some((g) => patchMask(g, x, z) > 0)) continue;
      if (pathsOf(w).edgeDistance(x, z) < PATH_ROOM + 3) continue;
      const y = w.heightAt(x, z);
      if (y < WATER_LEVEL + 1.2) continue;
      let lo = y;
      let hi = y;
      for (const [dx, dz] of [
        [10, 0],
        [-10, 0],
        [0, 10],
        [0, -10]
      ]) {
        const g = w.heightAt(x + dx, z + dz);
        lo = Math.min(lo, g);
        hi = Math.max(hi, g);
        if (g < WATER_LEVEL + 0.5) lo = -Infinity;
      }
      if (hi - lo > GREAT.steep) continue;
      const t = hashAt(w.seed, "great-tree-size", cx, cz);
      return {
        x,
        z,
        y: y - 0.3,
        height: GREAT.height[0] + unit(t) * (GREAT.height[1] - GREAT.height[0]),
        crown: GREAT.crown[0] + unit(t >>> 9) * (GREAT.crown[1] - GREAT.crown[0]),
        color: unit(t >>> 3) < 0.5 ? color("leaf") : color("canopy"),
        kind: "great"
      };
    }
    return null;
  }

  // src/world/arena/site.ts
  var CANDIDATES = 4e3;
  var GOLDEN = Math.PI * (3 - Math.sqrt(5));
  var SAMPLE = 3;
  function chunksAround(x, z, r) {
    const size = TUNING.world.chunkSize;
    const out = [];
    for (let cx = Math.floor((x - r) / size); cx <= Math.floor((x + r) / size); cx++)
      for (let cz = Math.floor((z - r) / size); cz <= Math.floor((z + r) / size); cz++) out.push([cx, cz]);
    return out;
  }
  function suits(w, x, z) {
    const r = ARENA.radius;
    if (w.entrancesNear(x, z, 2).some((e) => townDistance(e, x, z) < ARENA.townClear)) return "no";
    let lo = Infinity;
    let hi = -Infinity;
    const n = Math.ceil(r / SAMPLE);
    const heights = /* @__PURE__ */ new Map();
    for (let i = -n; i <= n; i++)
      for (let k = -n; k <= n; k++) {
        if (Math.hypot(i, k) * SAMPLE > r + SAMPLE) continue;
        const h = w.terrainHeightAt(x + i * SAMPLE, z + k * SAMPLE);
        if (h < WATER_LEVEL + 0.8) return "no";
        heights.set(`${i},${k}`, h);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    for (const [cx, cz] of chunksAround(x, z, r + 20))
      if (ruinsInChunk(w, cx, cz).some((ruin) => Math.hypot(ruin.x - x, ruin.z - z) < r + 20)) return "no";
    if (hi - lo < ARENA.minRelief || hi - lo > ARENA.maxRelief) return "dry";
    for (const [key, h] of heights) {
      const [i, k] = key.split(",").map(Number);
      for (const [di, dk] of [
        [1, 0],
        [0, 1]
      ]) {
        const next = heights.get(`${i + di},${k + dk}`);
        if (next !== void 0 && Math.abs(next - h) > ARENA.maxStep * (SAMPLE / 6)) return "dry";
      }
    }
    return "good";
  }
  function treesInside(w, x, z, r) {
    return chunksAround(x, z, r).flatMap(
      ([cx, cz]) => generateWildChunk(w, cx, cz).trees.filter((t) => Math.hypot(t.x - x, t.z - z) < r - 1)
    );
  }
  function groundUnder(w, x0, z0, x1, z1) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = x0; x <= x1 + 0.01; x += Math.max(0.5, (x1 - x0) / 4))
      for (let z = z0; z <= z1 + 0.01; z += Math.max(0.5, (z1 - z0) / 4)) {
        const h = w.heightAt(x, z);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    return [lo, hi];
  }
  function arenaAt(w, x, z) {
    const cover = ARENA_COVER.map((c) => {
      const x0 = x + c.dx - c.w / 2;
      const x1 = x + c.dx + c.w / 2;
      const z0 = z + c.dz - c.d / 2;
      const z1 = z + c.dz + c.d / 2;
      const [lo, hi] = groundUnder(w, x0, z0, x1, z1);
      return { min: { x: x0, y: lo - 0.4, z: z0 }, max: { x: x1, y: hi + c.h, z: z1 } };
    });
    const trunks = treesInside(w, x, z, ARENA.radius).map((t) => ({
      // the same trunk the physics uses (systems/wilderness/build-chunk.ts addChunkColliders)
      min: { x: t.x - 0.3, y: t.y, z: t.z - 0.3 },
      max: { x: t.x + 0.3, y: t.y + t.height * 0.6, z: t.z + 0.3 }
    }));
    const blocked = (px, pz) => [...cover, ...trunks].some(
      (b) => px > b.min.x - 1 && px < b.max.x + 1 && pz > b.min.z - 1 && pz < b.max.z + 1
    );
    const spawns = [];
    for (let i = 0; i < ARENA.spawns; i++) {
      for (let step = 0; step < 12; step++) {
        const a = (i + step * 0.07) / ARENA.spawns * Math.PI * 2;
        const px = x + Math.cos(a) * ARENA.spawnRing;
        const pz = z + Math.sin(a) * ARENA.spawnRing;
        if (blocked(px, pz) && step < 11) continue;
        spawns.push({ x: px, y: w.heightAt(px, pz), z: pz, yaw: Math.atan2(px - x, pz - z) });
        break;
      }
    }
    return { x, z, radius: ARENA.radius, cover, trunks, spawns };
  }
  var found = /* @__PURE__ */ new WeakMap();
  function findArenaSite(w) {
    const known = found.get(w);
    if (known) return known;
    let fallback = null;
    let site = null;
    for (let i = 0; i < CANDIDATES && !site; i++) {
      const d = ARENA.nearest + (ARENA.farthest - ARENA.nearest) * (i * 0.618034 % 1);
      const a = i * GOLDEN;
      const x = Math.round(Math.cos(a) * d);
      const z = Math.round(Math.sin(a) * d);
      const fit = suits(w, x, z);
      if (fit === "no") continue;
      if (fit === "dry" || treesInside(w, x, z, ARENA.radius).length < ARENA.minTrees) {
        fallback != null ? fallback : fallback = [x, z];
        continue;
      }
      site = arenaAt(w, x, z);
    }
    site != null ? site : site = arenaAt(w, ...fallback != null ? fallback : [ARENA.nearest, 0]);
    found.set(w, site);
    return site;
  }

  // src/world/net/validate.ts
  var MAX_INDEX = 1e5;
  var MAX_AMOUNT = 1e5;
  var MAX_COORD = 1e6;
  var CITY = /^c-?\d{1,6}_-?\d{1,6}$/;
  var WILD_ID = /^-?\d{1,6},-?\d{1,6}:\d{1,4}$/;
  var RUIN_ID = /^r-?\d{1,5}_-?\d{1,5}$/;
  var MARK_ID = /^[\w-]{1,24}$/;
  var WELL_ID = /^w-?\d{1,6}_-?\d{1,6}$/;
  var PERSON_ID = /^(resident|outing|traveller):[\w,:.-]{1,100}$/;
  var isIndex = (v, max = MAX_INDEX) => Number.isInteger(v) && v >= 0 && v < max;
  var isCoord = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_COORD;
  var isAmount = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_AMOUNT;
  function validScene(v) {
    const s = v;
    if ((s == null ? void 0 : s.kind) === "wild") return { kind: "wild" };
    if ((s == null ? void 0 : s.kind) === "city" && typeof s.id === "string" && CITY.test(s.id)) return { kind: "city", id: s.id };
    return null;
  }
  var validCity = (v) => typeof v === "string" && CITY.test(v);
  function placeOf(patch) {
    if (patch.kind === "infectNpc" || patch.kind === "overrun") return patch.site;
    if (patch.kind === "death" && patch.inkMonster) return patch;
    const size = TUNING.world.chunkSize;
    const chunk = (cx, cz) => ({
      x: (Number(cx) + 0.5) * size,
      z: (Number(cz) + 0.5) * size
    });
    if ("city" in patch) {
      const m = /^c(-?\d+)_(-?\d+)$/.exec(patch.city);
      return m ? chunk(m[1], m[2]) : null;
    }
    const wild = patch.kind === "harvest" ? patch.source : patch.kind === "hunt" ? patch.monster : null;
    if (wild) {
      const m = /^(-?\d+),(-?\d+):/.exec(wild);
      return m ? chunk(m[1], m[2]) : null;
    }
    if (patch.kind === "cleanse") {
      const m = /^w(-?\d+)_(-?\d+)$/.exec(patch.well);
      return m ? chunk(m[1], m[2]) : null;
    }
    if (patch.kind === "discover") {
      const m = /^r(-?\d+)_(-?\d+)$/.exec(patch.ruin);
      const span = TUNING.structures.ruinGrid * size;
      return m ? { x: (Number(m[1]) + 0.5) * span, z: (Number(m[2]) + 0.5) * span } : null;
    }
    return null;
  }
  function validPatch(raw) {
    const p = raw;
    if (!p || typeof p !== "object") return null;
    switch (p.kind) {
      case "restore":
      case "drain":
        return validCity(p.city) && isIndex(p.surface) ? { kind: p.kind, city: p.city, surface: p.surface } : null;
      case "paint":
        return validCity(p.city) && isIndex(p.surface) && isIndex(p.color, PALETTE.length) && PALETTE[p.color].paintable ? { kind: "paint", city: p.city, surface: p.surface, color: p.color } : null;
      case "collect":
        return validCity(p.city) && isIndex(p.stain) ? { kind: "collect", city: p.city, stain: p.stain } : null;
      case "refine":
      case "collectStock":
        return validCity(p.city) && isIndex(p.studio) ? { kind: p.kind, city: p.city, studio: p.studio } : null;
      case "defeat":
        return validCity(p.city) && isIndex(p.monster) ? __spreadValues({
          kind: "defeat",
          city: p.city,
          monster: p.monster
        }, p.npc === true ? { npc: true } : {}) : null;
      case "defeatAltarGuard":
        return validCity(p.city) && isIndex(p.guard, 3) ? __spreadValues({ kind: "defeatAltarGuard", city: p.city, guard: p.guard }, p.npc === true ? { npc: true } : {}) : null;
      case "restoreAltar":
      case "complete":
      case "tideHeld":
        return validCity(p.city) ? { kind: p.kind, city: p.city } : null;
      case "harvest":
        return typeof p.source === "string" && WILD_ID.test(p.source) ? { kind: "harvest", source: p.source } : null;
      case "hunt":
        return typeof p.monster === "string" && WILD_ID.test(p.monster) ? __spreadValues({ kind: "hunt", monster: p.monster }, p.npc === true ? { npc: true } : {}) : null;
      case "cleanse":
        return typeof p.well === "string" && WELL_ID.test(p.well) ? { kind: "cleanse", well: p.well } : null;
      case "discover":
        return typeof p.ruin === "string" && RUIN_ID.test(p.ruin) ? { kind: "discover", ruin: p.ruin } : null;
      case "defeatInfected":
        return typeof p.person === "string" && PERSON_ID.test(p.person) ? { kind: "defeatInfected", person: p.person } : null;
      case "infectNpc":
      case "overrun": {
        if (!validInkSite(p.site) || typeof p.person !== "string" || !(PERSON_ID.test(p.person) || p.kind === "overrun" && p.person === "player")) return null;
        const { x, y, z, scene } = p.site;
        if (!validScene(scene)) return null;
        return { kind: p.kind, person: p.person, site: { x, y, z, scene: validScene(scene) } };
      }
      case "death": {
        const scene = validScene(p.scene);
        return scene && isCoord(p.x) && isCoord(p.y) && isCoord(p.z) ? __spreadValues({ kind: "death", scene, x: p.x, y: p.y, z: p.z }, p.inkMonster === true ? { inkMonster: true } : {}) : null;
      }
      case "recover":
        return { kind: "recover" };
      case "mark":
        return isCoord(p.x) && isCoord(p.y) && isCoord(p.z) ? { kind: "mark", x: p.x, y: p.y, z: p.z } : null;
      case "unmark":
        return typeof p.id === "string" && MARK_ID.test(p.id) ? { kind: "unmark", id: p.id } : null;
      case "assign":
        return ATTRIBUTES.some((a) => a.key === p.attr) ? { kind: "assign", attr: p.attr } : null;
      case "upgrade":
        return p.tool === "brush" ? { kind: "upgrade", tool: "brush" } : null;
      case "spend": {
        const generic = p.generic === void 0 ? 0 : p.generic;
        const ink = p.ink === void 0 ? 0 : p.ink;
        return isAmount(generic) && isAmount(ink) ? { kind: "spend", generic, ink } : null;
      }
      // 'grant' hands things out without earning them: never from a client
      default:
        return null;
    }
  }

  // src/world/net/protocol.ts
  var PROTOCOL = 13;
  var DEFAULT_MAX_PLAYERS = 10;
  var VIEW_RANGE = 300;
  var GLIDING = 2;
  var SWIMMING = 4;
  var FLYING = 64;
  var DOWNED = 128;
  var INFECTED = 256;
  var CLIENT_FLAGS = 255;
  var HELD_ITEMS = ["brush", ...WEAPONS.map((w) => w.key)];
  function validRest(value) {
    if (!value || typeof value !== "object") return null;
    const r = value;
    if (![r.sitting, r.lying, r.groundPitch, r.groundRoll, r.yaw].every(finite) || r.sitting < 0 || r.lying < 0 || r.sitting + r.lying > 1.000001 || Math.abs(r.groundPitch) > 0.6 || Math.abs(r.groundRoll) > 0.6)
      return null;
    return {
      sitting: r.sitting,
      lying: r.lying,
      groundPitch: r.groundPitch,
      groundRoll: r.groundRoll,
      yaw: r.yaw % (Math.PI * 2)
    };
  }
  var ROOM_CODE = /^[A-F0-9]{6}$/;
  var WEAPON_ACTS = {
    rifle: ["shot", "shield"],
    katana: ["strike", "slash"],
    sniper: ["shot", "focus"],
    launcher: ["shell", "bigshell"],
    staff: ["shot", "field"]
  };
  var SHARED_KINDS = /* @__PURE__ */ new Set([
    "restore",
    "paint",
    "drain",
    "collect",
    "harvest",
    "defeat",
    "defeatAltarGuard",
    "restoreAltar",
    "hunt",
    "cleanse",
    "infectNpc",
    "defeatInfected",
    "overrun",
    "collectStock",
    "complete"
  ]);
  var finite = (v) => typeof v === "number" && Number.isFinite(v);
  var MAX_COORD2 = 1e6;
  var MAX_SPEED = 500;
  function vec3(v, limit) {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((x2) => finite(x2) && Math.abs(x2) <= limit)) return null;
    const [x, y, z] = v;
    return [x, y, z];
  }
  function parseClientMessage(text) {
    var _a2;
    if (text.length > 16e3) return null;
    let m;
    try {
      m = JSON.parse(text);
    } catch (e) {
      return null;
    }
    if (!m || typeof m !== "object") return null;
    switch (m.t) {
      case "profile": {
        const look = validLook(m.look);
        return look ? { t: "profile", name: cleanName(m.name), look } : null;
      }
      case "traveller":
        return typeof m.trail === "string" && /^[a-z0-9_:-]{1,80}$/.test(m.trail) ? { t: "traveller", trail: m.trail } : null;
      case "listRooms":
        return finite(m.v) && typeof m.password === "string" && m.password.length <= 128 ? { t: "listRooms", v: m.v, password: m.password } : null;
      case "visit":
        return Number.isSafeInteger(m.target) && Number(m.target) > 0 && Number.isSafeInteger(m.request) && Number(m.request) > 0 ? { t: "visit", target: Number(m.target), request: Number(m.request) } : null;
      case "hello": {
        const look = validLook(m.look);
        if (!finite(m.v) || typeof m.token !== "string" || !/^[\w-]{8,64}$/.test(m.token) || !look) return null;
        const password = typeof m.password === "string" ? m.password.slice(0, 128) : "";
        if (m.room !== void 0) {
          const room = m.room;
          if (!room || room.action !== "create" && !(room.action === "join" && typeof room.code === "string" && ROOM_CODE.test(room.code)))
            return null;
          if (m.roomPassword !== void 0 && (typeof m.roomPassword !== "string" || m.roomPassword.length > 128))
            return null;
          return {
            t: "hello",
            v: m.v,
            token: m.token,
            name: cleanName(m.name),
            look,
            password,
            room: room.action === "create" ? { action: "create" } : { action: "join", code: room.code },
            roomPassword: m.roomPassword
          };
        }
        return { t: "hello", v: m.v, token: m.token, name: cleanName(m.name), look, password };
      }
      case "move": {
        const p = vec3(m.p, MAX_COORD2);
        const v = vec3(m.v, MAX_SPEED);
        const s = validScene(m.scene);
        if (!p || !v || !s || !finite(m.yaw) || !finite(m.pitch) || !finite(m.f)) return null;
        const h = m.h === void 0 || m.h === null ? void 0 : HELD_ITEMS.find((x) => x === m.h);
        if (h === void 0 && m.h !== void 0 && m.h !== null) return null;
        const town = validCity(m.town) ? m.town : null;
        const pitch = Math.max(-1.6, Math.min(1.6, m.pitch));
        const rest = m.rest === void 0 ? null : validRest(m.rest);
        if (m.rest !== void 0 && !rest) return null;
        const move = __spreadValues({
          t: "move",
          p,
          v,
          yaw: m.yaw % (Math.PI * 2),
          pitch,
          f: m.f & CLIENT_FLAGS,
          scene: s,
          town
        }, rest && !(m.f & (FLYING | GLIDING | SWIMMING | DOWNED)) ? { rest } : {});
        return h ? __spreadProps(__spreadValues({}, move), { h }) : move;
      }
      case "gesture":
        return m.g === "attack" || m.g === "skill" ? { t: "gesture", g: m.g } : null;
      case "patch": {
        const patch = validPatch(m.patch);
        return finite(m.seq) && patch ? { t: "patch", seq: m.seq, patch } : null;
      }
      case "arena": {
        if (m.a !== "join" && m.a !== "leave" && m.a !== "vote") return null;
        if (m.a !== "vote") return { t: "arena", a: m.a };
        return m.mode === "ffa" || m.mode === "teams" ? { t: "arena", a: "vote", mode: m.mode } : null;
      }
      case "act": {
        const w = (_a2 = WEAPONS.find((x) => x.key === m.w)) == null ? void 0 : _a2.key;
        const o = vec3(m.o, MAX_COORD2);
        const d = vec3(m.d, 2);
        if (!w || !o || !d || !finite(m.at) || !WEAPON_ACTS[w].includes(m.k)) return null;
        const len = Math.hypot(d[0], d[1], d[2]);
        if (len < 0.5) return null;
        const unit3 = [d[0] / len, d[1] / len, d[2] / len];
        return { t: "act", w, k: m.k, o, d: unit3, at: m.at };
      }
      default:
        return null;
    }
  }

  // src/world/net/arena-host.ts
  var TRACK_SECONDS = 1;
  var EYE = 1.65;
  var FIELD_REACH = 42;
  var RATE_SLACK = 0.7;
  var vec = (v) => ({ x: v[0], y: v[1], z: v[2] });
  var arr = (v) => [v.x, v.y, v.z];
  var ArenaHost = class {
    constructor(wilderness, clock) {
      __publicField(this, "wilderness", wilderness);
      __publicField(this, "clock", clock);
      __publicField(this, "siteCache", null);
      __publicField(this, "matchCache", null);
      __publicField(this, "tracks", /* @__PURE__ */ new Map());
      __publicField(this, "fields", []);
    }
    /** Worked out the first time anyone comes to the arena (a search of a few milliseconds). */
    get site() {
      var _a2;
      return (_a2 = this.siteCache) != null ? _a2 : this.siteCache = findArenaSite(this.wilderness);
    }
    get match() {
      var _a2;
      return (_a2 = this.matchCache) != null ? _a2 : this.matchCache = new ArenaMatch(this.site, (id) => this.latest(id));
    }
    get solid() {
      return {
        heightAt: (x, z) => this.wilderness.heightAt(x, z),
        boxes: [...this.site.cover, ...this.site.trunks]
      };
    }
    /** Whether anyone has come to the arena since the server started. */
    get started() {
      return this.matchCache !== null;
    }
    has(id) {
      var _a2, _b;
      return (_b = (_a2 = this.matchCache) == null ? void 0 : _a2.has(id)) != null ? _b : false;
    }
    /** The arena as everyone is told it. */
    stateMessage() {
      return { t: "arena", state: this.match.state(this.clock()) };
    }
    join(id) {
      return this.send(this.match.join(id, this.clock()));
    }
    leave(id) {
      this.tracks.delete(id);
      this.fields = this.fields.filter((f) => f.owner !== id);
      return this.matchCache ? this.send(this.match.leave(id)) : [];
    }
    vote(id, mode) {
      return this.matchCache ? this.send(this.match.vote(id, mode)) : [];
    }
    /** Where a player in the arena stands now (feet). */
    track(id, p) {
      var _a2;
      if (!this.has(id)) return;
      const now = this.clock();
      const t = (_a2 = this.tracks.get(id)) != null ? _a2 : [];
      t.push({ t: now, p: vec(p) });
      while (t.length > 2 && t[0].t < now - TRACK_SECONDS) t.shift();
      this.tracks.set(id, t);
    }
    latest(id) {
      const t = this.tracks.get(id);
      return (t == null ? void 0 : t.length) ? t[t.length - 1].p : null;
    }
    tick() {
      if (!this.matchCache) return [];
      const now = this.clock();
      const events = this.match.tick(now);
      for (const f of this.fields) {
        if (now < f.next) continue;
        f.next += ARENA.field.every;
        const targets = this.targets(f.owner, now, now);
        for (const h of inBlast(this.solid, f.at, ARENA.field.radius, targets))
          events.push(...this.match.damage(f.owner, h.id, ARENA.field.damage * h.share, false, "staff", now));
      }
      this.fields = this.fields.filter((f) => f.until > now && this.match.has(f.owner));
      return this.send(events);
    }
    /** The others `id` may hurt, where they stood at time t. */
    targets(id, now, t) {
      var _a2;
      const out = [];
      for (const target of this.match.targetsFor(id, now)) {
        const p = positionAt((_a2 = this.tracks.get(target)) != null ? _a2 : [], t);
        if (p) out.push({ id: target, p });
      }
      return out;
    }
    /** A player's attack or skill. */
    act(id, a) {
      if (!this.has(id)) return [];
      const now = this.clock();
      const def = WEAPONS.find((x) => x.key === a.w);
      const me = this.latest(id);
      if (!me) return [];
      const o = vec(a.o);
      const d = vec(a.d);
      if (Math.hypot(o.x - me.x, o.y - (me.y + EYE), o.z - me.z) > ARENA.reach) return [];
      if (Math.hypot(me.x - this.site.x, me.z - this.site.z) > this.site.radius + 2) return [];
      const skill = WEAPON_ACTS[a.w][1] === a.k;
      const gap = skill ? def.skill.cooldown : def.interval;
      if (!this.match.allow(id, skill ? `skill:${a.w}` : a.w, gap * RATE_SLACK, now)) return [];
      const events = [];
      const t = judgedAt(now, a.at);
      const targets = this.targets(id, now, t);
      const hurt = (to, amount, head = false) => {
        events.push(...this.match.damage(id, to, amount, head, a.w, now));
      };
      switch (a.k) {
        case "shot": {
          const hit = traceShot(this.solid, o, d, def.range, targets);
          if (!hit) break;
          const focus = a.w === "sniper" && this.match.focused(id, now) ? ARENA.focus.multiplier : 1;
          hurt(hit.id, def.pvp.damage * (hit.head ? def.pvp.head : 1) * focus, hit.head);
          break;
        }
        case "strike":
          for (const to of inArc(this.solid, o, d, def.range, def.area, targets)) hurt(to, def.pvp.damage);
          break;
        case "slash": {
          const flat = Math.hypot(d.x, d.z) || 1;
          const along = { x: d.x / flat, y: 0, z: d.z / flat };
          const S4 = ARENA.slash;
          for (const to of inArc(this.solid, o, along, S4.range, S4.halfAngle, targets)) hurt(to, S4.damage);
          break;
        }
        case "shell":
        case "bigshell": {
          const big = a.k === "bigshell";
          const at = shellBurst(this.solid, o, d, targets);
          const area = big ? ARENA.bigShell.area : def.area;
          const damage = big ? ARENA.bigShell.damage : def.pvp.damage;
          for (const h of inBlast(this.solid, at, area, targets)) hurt(h.id, damage * h.share);
          break;
        }
        case "field":
          if (Math.hypot(o.x - me.x, o.z - me.z) <= FIELD_REACH)
            this.fields.push({ owner: id, at: o, until: now + ARENA.field.seconds, next: now });
          break;
        case "shield":
          this.match.shield(id, now);
          break;
        case "focus":
          this.match.focus(id, now);
          break;
      }
      const seen = { to: "arena", m: { t: "act", from: id, w: a.w, k: a.k, o: a.o, d: a.d } };
      return [seen, ...this.send(events)];
    }
    /** Arena members, for sending `to: 'arena'` messages. */
    members() {
      return this.matchCache ? this.match.state(this.clock()).members.map((m) => m.id) : [];
    }
    send(events) {
      const out = [];
      let state = false;
      for (const e of events)
        switch (e.kind) {
          case "hit":
            out.push({
              to: "arena",
              m: { t: "hit", from: e.from, to: e.to, amount: e.amount, head: e.head, hp: e.hp }
            });
            break;
          case "down":
            out.push({ to: "arena", m: { t: "down", who: e.who, by: e.by, w: e.w } });
            break;
          case "spawn":
            this.tracks.set(e.who, [{ t: this.clock(), p: e.p }]);
            out.push({ to: "arena", m: { t: "spawn", who: e.who, p: arr(e.p), yaw: e.yaw } });
            break;
          case "state":
            state = true;
            break;
        }
      if (state) out.push({ to: "all", m: this.stateMessage() });
      return out;
    }
  };

  // src/world/city/streets.ts
  var BUCKET2 = 16;
  var bucketKey = (bx, bz) => bz * 4096 + bx;
  var NEIGHBOURS = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2]
  ];
  function smooth(points, rounds) {
    let p = points.slice();
    for (let r = 0; r < rounds && p.length > 2; r++) {
      const out = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i];
        const b = p[i + 1];
        if (i > 0) out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
        if (i < p.length - 2) out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
      }
      out.push(p[p.length - 1]);
      p = out;
    }
    return p;
  }
  function layStreets(site, gates, gateCell, square, sq) {
    const cfg = TUNING.city;
    const { n, cell, rng, idx, inside, water, slope, centreOf } = site;
    const sqx = sq % n;
    const sqz = (sq - sqx) / n;
    const roads = new Uint8Array(n * n);
    const wander = createNoise2D(hashInts(site.seed, 39550));
    const cost = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++)
      for (let ix = 0; ix < n; ix++) {
        const i = idx(ix, iz);
        const s = slope[i];
        cost[i] = inside(ix, iz) || gateCell[i] ? 1 + cfg.climbCost * s * s + cfg.wander * (0.5 + 0.5 * wander(ix / 9, iz / 9)) + (water[i] ? cfg.bridgeCost : 0) : Infinity;
      }
    const g = new Float32Array(n * n);
    const came = new Int32Array(n * n);
    const cheapest = (from, done, to) => {
      const tx = to % n;
      const tz = (to - tx) / n;
      g.fill(Infinity);
      came.fill(-1);
      const open2 = new Heap();
      g[from] = 0;
      open2.push(from, 0);
      while (open2.size) {
        const i = open2.pop();
        if (done(i)) {
          const path = [i];
          for (let k = i; k !== from; ) path.push(k = came[k]);
          return path.reverse();
        }
        const x = i % n;
        const z = (i - x) / n;
        for (const [dx, dz, len] of NEIGHBOURS) {
          const x2 = x + dx;
          const z2 = z + dz;
          if (x2 < 0 || z2 < 0 || x2 >= n || z2 >= n) continue;
          const j = idx(x2, z2);
          const step = (cost[i] + cost[j]) / 2 * len;
          if (!Number.isFinite(step) || g[i] + step >= g[j]) continue;
          g[j] = g[i] + step;
          came[j] = i;
          open2.push(j, g[j] + cfg.reuse * Math.hypot(x2 - tx, z2 - tz));
        }
      }
      return null;
    };
    const streets = [];
    const roadCells = [];
    const segments = /* @__PURE__ */ new Map();
    const lay = (points, cls, width) => {
      streets.push({ cls, width, points });
      for (let k = 0; k < points.length; k++) {
        const a = points[k];
        const b = points[Math.min(k + 1, points.length - 1)];
        const seg = { a, b, half: width / 2 };
        for (let bz = Math.floor(Math.min(a.z, b.z) / BUCKET2); bz <= Math.floor(Math.max(a.z, b.z) / BUCKET2); bz++)
          for (let bx = Math.floor(Math.min(a.x, b.x) / BUCKET2); bx <= Math.floor(Math.max(a.x, b.x) / BUCKET2); bx++) {
            const key = bucketKey(bx, bz);
            let list = segments.get(key);
            if (!list) segments.set(key, list = []);
            list.push(seg);
          }
      }
      const r = Math.max(width / 2 + 0.8, 3);
      for (let k = 0; k < Math.max(1, points.length - 1); k++) {
        const a = points[k];
        const b = points[Math.min(k + 1, points.length - 1)];
        const ix0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r) / cell));
        const ix1 = Math.min(n - 1, Math.floor((Math.max(a.x, b.x) + r) / cell));
        const iz0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - r) / cell));
        const iz1 = Math.min(n - 1, Math.floor((Math.max(a.z, b.z) + r) / cell));
        const ux = b.x - a.x;
        const uz = b.z - a.z;
        const len2 = ux * ux + uz * uz || 1;
        for (let iz = iz0; iz <= iz1; iz++)
          for (let ix = ix0; ix <= ix1; ix++) {
            const i = idx(ix, iz);
            if (!inside(ix, iz) && !gateCell[i]) continue;
            const cx = (ix + 0.5) * cell;
            const cz = (iz + 0.5) * cell;
            const t = Math.max(0, Math.min(1, ((cx - a.x) * ux + (cz - a.z) * uz) / len2));
            if (Math.hypot(cx - a.x - ux * t, cz - a.z - uz * t) > r) continue;
            if (roads[i] === ROAD_NONE) roadCells.push(i);
            if (roads[i] < cls) roads[i] = cls;
            cost[i] = Math.min(cost[i], cfg.reuse);
          }
      }
    };
    lay([square], ROAD_MAIN, cfg.square * 2);
    for (const gate of gates) {
      const start = idx(gate.ix + DX[gate.dir] * 3, gate.iz + DZ[gate.dir] * 3);
      const path = cheapest(start, (i) => i === sq, sq);
      if (!path) continue;
      const outside = {
        x: (gate.ix + 0.5 - DX[gate.dir] * 0.5) * cell,
        z: (gate.iz + 0.5 - DZ[gate.dir] * 0.5) * cell
      };
      const cells = [
        outside,
        centreOf(idx(gate.ix + DX[gate.dir], gate.iz + DZ[gate.dir])),
        ...path.map(centreOf)
      ];
      lay(smooth(cells, 2), ROAD_MAIN, cfg.streets.main);
    }
    const spacing = cfg.reachSpacing / cell;
    const reaches = [];
    for (let tries = 0; tries < n * n * 3 / (spacing * spacing); tries++) {
      const ix = rng.int(3, n - 4);
      const iz = rng.int(3, n - 4);
      const i = idx(ix, iz);
      if (slope[i] > 0.4 || site.nearWater(ix, iz, 2)) continue;
      if (reaches.some((j) => Math.hypot(j % n - ix, Math.floor(j / n) - iz) < spacing)) continue;
      reaches.push(i);
    }
    const fromSquare = (i) => Math.hypot(i % n - sqx, Math.floor(i / n) - sqz);
    reaches.sort((a, b) => fromSquare(a) - fromSquare(b));
    for (const target of reaches) {
      const tx = target % n;
      const tz = (target - tx) / n;
      let near2 = -1;
      let nearD = Infinity;
      for (const r of roadCells) {
        const d = Math.hypot(r % n - tx, Math.floor(r / n) - tz);
        if (d < nearD) {
          nearD = d;
          near2 = r;
        }
      }
      if (near2 < 0 || nearD < 4.5) continue;
      const path = cheapest(target, (i) => roads[i] !== ROAD_NONE, near2);
      if (!path || path.length < 3) continue;
      const long = path.length >= 16;
      lay(
        smooth(path.reverse().map(centreOf), 2),
        long ? ROAD_SIDE : ROAD_ALLEY,
        long ? cfg.streets.side : cfg.streets.lane
      );
    }
    return { roads, streets, segments };
  }

  // src/world/city/houses.ts
  var GARDEN_MIN = 1.1;
  function rectsOverlap(a, b) {
    const corners = (r) => {
      const c = Math.cos(r.angle);
      const s = Math.sin(r.angle);
      return [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1]
      ].map(([u, v]) => ({ x: r.x + c * u * r.hw + s * v * r.hd, z: r.z - s * u * r.hw + c * v * r.hd }));
    };
    const ca = corners(a);
    const cb = corners(b);
    for (const r of [a, b]) {
      const c = Math.cos(r.angle);
      const s = Math.sin(r.angle);
      for (const [ax, az] of [
        [c, -s],
        [s, c]
      ]) {
        const span = (pts) => {
          const d = pts.map((p) => p.x * ax + p.z * az);
          return [Math.min(...d), Math.max(...d)];
        };
        const [a0, a1] = span(ca);
        const [b0, b1] = span(cb);
        if (a1 <= b0 || b1 <= a0) return false;
      }
    }
    return true;
  }
  function placeHouses(site, plan, square) {
    const cfg = TUNING.city;
    const H = cfg.houses;
    const { n, cell, size, rng, idx, inside, water, ground } = site;
    const { roads, streets, segments } = plan;
    const buildingOf = new Uint16Array(n * n);
    const buildings = [];
    const pickTemplate = (centrality) => {
      const weight = (t) => {
        const key = BUILDINGS[t].key;
        return BUILDINGS[t].weight * (key === "barn" ? 1.6 - centrality : key === "shop" ? 0.4 + centrality : 1);
      };
      const weights = BUILDINGS.map((_, t) => weight(t));
      let r = rng.next() * weights.reduce((a, b) => a + b, 0);
      for (let t = 0; t < BUILDINGS.length; t++) if ((r -= weights[t]) <= 0) return t;
      return 0;
    };
    const range = (r) => r[0] + (r[1] - r[0]) * rng.next();
    const cellsUnder = (x, z, angle, hw, hd, margin) => {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const ex = Math.abs(c) * (hw + margin) + Math.abs(s) * (hd + margin);
      const ez = Math.abs(s) * (hw + margin) + Math.abs(c) * (hd + margin);
      const out = [];
      for (let iz = Math.floor((z - ez) / cell); iz <= Math.floor((z + ez) / cell); iz++)
        for (let ix = Math.floor((x - ex) / cell); ix <= Math.floor((x + ex) / cell); ix++) {
          const dx = (ix + 0.5) * cell - x;
          const dz = (iz + 0.5) * cell - z;
          const lx = dx * c - dz * s;
          const lz = dx * s + dz * c;
          if (Math.abs(lx) > hw + margin || Math.abs(lz) > hd + margin) continue;
          out.push(ix < 0 || iz < 0 || ix >= n || iz >= n ? -1 : idx(ix, iz));
        }
      return out;
    };
    const placed = /* @__PURE__ */ new Map();
    const clearOfHouses = (x, z, angle, hw, hd, gap) => {
      var _a2;
      const reach = 2 * (Math.hypot(hw, hd) + 12);
      for (let bz = Math.floor((z - reach) / BUCKET2); bz <= Math.floor((z + reach) / BUCKET2); bz++)
        for (let bx = Math.floor((x - reach) / BUCKET2); bx <= Math.floor((x + reach) / BUCKET2); bx++)
          for (const o of (_a2 = placed.get(bucketKey(bx, bz))) != null ? _a2 : [])
            if (rectsOverlap({ x, z, angle, hw: hw + gap, hd: hd + gap }, o)) return false;
      return true;
    };
    const clearOfStreets = (x, z, c, s, hw, hd) => {
      var _a2;
      const reach = Math.hypot(hw, hd) + cfg.square;
      const local = (p) => ({
        x: (p.x - x) * c - (p.z - z) * s,
        z: (p.x - x) * s + (p.z - z) * c
      });
      for (let bz = Math.floor((z - reach) / BUCKET2); bz <= Math.floor((z + reach) / BUCKET2); bz++)
        for (let bx = Math.floor((x - reach) / BUCKET2); bx <= Math.floor((x + reach) / BUCKET2); bx++)
          for (const seg of (_a2 = segments.get(bucketKey(bx, bz))) != null ? _a2 : []) {
            const a = local(seg.a);
            const b = local(seg.b);
            const ex = hw + seg.half + 0.5;
            const ez = hd + seg.half + 0.5;
            const len = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
            for (let k = 0; k <= len; k++) {
              const px = a.x + (b.x - a.x) * k / len;
              const pz = a.z + (b.z - a.z) * k / len;
              if (Math.abs(px) < ex && Math.abs(pz) < ez) return false;
            }
          }
      return true;
    };
    const tryHouse = (p, out, roadHalf) => {
      const fromSq = Math.min(1, Math.hypot(p.x - square.x, p.z - square.z) / (size * 0.6));
      if (!rng.chance(H.density[0] + (H.density[1] - H.density[0]) * fromSq)) return 0;
      const t = pickTemplate(1 - fromSq);
      const tpl = BUILDINGS[t];
      const scale = tpl.key === "barn" ? 1.3 : tpl.key === "shop" ? 1.1 : 1;
      const hw = range(H.width) * scale / 2;
      const hd = range(H.depth) * scale / 2;
      const setback = range(H.setback);
      const back = roadHalf + setback + hd;
      const x = p.x + out.x * back;
      const z = p.z + out.z * back;
      const angle = Math.atan2(-out.x, -out.z);
      const under = cellsUnder(x, z, angle, hw, hd, 0.4);
      const blocked = (i) => i < 0 || !inside(i % n, Math.floor(i / n)) || roads[i] !== ROAD_NONE || buildingOf[i] !== 0;
      if (!under.length || under.some(blocked)) return 0;
      if (cellsUnder(x, z, angle, hw, hd, 1.6).some((i) => i >= 0 && (buildingOf[i] !== 0 || water[i] !== 0)))
        return 0;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      if (!clearOfStreets(x, z, c, s, hw, hd) || !clearOfHouses(x, z, angle, hw, hd, 1.2)) return 0;
      const at = (u, v) => ({ x: x + c * u + s * v, z: z - s * u + c * v });
      let lo = Infinity;
      let hi = -Infinity;
      for (const [u, v] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
        [0, 0]
      ]) {
        const q = at(u * hw, v * hd);
        const h = ground(q.x, q.z);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      if (hi - lo > H.maxRise) return 0;
      for (const [u, v] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1]
      ]) {
        const q = at(u * (hw + 1), v * (hd + 1));
        const ix = Math.floor(q.x / cell);
        const iz = Math.floor(q.z / cell);
        if (ix < 0 || iz < 0 || ix >= n || iz >= n || water[idx(ix, iz)]) return 0;
      }
      const id = buildings.length;
      for (const i of under) buildingOf[i] = id + 1;
      const floors = rng.int(tpl.paintFloors.min, tpl.paintFloors.max);
      const paintHeight = floors * H.floorHeight;
      const chunk = site.chunkOf(x, z);
      const wall = rng.pick(tpl.walls);
      const side = (u, v, len) => {
        const f = at(u, v);
        return site.addSurface("wall", chunk, wall, len * paintHeight, f.x, f.z);
      };
      const walls = {
        px: side(hw, 0, 2 * hd),
        nx: side(-hw, 0, 2 * hd),
        pz: side(0, hd, 2 * hw),
        nz: side(0, -hd, 2 * hw)
      };
      const roof = site.addSurface("roof", chunk, rng.pick(tpl.roofs), 4 * hw * hd, x, z);
      const front = at(0, hd);
      const door = site.addSurface("door", chunk, rng.pick(tpl.doors), 1.6 * 2.4, front.x, front.z);
      const stepAt = at(0, hd + 1.2);
      const depth = setback - 0.6;
      const plot = at(0, hd + depth / 2);
      const garden = depth >= GARDEN_MIN && rng.chance(tpl.key === "cottage" ? 0.6 : 0.3) && clearOfStreets(plot.x, plot.z, c, s, hw + 0.5, depth / 2) ? depth : 0;
      const key = bucketKey(Math.floor(x / BUCKET2), Math.floor(z / BUCKET2));
      let near2 = placed.get(key);
      if (!near2) placed.set(key, near2 = []);
      buildings.push({
        id,
        x,
        z,
        hw,
        hd,
        angle,
        base: hi + 0.12,
        foot: lo,
        step: ground(stepAt.x, stepAt.z),
        height: tpl.eaves + (floors - tpl.paintFloors.min) * 0.35,
        template: t,
        garden,
        walls,
        roof,
        door
      });
      near2.push(buildings[id]);
      return 2 * hw;
    };
    for (const st of streets) {
      if (st.points.length < 2) continue;
      for (const sideSign of [1, -1]) {
        let carry = 4 + rng.next() * 4;
        for (let k = 0; k < st.points.length - 1; k++) {
          const a = st.points[k];
          const b = st.points[k + 1];
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          if (len < 1e-6) continue;
          const tx = (b.x - a.x) / len;
          const tz = (b.z - a.z) / len;
          const out = { x: -tz * sideSign, z: tx * sideSign };
          let s = carry;
          while (s < len) {
            const width = tryHouse({ x: a.x + tx * s, z: a.z + tz * s }, out, st.width / 2);
            s += width ? width + range(H.gap) : 3;
          }
          carry = s - len;
        }
      }
    }
    return { buildings, buildingOf };
  }

  // src/world/city/yards.ts
  var TREE_SPACING = 9;
  var TOWN_GREAT = { height: 14, crown: 7 };
  function fillYards(site, roads, buildingOf) {
    const { n, cell, rng, idx, inside, water } = site;
    const blockOf = new Uint16Array(n * n);
    const groundOf = new Int32Array(n * n).fill(-1);
    const district = (i) => site.chunkOf((i % n + 0.5) * cell, (Math.floor(i / n) + 0.5) * cell);
    const yardColors = [color("grass"), color("sand"), color("green")];
    let regions = 0;
    for (let i0 = 0; i0 < n * n; i0++) {
      if (blockOf[i0] !== 0 || roads[i0] !== ROAD_NONE || water[i0] || !inside(i0 % n, Math.floor(i0 / n)))
        continue;
      const region = ++regions;
      const cells = [];
      const stack = [i0];
      blockOf[i0] = region;
      while (stack.length) {
        const j = stack.pop();
        cells.push(j);
        const x = j % n;
        const z = (j - x) / n;
        for (let d = 0; d < 4; d++) {
          const x2 = x + DX[d];
          const z2 = z + DZ[d];
          if (!inside(x2, z2)) continue;
          const k = idx(x2, z2);
          if (roads[k] === ROAD_NONE && !water[k] && blockOf[k] === 0 && district(k) === district(j)) {
            blockOf[k] = region;
            stack.push(k);
          }
        }
      }
      const patches = /* @__PURE__ */ new Map();
      for (const j of cells) {
        if (buildingOf[j] !== 0) continue;
        const key = Math.floor(j % n / TUNING.city.yardPatch) * 1e3 + Math.floor(Math.floor(j / n) / TUNING.city.yardPatch);
        let list = patches.get(key);
        if (!list) patches.set(key, list = []);
        list.push(j);
      }
      const yardColor = rng.pick(yardColors);
      for (const key of [...patches.keys()].sort((a, b) => a - b)) {
        const list = patches.get(key);
        if (list.length < 3) continue;
        let sx = 0;
        let sz = 0;
        for (const j of list) {
          sx += (j % n + 0.5) * cell;
          sz += (Math.floor(j / n) + 0.5) * cell;
        }
        const surface = site.addSurface(
          "ground",
          district(list[0]),
          yardColor,
          list.length * cell * cell,
          sx / list.length,
          sz / list.length
        );
        for (const j of list) groundOf[j] = surface;
      }
    }
    return { blockOf, groundOf };
  }
  function plantYardTrees(site, roads, blockOf, buildingOf, buildings, square) {
    const { n, cell, size, idx } = site;
    const trees = [];
    const treeRng = new Rng(hashInts(site.seed, 32485));
    const spacing2 = TREE_SPACING * TREE_SPACING;
    for (let tries = 0; tries < size * size / spacing2 * 2; tries++) {
      const x = treeRng.range(cell, size - cell);
      const z = treeRng.range(cell, size - cell);
      const ix = Math.floor(x / cell);
      const iz = Math.floor(z / cell);
      if (blockOf[idx(ix, iz)] === 0 || site.nearWater(ix, iz, 1)) continue;
      let clear2 = true;
      for (let dz = -1; dz <= 1 && clear2; dz++)
        for (let dx = -1; dx <= 1 && clear2; dx++) {
          const j = idx(Math.min(n - 1, Math.max(0, ix + dx)), Math.min(n - 1, Math.max(0, iz + dz)));
          if (buildingOf[j] !== 0 || roads[j] !== ROAD_NONE) clear2 = false;
        }
      if (!clear2 || trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < spacing2)) continue;
      if (!treeRng.chance(0.55)) continue;
      trees.push({
        x,
        z,
        y: site.ground(x, z) - 0.2,
        height: treeRng.range(4.5, 7.5),
        crown: treeRng.range(1.5, 2.4),
        color: treeRng.chance(0.6) ? color("leaf") : color("canopy")
      });
    }
    let greatAt = -1;
    let greatD = Infinity;
    trees.forEach((t, i) => {
      const d = Math.hypot(t.x - square.x, t.z - square.z);
      if (d >= greatD || d < square.r + TOWN_GREAT.crown) return;
      const room = buildings.every(
        (b) => Math.hypot(b.x - t.x, b.z - t.z) - Math.hypot(b.hw, b.hd) > TOWN_GREAT.crown - 1
      );
      if (!room) return;
      greatAt = i;
      greatD = d;
    });
    if (greatAt >= 0) {
      const t = trees[greatAt];
      for (let i = trees.length - 1; i >= 0; i--)
        if (i !== greatAt && Math.hypot(trees[i].x - t.x, trees[i].z - t.z) < TOWN_GREAT.crown + 2)
          trees.splice(i, 1);
      trees[trees.indexOf(t)] = __spreadProps(__spreadValues({}, t), { height: TOWN_GREAT.height, crown: TOWN_GREAT.crown, kind: "great" });
    }
    return trees;
  }

  // src/world/city/outline.ts
  var TAU = Math.PI * 2;

  // src/world/city/layout.ts
  var WHEEL_RADIUS = 2.4;
  var WHEEL_DEPTH = 0.8;
  var WHEEL_REACH = 12;
  function generateCity(id, seed, chunks = TUNING.city.chunks, main = "pz", height = () => 0) {
    const site = surveySite(seed, chunks, height);
    const { n, cell, size, heights, water, surfaces, rng } = site;
    const { gates, gateCell } = placeGates(site, main);
    const { square, at: sq } = placeSquare(site);
    const plan = layStreets(site, gates, gateCell, square, sq);
    const { roads, streets } = plan;
    const { buildings, buildingOf } = placeHouses(site, plan, square);
    const { blockOf, groundOf } = fillYards(site, roads, buildingOf);
    const trees = plantYardTrees(site, roads, blockOf, buildingOf, buildings, square);
    const wheel = placeWheel(site, roads, buildings, square);
    const spawn = spawnPoint(streets, square);
    const name = rng.pick(CITY_PREFIX) + rng.pick(CITY_SUFFIX);
    return __spreadValues({
      id,
      boundary: settlementBoundary(seed, chunks),
      ox: 0,
      oz: 0,
      chunks,
      seed,
      name,
      n,
      cell,
      size,
      heights,
      roads,
      water,
      blockOf,
      buildingOf,
      groundOf,
      gates,
      streets,
      square,
      trees,
      wheel,
      buildings,
      surfaces,
      spawn
    }, placeFeatures({ seed, n, cell, chunks, roads, water, surfaces, buildings, spawn }));
  }
  function placeWheel(site, roads, buildings, square) {
    const { cell, idx, inside, water, ground } = site;
    let wheel = null;
    let wheelD = Infinity;
    for (const b of buildings) {
      const reach = Math.ceil((Math.max(b.hw, b.hd) + WHEEL_REACH) / cell);
      const bx = Math.floor(b.x / cell);
      const bz = Math.floor(b.z / cell);
      let near2 = -1;
      let nearD = Infinity;
      for (let dz = -reach; dz <= reach; dz++)
        for (let dx = -reach; dx <= reach; dx++) {
          const x = bx + dx;
          const z = bz + dz;
          if (!inside(x, z) || !water[idx(x, z)] || roads[idx(x, z)] !== ROAD_NONE) continue;
          if (ground((x + 0.5) * cell, (z + 0.5) * cell) > WATER_LEVEL - WHEEL_DEPTH) continue;
          const d2 = Math.hypot((x + 0.5) * cell - b.x, (z + 0.5) * cell - b.z);
          if (d2 < nearD) {
            nearD = d2;
            near2 = idx(x, z);
          }
        }
      if (near2 < 0 || nearD > Math.max(b.hw, b.hd) + WHEEL_REACH) continue;
      const d = Math.hypot(b.x - square.x, b.z - square.z);
      if (d < wheelD) {
        wheelD = d;
        const c = site.centreOf(near2);
        wheel = { x: c.x, z: c.z, r: WHEEL_RADIUS, y: WATER_LEVEL + WHEEL_RADIUS * 0.55 };
      }
    }
    return wheel;
  }
  function spawnPoint(streets, square) {
    let spawn = { x: square.x, z: square.z, yaw: 0 };
    const entry = streets.find((s) => s.cls === ROAD_MAIN && s.points.length > 2);
    if (entry) {
      let walked = 0;
      for (let k = 0; k < entry.points.length - 1; k++) {
        const a = entry.points[k];
        const b = entry.points[k + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (walked + len < 16 && k < entry.points.length - 2) {
          walked += len;
          continue;
        }
        const t = Math.min(1, (16 - walked) / (len || 1));
        spawn = {
          x: a.x + (b.x - a.x) * t,
          z: a.z + (b.z - a.z) * t,
          yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z))
        };
        break;
      }
    }
    return spawn;
  }
  function placeCity(c, at) {
    const move = (p) => __spreadProps(__spreadValues({}, p), { x: p.x + at.x, z: p.z + at.z });
    return __spreadProps(__spreadValues({}, c), {
      ox: c.ox + at.x,
      oz: c.oz + at.z,
      streets: c.streets.map((s) => __spreadProps(__spreadValues({}, s), { points: s.points.map(move) })),
      square: move(c.square),
      wheel: c.wheel && move(c.wheel),
      trees: c.trees.map(move),
      buildings: c.buildings.map(move),
      surfaces: c.surfaces.map(move),
      stains: c.stains.map(move),
      studios: c.studios.map((s) => __spreadProps(__spreadValues({}, s), { door: move(s.door) })),
      monsters: c.monsters.map(move),
      spawn: move(c.spawn)
    });
  }
  function townLayout(e, w) {
    const local = generateCity(e.cityId, e.seed, e.chunks, e.gate, (x, z) => w.heightAt(e.ox + x, e.oz + z));
    return placeCity(local, { x: e.ox, z: e.oz });
  }

  // src/world/wilderness/drain.ts
  function falloff(distance) {
    return 1 - smoothstep(TUNING.drain.innerRadius, TUNING.drain.outerRadius, distance);
  }
  function saturationAt(x, z, cities, wells = []) {
    let drain = 0;
    for (const c of cities) {
      const d = Math.hypot(Math.max(Math.abs(x - c.x) - c.half, 0), Math.max(Math.abs(z - c.z) - c.half, 0));
      drain = Math.max(drain, (1 - c.progress) * falloff(d));
    }
    for (const w of wells) drain *= smoothstep(w.r * 0.55, w.r, Math.hypot(x - w.x, z - w.z));
    return 1 - drain;
  }
  function influenceOf(e, progress) {
    return { x: e.x, z: e.z, half: e.size / 2, progress };
  }

  // src/world/wilderness/wild-monsters.ts
  var ATTEMPTS3 = 10;
  var wildCreatures = [
    "rat",
    "snake",
    "snake-angry",
    "spider",
    "wasp",
    "star-mote",
    "star-orb",
    "star-wing",
    "star-brute"
  ];
  function creatureType(seed, cx, cz, slot) {
    const roll2 = hashAt(seed, "wild-creature", cx, cz, slot);
    if (unit(hashAt(seed, "wild-model-pack", cx, cz, slot)) < 0.45)
      return enemyIndex(WILD_MODELS[roll2 % WILD_MODELS.length].key);
    return enemyIndex(wildCreatures[roll2 % wildCreatures.length]);
  }
  function wildMonsterCount(seed, cx, cz, saturation) {
    const W2 = TUNING.combat.wild;
    const [lo, hi] = saturation < W2.drainedBelow ? W2.drained : saturation < W2.greyBelow ? W2.grey : [0, 0];
    return lo + Math.floor(unit(hashAt(seed, "wild-count", cx, cz)) * (hi - lo + 1));
  }
  function wildMonstersInChunk(w, cx, cz, saturation, cleansed = false) {
    const size = TUNING.world.chunkSize;
    const cell = TUNING.world.cellSize;
    const n = size / cell;
    const count = wildMonsterCount(w.seed, cx, cz, saturation);
    const out = [];
    for (let k = 0; k < count; k++) {
      for (let attempt = 0; attempt < ATTEMPTS3; attempt++) {
        const h = hashAt(w.seed, "wild-monster", cx, cz, k, attempt);
        const x = cx * size + (h % n + 0.5) * cell;
        const z = cz * size + ((h >>> 8) % n + 0.5) * cell;
        const y = w.heightAt(x, z);
        if (y <= WATER_LEVEL + 0.5) continue;
        if (Math.hypot(x, z) < 60) continue;
        if (w.townAt(x, z, TUNING.structures.townClearance)) continue;
        const giant = k === 0 && saturation < TUNING.combat.wild.drainedBelow && unit(hashAt(w.seed, "wild-giant", cx, cz)) < TUNING.combat.giantChance.wild;
        const kind = unit(hashAt(w.seed, "wild-kind", cx, cz, k));
        const type = giant ? enemyIndex("giant") : kind < TUNING.combat.spitterChance ? enemyIndex("spitter") : kind < TUNING.combat.spitterChance + (1 - TUNING.combat.spitterChance) * TUNING.combat.weaselChance ? enemyIndex("weasel") : kind >= 1 - TUNING.combat.wildFrogChance ? enemyIndex("frog") : kind >= 1 - TUNING.combat.wildFrogChance - TUNING.combat.wildCreatureChance ? creatureType(w.seed, cx, cz, k) : enemyIndex("blot");
        out.push({ id: `${cx},${cz}:${k}`, type, x, y, z });
        break;
      }
    }
    const well = inkWellInChunk(w, cx, cz);
    if (well) out.push(...wellGuards(w, well, saturation, cleansed));
    if (!cleansed && saturation >= TUNING.combat.wild.greyBelow && unit(hashAt(w.seed, "remote-pack", cx, cz)) < 0.22) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const h = hashAt(w.seed, "remote-pack-home", cx, cz, attempt);
        const x = cx * size + 20 + unit(h) * (size - 40);
        const z = cz * size + 20 + unit(hashAt(h, "z")) * (size - 40);
        if (Math.hypot(x - size / 2, z - size / 2) < 260 || w.townAt(x, z, TUNING.drain.outerRadius + 40))
          continue;
        if (pathsOf(w).edgeDistance(x, z) < 18 || w.heightAt(x, z) < WATER_LEVEL + 1) continue;
        for (let k = 0; k < 2 + h % 2; k++) {
          const px = x + Math.sin(k * 2.4) * 4, pz = z + Math.cos(k * 2.4) * 4;
          const y = w.heightAt(px, pz);
          if (y < WATER_LEVEL + 1 || Math.abs(y - w.heightAt(x, z)) > 1.5) continue;
          const type = enemyIndex(["blot", "weasel", "spider"][h % 3]);
          out.push({ id: `${cx},${cz}:${100 + k}`, type, x: px, y, z: pz });
        }
        break;
      }
    }
    return out;
  }
  function wildMonsterById(w, id, saturation) {
    var _a2;
    const m = /^(-?\d+),(-?\d+):(\d+)$/.exec(id);
    if (!m) return null;
    return (_a2 = wildMonstersInChunk(w, Number(m[1]), Number(m[2]), saturation).find((x) => x.id === id)) != null ? _a2 : null;
  }
  function chunkSaturation(w, cx, cz, progressOf) {
    const size = TUNING.world.chunkSize;
    const x = (cx + 0.5) * size;
    const z = (cz + 0.5) * size;
    const cities = w.entrancesNear(x, z, 1).map((e) => influenceOf(e, progressOf(e.cityId)));
    return saturationAt(x, z, cities);
  }

  // src/world/city/travel-altar.ts
  var ALTAR_RADIUS = 2.3;
  var cache2 = /* @__PURE__ */ new WeakMap();
  function hasTravelAltar(_seed, chunks) {
    return chunks > 0;
  }
  function travelAltar(l) {
    if (cache2.has(l)) return cache2.get(l);
    let best = null;
    let score = Infinity;
    if (hasTravelAltar(l.seed, l.chunks)) {
      const phase = unit(hashAt(l.seed, "travel-altar-side")) * Math.PI * 2;
      for (let i = 0; i < 64; i++) {
        if (i % 16 === 0 && best) break;
        const a = phase + i * Math.PI / 8;
        const radius = 6.1 + Math.floor(i / 16) * 4;
        const x = l.square.x + Math.cos(a) * radius;
        const z = l.square.z + Math.sin(a) * radius;
        const clear2 = ALTAR_RADIUS + 0.8;
        if (l.buildings.some((b) => {
          const dx = x - b.x, dz = z - b.z;
          const u = Math.cos(b.angle) * dx - Math.sin(b.angle) * dz;
          const v = Math.sin(b.angle) * dx + Math.cos(b.angle) * dz;
          return Math.abs(u) < b.hw + clear2 && Math.abs(v) < b.hd + b.garden + clear2;
        }))
          continue;
        if (l.trees.some((t) => Math.hypot(t.x - x, t.z - z) < clear2 + 1)) continue;
        let lo = Infinity, hi = -Infinity, dry = true;
        for (let k = 0; k <= 8; k++) {
          const r = k === 8 ? 0 : clear2;
          const sx = x + Math.cos(k * Math.PI / 4) * r;
          const sz = z + Math.sin(k * Math.PI / 4) * r;
          const ix = Math.floor((sx - l.ox) / l.cell), iz = Math.floor((sz - l.oz) / l.cell);
          if (ix < 1 || iz < 1 || ix >= l.n - 1 || iz >= l.n - 1 || l.water[iz * l.n + ix]) dry = false;
          const y = groundAt(l, sx, sz);
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
        if (!dry || lo <= WATER_LEVEL + 0.1 || hi - lo > 0.65) continue;
        const cost = hi - lo + i * 1e-3;
        if (cost < score) {
          score = cost;
          best = { x, y: hi + 0.07, z, yaw: Math.atan2(x - l.square.x, z - l.square.z) };
        }
      }
    }
    cache2.set(l, best);
    return best;
  }

  // src/world/net/patch-context.ts
  function entranceById(wilderness, id) {
    var _a2;
    const m = /^c(-?\d+)_(-?\d+)$/.exec(id);
    if (!m) return null;
    const size = TUNING.world.chunkSize;
    return (_a2 = wilderness.entrancesNear((Number(m[1]) + 0.5) * size, (Number(m[2]) + 0.5) * size, 0).find((x) => x.cityId === id)) != null ? _a2 : null;
  }
  function worldPatchContext(wilderness, layoutOf, progressOf) {
    return {
      cityOf: layoutOf,
      altarOf: (id) => {
        const layout = layoutOf(id);
        return layout ? travelAltar(layout) : null;
      },
      sourceOf: (id) => sourceById(wilderness, id),
      ruinOf: (id) => ruinById(wilderness, id),
      wildMonsterOf: (id) => {
        const m = /^(-?\d+),(-?\d+):/.exec(id);
        if (!m) return null;
        const sat = chunkSaturation(wilderness, Number(m[1]), Number(m[2]), progressOf);
        return wildMonsterById(wilderness, id, sat);
      },
      inkWellOf: (id) => {
        const well = inkWellById(wilderness, id);
        if (!well) return null;
        const sat = chunkSaturation(wilderness, well.cx, well.cz, progressOf);
        return { well, seeping: wellSeeping(sat), guards: wellGuards(wilderness, well, sat) };
      }
    };
  }
  function layoutCache(wilderness, keep = 24) {
    const cache3 = /* @__PURE__ */ new Map();
    return (id) => {
      let l = cache3.get(id);
      if (l === void 0) {
        const e = entranceById(wilderness, id);
        l = e ? townLayout(e, wilderness) : null;
      } else cache3.delete(id);
      cache3.set(id, l);
      while (cache3.size > keep) cache3.delete(cache3.keys().next().value);
      return l;
    };
  }

  // src/world/net/slices.ts
  var KEYS = [
    "infectedAt",
    "inventory",
    "unlocked",
    "growth",
    "drop",
    "marks",
    "nextMark",
    "discovered",
    "player"
  ];
  function takeSlice(state) {
    return {
      infectedAt: state.infectedAt,
      inventory: state.inventory,
      unlocked: state.unlocked,
      growth: state.growth,
      drop: state.drop,
      marks: state.marks,
      nextMark: state.nextMark,
      discovered: state.discovered,
      player: state.player
    };
  }
  function putSlice(state, slice) {
    for (const k of KEYS) state[k] = slice[k];
  }
  function withSlice(state, slice, fn) {
    const own = takeSlice(state);
    putSlice(state, slice);
    try {
      return fn();
    } finally {
      Object.assign(slice, takeSlice(state));
      putSlice(state, own);
    }
  }
  function newSlice() {
    return takeSlice(createWorldState("player", 0));
  }
  function serializeSlice(slice) {
    const state = createWorldState("player", 0);
    putSlice(state, slice);
    return serializeWorld(state);
  }
  function deserializeSlice(text) {
    return takeSlice(deserializeWorld(text));
  }

  // src/world/net/fix.ts
  var ARRAYS = ["states", "stains", "defeated", "coloredOnce"];
  function diff(before, after) {
    const out = [];
    for (let i = 0; i < after.length; i++) if (!before || before[i] !== after[i]) out.push([i, after[i]]);
    return out.length ? out : void 0;
  }
  function cityFix(id, before, after) {
    var _a2, _b, _c;
    const fix = { id };
    for (const k of ARRAYS) {
      const d = diff(before == null ? void 0 : before[k], after[k]);
      if (d) fix[k] = d;
    }
    const stock = diff(before == null ? void 0 : before.stockFrom, after.stockFrom);
    if (stock) fix.stockFrom = stock;
    if (!before || before.completed !== after.completed) fix.completed = after.completed;
    if (!before || before.restoredAt !== after.restoredAt) fix.restoredAt = after.restoredAt;
    if (!before || before.peaceful !== after.peaceful) fix.peaceful = after.peaceful;
    if (!before || ((_a2 = before.altarGuards) != null ? _a2 : 0) !== ((_b = after.altarGuards) != null ? _b : 0)) fix.altarGuards = (_c = after.altarGuards) != null ? _c : 0;
    return Object.keys(fix).length > 1 ? fix : void 0;
  }

  // src/world/net/host.ts
  var NEAR = 600;
  var MAX_SAVED_PLAYERS = 500;
  var TIDE_GAP = 120;
  var DRAIN_BURST = 60;
  var DRAIN_RATE = 20;
  var GESTURE_BURST = 12;
  var GESTURE_RATE = 12;
  var TOWN_BUDGET = 8;
  var TOWN_WINDOW = 60;
  var WorldHost = class _WorldHost {
    constructor(state, players = /* @__PURE__ */ new Map(), max = DEFAULT_MAX_PLAYERS) {
      __publicField(this, "state", state);
      __publicField(this, "max", max);
      __publicField(this, "members", /* @__PURE__ */ new Map());
      __publicField(this, "players");
      __publicField(this, "patchContext");
      __publicField(this, "wilderness");
      /** Town id -> world clock when its last tide was held. */
      __publicField(this, "tidesHeld", /* @__PURE__ */ new Map());
      __publicField(this, "nextId", 1);
      /** Seconds the host has run, for ordering arrivals. */
      __publicField(this, "uptime", 0);
      /** Something worth saving changed since the last save. */
      __publicField(this, "dirty", false);
      /** The arena (PvP), on the same clock. */
      __publicField(this, "arena");
      /** Arena messages from things that happened outside a message (someone dropping out), to go
       * out with the next tick. */
      __publicField(this, "outbox", []);
      __publicField(this, "nextTravellerThink", 0);
      __publicField(this, "thinking", false);
      this.players = players;
      const wilderness = createWilderness(state.seed, state.legacyTowns, state.terrainVersion);
      this.wilderness = wilderness;
      this.patchContext = worldPatchContext(
        wilderness,
        layoutCache(wilderness),
        (id) => savedProgress(this.state, id)
      );
      this.arena = new ArenaHost(wilderness, () => this.state.clock);
    }
    async planTraveller(player, trailId, choose) {
      const plan = this.beginTravellerPlan(player, trailId);
      if (!plan) return null;
      try {
        return plan.finish(await choose(plan.options, plan.memory));
      } catch (error) {
        plan.finish(null);
        throw error;
      }
    }
    beginTravellerPlan(player, trailId) {
      var _a2;
      const motion = (_a2 = this.members.get(player)) == null ? void 0 : _a2.motion;
      if (!motion || this.thinking || this.uptime < this.nextTravellerThink) return null;
      this.nextTravellerThink = this.uptime + 3;
      const [x, , z] = motion.p;
      const trail = pathsOf(this.wilderness).trailsNear(x - 150, z - 150, x + 150, z + 150).find((t) => t.id === trailId);
      const j = trail && journeyOn(this.state.seed, trail);
      const old = this.state.travellerLegs.get(trailId);
      if (!j || !decisionDue(j, this.state.clock, old)) return null;
      const p = travellerPose(j, this.state.clock, old);
      if (Math.hypot(x - p.x, z - p.z) > 155) return null;
      const options = travelOptions(this.wilderness, this.state, j);
      if (!options.length) return null;
      const memory = rememberedSightings(this.wilderness, this.state, j);
      this.thinking = true;
      return {
        options,
        memory,
        finish: (index2) => {
          this.thinking = false;
          const stop = index2 !== null && options[index2];
          if (!stop || !this.count || this.state.travellerLegs.get(trailId) !== old) return null;
          const leg = commitTravellerStop(this.wilderness, this.state, j, stop.at);
          if (leg) this.dirty = true;
          return leg;
        }
      };
    }
    get count() {
      return this.members.size;
    }
    /** Players in the save (online or not). */
    get remembered() {
      return this.players.size;
    }
    info(id) {
      const m = this.members.get(id);
      return m ? { id: m.id, name: m.name, look: m.look } : null;
    }
    everyone() {
      return [...this.members.values()].map((m) => ({ id: m.id, name: m.name, look: m.look }));
    }
    /** Only the authenticated member can change their profile; keep late arrivals and saves current. */
    updateProfile(id, name, rawLook) {
      const member = this.members.get(id);
      const look = validLook(rawLook);
      if (!member || !look) return null;
      name = cleanName(name);
      if (member.name === name && member.look.character === look.character && member.look.skin === look.skin && member.look.hair === look.hair && member.look.accent === look.accent)
        return null;
      member.name = name;
      member.look = look;
      const saved = this.players.get(member.token);
      saved.name = name;
      saved.look = look;
      this.dirty = true;
      return this.info(id);
    }
    /**
     * Let a player in, with their own things from last time if the token is known. The same
     * token already online is taken to be a dropped connection that never closed: the new one
     * replaces it.
     */
    join(token, name, look) {
      var _a2;
      const old = [...this.members.values()].find((m) => m.token === token);
      if (old) this.leave(old.id);
      if (this.members.size >= this.max) return { ok: false, reason: `\u670D\u52A1\u5668\u5DF2\u6EE1\uFF08${this.max} \u4EBA\uFF09` };
      let saved = this.players.get(token);
      if (!saved) {
        this.forgetOldest();
        saved = { name, look, slice: newSlice(), seen: this.state.clock };
        this.players.set(token, saved);
      }
      saved.name = name;
      saved.look = look;
      saved.seen = this.state.clock;
      const id = this.nextId++;
      this.members.set(id, {
        id,
        token,
        name,
        look,
        slice: saved.slice,
        motion: null,
        motionAt: -Infinity,
        visitAt: -Infinity,
        town: null,
        townSince: 0,
        drains: DRAIN_BURST,
        gestures: GESTURE_BURST,
        towns: /* @__PURE__ */ new Map()
      });
      this.dirty = true;
      return { ok: true, id, replaced: (_a2 = old == null ? void 0 : old.id) != null ? _a2 : null };
    }
    /** Make room for one more remembered player: forget whoever has been away longest. */
    forgetOldest() {
      if (this.players.size < MAX_SAVED_PLAYERS) return;
      const online = new Set([...this.members.values()].map((m) => m.token));
      let oldest = null;
      let seen = Infinity;
      for (const [token, p] of this.players)
        if (!online.has(token) && p.seen < seen) {
          seen = p.seen;
          oldest = token;
        }
      if (oldest) this.players.delete(oldest);
    }
    leave(id) {
      const m = this.members.get(id);
      if (!m) return;
      const saved = this.players.get(m.token);
      if (saved) saved.seen = this.state.clock;
      this.members.delete(id);
      this.outbox.push(...this.arena.leave(id));
      this.dirty = true;
    }
    move(id, motion, scene, town) {
      const m = this.members.get(id);
      if (!m) return;
      const inArena = this.arena.has(id);
      if (inArena) {
        const { x, z, radius } = this.arena.site;
        const [px, py, pz] = motion.p;
        if (scene.kind !== "wild" || (motion.f & (FLYING | GLIDING)) !== 0 || Math.hypot(px - x, pz - z) > radius || py > this.wilderness.heightAt(px, pz) + ARENA.wall.height + 5)
          return;
      }
      m.motion = __spreadProps(__spreadValues({}, motion), { f: motion.f & ~INFECTED | (m.slice.infectedAt && !inArena ? INFECTED : 0) });
      m.motionAt = this.uptime;
      const inTown = !inArena && town !== null && this.near(motion, { kind: "complete", city: town }) ? town : null;
      if (inTown !== m.town) {
        m.town = inTown;
        m.townSince = this.uptime;
      }
      if (inArena) {
        this.arena.track(id, motion.p);
        return;
      }
      m.slice.player = { scene, x: motion.p[0], y: motion.p[1], z: motion.p[2], yaw: motion.yaw };
      this.dirty = true;
    }
    /** Whether a patch acts within reach of where this motion stands. */
    near(motion, patch) {
      const place = placeOf(patch);
      if (!place) return true;
      if (!motion) return false;
      if ("city" in patch) {
        if (Math.hypot(place.x - motion.p[0], place.z - motion.p[2]) > NEAR + TUNING.structures.cityGrid * TUNING.world.chunkSize * Math.SQRT2)
          return false;
        const town = entranceById(this.wilderness, patch.city);
        return town !== null && Math.hypot(town.x - motion.p[0], town.z - motion.p[2]) <= NEAR;
      }
      return Math.hypot(place.x - motion.p[0], place.z - motion.p[2]) <= NEAR;
    }
    /** The true state of whatever this patch touches in the shared world. */
    truth(patch) {
      var _a2, _b, _c, _d;
      const city = "city" in patch ? this.state.cities.get(patch.city) : void 0;
      const fix = {};
      if (patch.kind === "overrun") fix.inkArea = [areaKey(patch.site), (_a2 = this.state.inkAreas.get(areaKey(patch.site))) != null ? _a2 : null];
      if (patch.kind === "infectNpc" || patch.kind === "defeatInfected") fix.infectedPerson = [patch.person, (_b = this.state.infectedPeople.get(patch.person)) != null ? _b : null];
      if (city && "city" in patch) fix.city = cityFix(patch.city, void 0, city);
      if (patch.kind === "harvest" && this.state.harvested.has(patch.source))
        fix.harvested = [[patch.source, this.state.harvested.get(patch.source)]];
      if (patch.kind === "hunt") fix.hunted = [[patch.monster, (_c = this.state.hunted.get(patch.monster)) != null ? _c : null]];
      if (patch.kind === "cleanse") fix.cleansed = [[patch.well, (_d = this.state.cleansed.get(patch.well)) != null ? _d : null]];
      return Object.keys(fix).length ? fix : null;
    }
    /** Judge a player's patch against their own things and the shared world. */
    patch(id, patch) {
      var _a2, _b, _c, _d;
      const fail2 = (reason) => ({
        ok: false,
        reason,
        shared: false,
        fix: this.truth(patch)
      });
      const m = this.members.get(id);
      if (!m) return fail2("\u4E0D\u5728\u8FD9\u4E2A\u4E16\u754C\u91CC");
      if (patch.kind === "infectNpc" || patch.kind === "overrun" || patch.kind === "defeatInfected" || patch.kind === "death" && patch.inkMonster) {
        const site = patch.kind === "death" ? patch : patch.kind === "defeatInfected" ? this.state.infectedPeople.get(patch.person) : patch.site;
        if (!site || this.arena.has(id) || !m.motion || !m.slice.player || Math.hypot(m.motion.p[0] - site.x, m.motion.p[2] - site.z) > (patch.kind === "death" ? 12 : 110))
          return fail2("\u4E0D\u5728\u611F\u67D3\u73B0\u573A");
        if (patch.kind === "overrun" && [...this.members.values()].some((p) => !this.arena.has(p.id) && !p.slice.infectedAt && p.slice.player && inInfectionArea(site, p.slice.player))) return fail2("\u9644\u8FD1\u8FD8\u6709\u672A\u611F\u67D3\u7684\u73A9\u5BB6");
      }
      if (!this.near(m.motion, patch)) return fail2("\u79BB\u90A3\u91CC\u592A\u8FDC\u4E86");
      if ("city" in patch && !this.townAllowed(m, patch.city)) return fail2("\u4E00\u4E0B\u5B50\u53BB\u4E86\u592A\u591A\u57CE");
      if (patch.kind === "restoreAltar") {
        const altar = (_b = (_a2 = this.patchContext).altarOf) == null ? void 0 : _b.call(_a2, patch.city);
        if (!altar || !m.motion || this.arena.has(id) || m.slice.infectedAt || Math.hypot(m.motion.p[0] - altar.x, m.motion.p[1] - (altar.y + 0.21), m.motion.p[2] - altar.z) > 3.5)
          return fail2("\u8BF7\u7AD9\u5230\u796D\u575B\u4E0A\u4FEE\u590D");
      }
      if (patch.kind === "drain" || patch.kind === "tideHeld") {
        if (this.keepers().get(patch.city) !== id) return fail2("\u53EA\u6709\u8FD9\u5EA7\u57CE\u7684\u770B\u5B88\u80FD\u8FD9\u6837\u505A");
      }
      if (patch.kind === "drain") {
        if (m.drains < 1) return fail2("\u62BD\u8272\u592A\u5FEB\u4E86");
        if (((_d = (_c = this.state.cities.get(patch.city)) == null ? void 0 : _c.states[patch.surface]) != null ? _d : DRAINED) === DRAINED)
          return fail2("\u5DF2\u7ECF\u6CA1\u6709\u989C\u8272\u4E86");
        m.drains -= 1;
      }
      if (patch.kind === "tideHeld") {
        const last = this.tidesHeld.get(patch.city);
        if (last !== void 0 && this.state.clock - last < TIDE_GAP) return fail2("\u521A\u5B88\u4F4F\u8FC7\u4E00\u6CE2\u58A8\u6F6E");
      }
      const { result, cityBefore } = this.attempt(m, patch);
      if (!result.ok) return fail2(result.reason);
      if (patch.kind === "tideHeld") this.tidesHeld.set(patch.city, this.state.clock);
      this.dirty = true;
      const fix = {};
      const city = "city" in patch ? this.state.cities.get(patch.city) : void 0;
      if (city && "city" in patch) {
        const c = cityFix(patch.city, cityBefore, city);
        if (c) fix.city = c;
      }
      if (patch.kind === "harvest") fix.harvested = [[patch.source, this.state.harvested.get(patch.source)]];
      if (patch.kind === "hunt") fix.hunted = [[patch.monster, this.state.hunted.get(patch.monster)]];
      if (patch.kind === "cleanse") fix.cleansed = [[patch.well, this.state.cleansed.get(patch.well)]];
      if (patch.kind === "overrun" || patch.kind === "infectNpc" || patch.kind === "defeatInfected") Object.assign(fix, this.truth(patch));
      return { ok: true, shared: SHARED_KINDS.has(patch.kind), fix: Object.keys(fix).length ? fix : null };
    }
    /** Whether this player may act in this town now (see TOWN_BUDGET); remembers it if so. */
    townAllowed(m, town) {
      for (const [t, when] of m.towns) if (this.uptime - when > TOWN_WINDOW) m.towns.delete(t);
      if (!m.towns.has(town) && m.towns.size >= TOWN_BUDGET) return false;
      m.towns.set(town, this.uptime);
      return true;
    }
    /** Run a patch so that it either fully happens or leaves nothing behind (not even a half-paid
     * reward from one that threw partway). */
    attempt(m, patch) {
      const slice = structuredClone(m.slice);
      const city = "city" in patch ? patch.city : null;
      const citySave = city ? this.state.cities.get(city) : void 0;
      const cityBefore = citySave ? structuredClone(citySave) : void 0;
      const timed = patch.kind === "harvest" ? { map: this.state.harvested, key: patch.source } : patch.kind === "hunt" ? { map: this.state.hunted, key: patch.monster } : patch.kind === "cleanse" ? { map: this.state.cleansed, key: patch.well } : null;
      const timedBefore = timed == null ? void 0 : timed.map.get(timed.key);
      let result;
      try {
        result = withSlice(this.state, m.slice, () => applyPatch(this.state, patch, this.patchContext));
      } catch (e) {
        result = { ok: false, reason: "\u65E0\u6CD5\u8BC6\u522B\u7684\u64CD\u4F5C" };
      }
      if (!result.ok) {
        Object.assign(m.slice, slice);
        if (city) {
          if (cityBefore) this.state.cities.set(city, cityBefore);
          else this.state.cities.delete(city);
        }
        if (timed) {
          if (timedBefore === void 0) timed.map.delete(timed.key);
          else timed.map.set(timed.key, timedBefore);
        }
      }
      return { result, cityBefore };
    }
    /** A player's own things as text (sent to them on joining, or to correct them). */
    sliceOf(id) {
      const m = this.members.get(id);
      return m ? serializeSlice(m.slice) : null;
    }
    /** The shared world as text, for a joining player. */
    world() {
      return serializeWorld(this.state);
    }
    /** Time passes. Returns the arena's messages (rounds starting and ending, players getting up,
     * ink circles biting). */
    tick(dt) {
      this.uptime += dt;
      this.state.clock += dt;
      for (const m of this.members.values()) {
        m.drains = Math.min(DRAIN_BURST, m.drains + DRAIN_RATE * dt);
        m.gestures = Math.min(GESTURE_BURST, m.gestures + GESTURE_RATE * dt);
      }
      const out = [...this.outbox, ...this.arena.tick()];
      this.outbox = [];
      return out;
    }
    /** Town id -> the player who runs its tide and erosion: whoever has been inside longest. */
    keepers() {
      const out = /* @__PURE__ */ new Map();
      for (const m of this.members.values()) {
        if (!m.town) continue;
        const k = out.get(m.town);
        if (!k || m.townSince < k.since || m.townSince === k.since && m.id < k.id)
          out.set(m.town, { id: m.id, since: m.townSince });
      }
      return new Map([...out].map(([town, k]) => [town, k.id]));
    }
    /** The other players near this one, with their latest motion. */
    locations(id) {
      const arena2 = this.arena.members();
      const hidden = arena2.includes(id);
      return [...this.members.values()].filter((m) => m.id !== id).map((m) => {
        var _a2, _b;
        const playing = arena2.includes(m.id);
        const fresh = m.motion && this.uptime - m.motionAt <= 5;
        return {
          id: m.id,
          arena: playing,
          alive: !!fresh && !(m.motion.f & DOWNED),
          p: fresh && !hidden && !playing ? m.motion.p : null,
          scene: fresh && !hidden && !playing ? (_b = (_a2 = m.slice.player) == null ? void 0 : _a2.scene) != null ? _b : null : null
        };
      });
    }
    visit(id, target, request) {
      const fail2 = (reason) => ({
        t: "visit",
        request,
        target: null,
        reason
      });
      const me = this.members.get(id);
      if (!me || id === target) return fail2("\u8BF7\u9009\u62E9\u53E6\u4E00\u4F4D\u4F19\u4F34");
      if (this.arena.members().includes(id)) return fail2("\u7ADE\u6280\u573A\u5185\u4E0D\u80FD\u4F20\u9001");
      const friend = this.locations(id).find((p) => p.id === target);
      if (!friend) return fail2("\u4F19\u4F34\u5DF2\u79BB\u7EBF");
      if (friend.arena) return fail2("\u4F19\u4F34\u6B63\u5728\u7ADE\u6280\u573A\u4E2D");
      if (!me.motion || this.uptime - me.motionAt > 5 || !friend.p) return fail2("\u7B49\u5F85\u73A9\u5BB6\u4F4D\u7F6E\u66F4\u65B0");
      if (me.motion.f & DOWNED || !friend.alive) return fail2("\u5012\u4E0B\u65F6\u4E0D\u80FD\u4F20\u9001\uFF0C\u8BF7\u7B49\u5F85\u6062\u590D");
      const remaining = 8 - (this.uptime - me.visitAt);
      if (remaining > 0) return fail2(`\u8BF7\u7B49 ${Math.ceil(remaining)} \u79D2\u518D\u4F20\u9001`);
      me.visitAt = this.uptime;
      return { t: "visit", request, target: friend, reason: "" };
    }
    nearby(id) {
      var _a2;
      const me = (_a2 = this.members.get(id)) == null ? void 0 : _a2.motion;
      if (!me) return [];
      const out = [];
      for (const m of this.members.values()) {
        if (m.id === id || !m.motion) continue;
        const d = Math.hypot(m.motion.p[0] - me.p[0], m.motion.p[2] - me.p[2]);
        if (d <= VIEW_RANGE) out.push(__spreadValues({ id: m.id }, m.motion));
      }
      return out;
    }
    /** Who gets to see this player's gesture: the players near them, or nobody when they send
     * too many. The server only passes it on; nothing about it is judged. */
    gesture(id) {
      const m = this.members.get(id);
      if (!m || m.gestures < 1) return [];
      m.gestures -= 1;
      return this.nearby(id).map((o) => o.id);
    }
    /** The save file: the shared world and every player remembered. */
    save() {
      const players = {};
      for (const [token, p] of this.players)
        players[token] = { name: p.name, look: p.look, slice: serializeSlice(p.slice), seen: p.seen };
      this.dirty = false;
      return JSON.stringify({ v: 1, world: serializeWorld(this.state), players });
    }
    /** Read a save file back. Throws SaveError when the world in it is unreadable; a broken
     * player entry is skipped (that player starts fresh). */
    static load(text, max) {
      var _a2;
      const raw = JSON.parse(text);
      const state = deserializeWorld(String(raw.world));
      const players = /* @__PURE__ */ new Map();
      for (const [token, p] of Object.entries((_a2 = raw.players) != null ? _a2 : {})) {
        if (players.size >= MAX_SAVED_PLAYERS) break;
        try {
          const look = validLook(p.look);
          if (!look || !/^[\w-]{8,64}$/.test(token)) continue;
          const seen = typeof p.seen === "number" && Number.isFinite(p.seen) ? p.seen : 0;
          players.set(token, { name: cleanName(p.name), look, slice: deserializeSlice(String(p.slice)), seen });
        } catch (e) {
        }
      }
      return new _WorldHost(state, players, max);
    }
  };

  // internal/multiplayer/rules.ts
  function cloneState(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(cloneState);
    if (ArrayBuffer.isView(value)) return value.slice();
    if (value instanceof Set) return new Set(Array.from(value, cloneState));
    if (value instanceof Map) return new Map(Array.from(value, ([k, v]) => [k, cloneState(v)]));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneState(v)]));
  }
  var _a;
  (_a = globalThis.structuredClone) != null ? _a : globalThis.structuredClone = cloneState;
  var host;
  function init(id, seed, max, archive) {
    host = archive ? WorldHost.load(archive, max) : new WorldHost(createWorldState(id, seed, id), /* @__PURE__ */ new Map(), max);
  }
  var validate = (text) => JSON.stringify(parseClientMessage(text));
  var checkpoint = () => host.save();
  function join(key, raw, room, ai = false) {
    const m = JSON.parse(raw);
    const r = host.join(key, m.name, m.look);
    if (!r.ok) return JSON.stringify(r);
    return JSON.stringify(__spreadProps(__spreadValues({}, r), {
      player: host.info(r.id),
      welcome: {
        t: "welcome",
        v: PROTOCOL,
        id: r.id,
        max: host.max,
        room: room || void 0,
        travellerAI: ai,
        world: host.world(),
        you: host.sliceOf(r.id),
        players: host.everyone().filter((p) => p.id !== r.id)
      },
      arena: host.arena.started ? host.arena.stateMessage() : void 0
    }));
  }
  var leave = (id) => host.leave(id);
  function arena(out) {
    return out.map(({ to, m }) => ({
      ids: to === "all" ? host.everyone().map((p) => p.id) : to === "arena" ? [...host.arena.members()] : [to],
      message: m
    }));
  }
  function command(id, raw) {
    const m = JSON.parse(raw);
    const out = [];
    switch (m.t) {
      case "profile": {
        const player = host.updateProfile(id, m.name, m.look);
        if (player)
          out.push({
            ids: host.everyone().filter((p) => p.id !== id).map((p) => p.id),
            message: { t: "profile", player }
          });
        break;
      }
      case "move":
        host.move(id, m, m.scene, m.town);
        break;
      case "visit":
        out.push({ ids: [id], message: host.visit(id, m.target, m.request) });
        break;
      case "patch": {
        const r = host.patch(id, m.patch), you = host.sliceOf(id);
        out.push({
          ids: [id],
          message: r.ok ? { t: "ok", seq: m.seq, fix: r.fix, you } : { t: "rejected", seq: m.seq, kind: m.patch.kind, reason: r.reason, you, fix: r.fix }
        });
        if (r.ok && r.shared)
          out.push({
            ids: host.everyone().filter((p) => p.id !== id).map((p) => p.id),
            message: { t: "applied", from: id, patch: m.patch, fix: r.fix }
          });
        break;
      }
      case "arena":
        return JSON.stringify(
          arena(
            m.a === "join" ? host.arena.join(id) : m.a === "leave" ? host.arena.leave(id) : host.arena.vote(id, m.mode)
          )
        );
      case "act":
        return JSON.stringify(arena(host.arena.act(id, m)));
      case "gesture":
        out.push({ ids: host.gesture(id), message: { t: "gesture", from: id, g: m.g } });
        break;
    }
    return JSON.stringify(out);
  }
  function tick(dt, directory) {
    const events = arena(host.tick(dt));
    const keepers = [...host.keepers()];
    const views = host.everyone().map(({ id }) => ({
      id,
      players: host.nearby(id),
      friends: directory ? host.locations(id) : void 0,
      keeps: keepers.filter(([, keeper]) => keeper === id).map(([town]) => town)
    }));
    return JSON.stringify({ clock: host.state.clock, events, views });
  }
  var pendingPlan = null;
  function beginPlan(id, trail) {
    if (pendingPlan) return "null";
    pendingPlan = host.beginTravellerPlan(id, trail);
    if (!pendingPlan) return "null";
    const options = pendingPlan.options.map(({ kind, place, metres, onward }) => ({
      kind,
      place,
      metres,
      onward
    }));
    return JSON.stringify({ options, memory: pendingPlan.memory });
  }
  function finishPlan(index2) {
    var _a2;
    const plan = pendingPlan;
    pendingPlan = null;
    return JSON.stringify((_a2 = plan == null ? void 0 : plan.finish(index2 < 0 ? null : index2)) != null ? _a2 : null);
  }
  return __toCommonJS(rules_exports);
})();
