// Weather: a pure function of (seed, clock, position). Nothing is saved or sent: every client
// and a future server compute the same sky. Two cloud fields drift over the land with the
// prevailing wind at different speeds and angles, so rain areas grow, travel and fade instead of
// sliding past as one fixed picture. The season leans it wetter or drier, the land's own moisture
// adds a little, and temperature decides rain or snow. Ground wetness and fresh snow need a
// memory; they look back over the last few minutes instead of storing state.
// See docs/seasons-weather.md §5.
import { SEASONS } from '@/content/seasons';
import { TUNING } from '@/content/tuning';
import { hashAt, unit } from '../math/hash';
import { createNoise2D, fbm, smoothstep } from '../math/noise';
import type { Wilderness } from '../wilderness/generator';
import { calendarAt, seasonBlend } from './calendar';
import { meanTemperature, snowCover } from './temperature';

export interface Weather {
  /** Cloud cover, 0 clear .. 1 overcast. */
  readonly cloud: number;
  /** Rain or snow falling, 0..1. */
  readonly precip: number;
  /** Share of what falls that is snow, 0..1. */
  readonly snow: number;
  /** Wind, metres per second along +x (east) and +z (south): prevailing wind, gusts, storms. */
  readonly wind: readonly [number, number];
  /** Air temperature, °C. */
  readonly temp: number;
  /** Mist, 0..1. */
  readonly fog: number;
  /** How wet the ground is, 0..1: it stays wet a while after rain stops. */
  readonly wetness: number;
  /** Ground under snow, 0..1: settled cold-season snow, or a fresh fall. */
  readonly snowCover: number;
  /** Thunderstorm, 0..1: only heavy rain on a hot day. */
  readonly thunder: number;
}

/** The parts of the land the weather reads. */
export type WeatherLand = Pick<Wilderness, 'seed' | 'climate' | 'heightAt'>;

export type WeatherAt = (clock: number, x: number, z: number) => Weather;

/** Look-back for wetness: 8 samples, 75 s apart (10 minutes of play). */
const WET_STEP = 75;
/** Look-back for fresh snow: 8 samples, 150 s apart (20 minutes). */
const SNOW_STEP = 150;
const LOOKBACK = 8;
/** Steps in the precomputed path of the air over one year. */
const PATH_STEPS = 512;

export function createWeather(land: WeatherLand): WeatherAt {
  const W = TUNING.weather;
  const big = createNoise2D((land.seed ^ 0x7e3a91) >>> 0);
  const small = createNoise2D((land.seed ^ 0x1c55d2) >>> 0);
  const drift = createNoise2D((land.seed ^ 0x52b07f) >>> 0);
  const cosT = Math.cos(W.driftTurn);
  const sinT = Math.sin(W.driftTurn);

  /** Season-blended `wet` and prevailing wind at a year phase. */
  const season = (yearPhase: number): { wet: number; wx: number; wz: number } => {
    const { from, to, t } = seasonBlend(yearPhase);
    const a = SEASONS[from]!;
    const b = SEASONS[to]!;
    return {
      wet: a.wet + (b.wet - a.wet) * t,
      wx: a.wind[0] + (b.wind[0] - a.wind[0]) * t,
      wz: a.wind[1] + (b.wind[1] - a.wind[1]) * t,
    };
  };

  // How far the air has moved since the world's first spring: the prevailing wind integrated
  // over one year once, then whole years plus a lookup. The clouds drift exactly with the wind
  // as it turns through the seasons, however long the world has run.
  const year = 4 * TUNING.season.days * TUNING.day.length;
  const start = (TUNING.season.startDay + TUNING.day.startHour / 24) * TUNING.day.length;
  const path = new Float64Array(2 * (PATH_STEPS + 1));
  for (let i = 0; i < PATH_STEPS; i++) {
    const a = season(i / PATH_STEPS);
    const b = season((i + 1) / PATH_STEPS);
    const dt = year / PATH_STEPS;
    path[2 * i + 2] = path[2 * i]! + ((a.wx + b.wx) / 2) * dt;
    path[2 * i + 3] = path[2 * i + 1]! + ((a.wz + b.wz) / 2) * dt;
  }
  const carried = (clock: number): [number, number] => {
    const t = (clock + start) / year;
    const whole = Math.floor(t);
    const f = (t - whole) * PATH_STEPS;
    const i = Math.min(PATH_STEPS - 1, Math.floor(f));
    const u = f - i;
    const lap = (k: number): number => path[2 * PATH_STEPS + k]! * whole;
    return [
      lap(0) + path[2 * i]! + (path[2 * i + 2]! - path[2 * i]!) * u,
      lap(1) + path[2 * i + 1]! + (path[2 * i + 3]! - path[2 * i + 1]!) * u,
    ];
  };

  /** Humidity at a moment: the two drifting fields, the season's lean and the land's moisture. */
  const humidity = (clock: number, x: number, z: number, moisture: number): number => {
    const [dx, dz] = carried(clock);
    const k = W.driftSpeed;
    const ux = x - dx;
    const uz = z - dz;
    const vx = x - k * (dx * cosT - dz * sinT);
    const vz = z - k * (dx * sinT + dz * cosT);
    const field =
      0.6 * fbm(big, ux / W.fields[0], uz / W.fields[0], 2) +
      0.4 * fbm(small, vx / W.fields[1], vz / W.fields[1], 2);
    // a new world's first day is fair, so the first look at it is in sunshine
    const calm = 1 - smoothstep(W.calmStart[0], W.calmStart[1], clock);
    return field + season(calendarAt(clock).yearPhase).wet + W.landMoisture * moisture - calm;
  };
  const precipOf = (h: number): number => smoothstep(W.rainFrom, W.rainFull, h);

  /** Air temperature: the day's mean for the season and height, the day's swing, a slow wander. */
  const temperature = (clock: number, height: number): number => {
    const cal = calendarAt(clock);
    const days = clock / TUNING.day.length;
    return (
      meanTemperature(cal.yearPhase, height) +
      W.dayNight * Math.sin((2 * Math.PI * (cal.hour - 9)) / 24) +
      W.wander * drift(days / 2.5, 0.5)
    );
  };

  return (clock, x, z) => {
    const c = land.climate(x, z);
    const height = Math.max(0, land.heightAt(x, z));
    const cal = calendarAt(clock);
    const h = humidity(clock, x, z, c.moisture);
    const cloud = smoothstep(W.cloudFrom, W.cloudFull, h);
    const precip = precipOf(h);
    const temp = temperature(clock, height);
    const snow = smoothstep(2, -1, temp);

    let wetness = 0;
    let fresh = 0;
    for (let k = 0; k < LOOKBACK; k++) {
      const tw = clock - k * WET_STEP;
      wetness = Math.max(wetness, precipOf(humidity(tw, x, z, c.moisture)) * 0.8 ** k);
      const ts = clock - k * SNOW_STEP;
      const fall = precipOf(humidity(ts, x, z, c.moisture)) * smoothstep(2, -1, temperature(ts, height));
      fresh = Math.max(fresh, fall * 0.9 ** k);
    }
    // a fresh fall melts off once it is above freezing; settled snow follows the day's mean
    const settled = snowCover(meanTemperature(cal.yearPhase, height));
    const cover = Math.max(settled, fresh * smoothstep(5, 1, temp));
    // rain on snow is slush, not wet grass
    wetness *= 1 - cover;

    const s = season(cal.yearPhase);
    // some days are blustery whether or not it rains: the prevailing wind blows up for a while
    const windy = 1 + W.windyDays * smoothstep(0.25, 0.75, drift(clock / TUNING.day.length / 1.5, 3.1));
    const gust = windy * (1 + W.gust * drift(clock / 40, 7.3));
    const len = Math.hypot(s.wx, s.wz) || 1;
    const storm = W.stormWind * precip;
    const wind: [number, number] = [s.wx * gust + (s.wx / len) * storm, s.wz * gust + (s.wz / len) * storm];
    const speed = Math.hypot(wind[0], wind[1]);

    // morning mist on damp, still ground; a haze in any rain
    const morning = smoothstep(3, 5, cal.hour) * (1 - smoothstep(7, 10, cal.hour));
    // `water` is small along rivers and lakes
    const nearWater = smoothstep(0.12, 0.03, c.water);
    const damp = Math.min(1, 0.4 * Math.max(0, c.moisture) + 0.6 * wetness + 0.3 * cloud + 0.4 * nearWater);
    const fog = Math.max(smoothstep(0.35, 0.8, damp) * morning * (1 - smoothstep(3, 8, speed)), 0.4 * precip);

    const thunder = smoothstep(0.55, 1, precip) * smoothstep(19, 27, temp);
    return { cloud, precip, snow, wind, temp, fog, wetness, snowCover: cover, thunder };
  };
}

/** A lightning strike: where it lands, and a number that picks its jagged shape. */
export interface Bolt {
  readonly x: number;
  readonly z: number;
  readonly shape: number;
}

/** Metres across a lightning cell, and the chance a cell strikes in a second of full storm. */
const BOLT_CELL = 300;
const BOLT_RATE = 0.06;

/**
 * Lightning that strikes during play-clock second `second` within `radius` metres of (x, z).
 * Every cell rolls once a second against the thunder at its centre, so everyone sees the same
 * bolts at the same moment without anything being sent.
 */
export function boltsAt(
  weather: WeatherAt,
  seed: number,
  second: number,
  x: number,
  z: number,
  radius: number,
): Bolt[] {
  const out: Bolt[] = [];
  const s = Math.floor(second);
  const c0x = Math.floor((x - radius) / BOLT_CELL);
  const c1x = Math.floor((x + radius) / BOLT_CELL);
  const c0z = Math.floor((z - radius) / BOLT_CELL);
  const c1z = Math.floor((z + radius) / BOLT_CELL);
  for (let cx = c0x; cx <= c1x; cx++)
    for (let cz = c0z; cz <= c1z; cz++) {
      const roll = unit(hashAt(seed, 'bolt', s, cx, cz));
      if (roll >= BOLT_RATE) continue;
      const thunder = weather(s, (cx + 0.5) * BOLT_CELL, (cz + 0.5) * BOLT_CELL).thunder;
      if (roll >= BOLT_RATE * thunder) continue;
      const h = hashAt(seed, 'bolt-at', s, cx, cz);
      const bx = (cx + unit(h)) * BOLT_CELL;
      const bz = (cz + unit(Math.imul(h, 0x9e3779b1))) * BOLT_CELL;
      if (Math.hypot(bx - x, bz - z) <= radius) out.push({ x: bx, z: bz, shape: h });
    }
  return out;
}
