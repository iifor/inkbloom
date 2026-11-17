// The mood of the view. Each frame it tells the renderer how much colour is around the player
// (the sky turns from a pencil sketch to a painted blue sky with it), how far the ink tide
// has drained the world (black and white, ink closing in from the edges), the time of day and
// year, and the weather where the player is (eased, so it never pops), with lightning. A
// listener like audio and effects: gameplay never reads it.
import { SEASONS } from '@/content/seasons';
import { TUNING } from '@/content/tuning';
import { dayHours } from '@/engine/render/daylight';
import { SEA_SLOTS } from '@/engine/render/paint-shader';
import { STEAM_SPRINGS } from '@/engine/render/steam';
import type { GameContext, System } from '@/game/types';
import { calendarAt, seasonBlend } from '@/world/climate/calendar';
import { meanTemperature, snowCover } from '@/world/climate/temperature';
import { type WeatherAt, boltsAt, createWeather } from '@/world/climate/weather';
import { smoothstep } from '@/world/math/noise';
import { influenceOf, saturationAt } from '@/world/wilderness/drain';
import { WATER_LEVEL } from '@/world/wilderness/generator';
import { bloomOf, SEA_FLOWERS, seasNear } from '@/world/wilderness/groves';
import { cleansedNear } from '@/world/wilderness/ink-wells';
import { springLevel, springsNear } from '@/world/wilderness/landmarks';

/** Gloom while a tide is announced, and while it rolls. */
const WARNING_GLOOM = 0.35;
const TIDE_GLOOM = 1;
/** Lightning within this many metres is seen and heard. */
const BOLT_REACH = 900;

/** The weather as the renderer and audio take it (see `InkRenderer.atmosphere.weather`). */
interface WeatherLook {
  cloud: number;
  rain: number;
  snowfall: number;
  fog: number;
  wet: number;
  freshSnow: number;
  windX: number;
  windZ: number;
  /** Petals or leaves blowing about (spring and autumn, in the wild). */
  litter: number;
  /** A rainbow could show (the renderer checks the sun), and hoar frost on the ground. */
  rainbow: number;
  frost: number;
}
const look = (): WeatherLook => ({
  cloud: 0,
  rain: 0,
  snowfall: 0,
  fog: 0,
  wet: 0,
  freshSnow: 0,
  windX: 0,
  windZ: 0,
  litter: 0,
  rainbow: 0,
  frost: 0,
});

export class AtmosphereSystem implements System {
  readonly id = 'atmosphere';
  private colour: number;
  private gloom = 0;
  private gloomTarget = 0;
  private sampleT = 0;
  private colourTarget: number;
  private readonly release: (() => void)[] = [];
  private readonly weather: WeatherAt;
  private readonly weatherNow = look();
  private readonly weatherTarget = look();
  private weatherT = 0;
  /** Jump straight to the weather on the next sample instead of easing (start, scene change). */
  private snap = true;
  private second = -1;
  private flash = 0;
  private litterSeason = 0;
  private springT = 0;

  constructor(private readonly ctx: GameContext) {
    this.weather = createWeather(ctx.wilderness);
    this.colourTarget = this.colour = this.sample();
    const set = (g: number) => () => void (this.gloomTarget = g);
    this.release.push(
      ctx.events.on('tide:warning', set(WARNING_GLOOM)),
      ctx.events.on('tide:start', set(TIDE_GLOOM)),
      ctx.events.on('tide:end', set(0)),
      // tides only run in the city the player is in; leaving it pauses them
      ctx.events.on('scene:entered', () => {
        this.gloomTarget = 0;
        this.sampleT = 0;
        this.weatherT = 0;
        this.snap = true;
      }),
    );
  }

  /** How much colour is around the player, 0..1. */
  private sample(): number {
    const { player, scenes, cities, wilderness } = this.ctx;
    const ref = scenes.active.ref;
    if (ref.kind === 'city') return cities.progress(ref.id);
    const p = player.position;
    const near = wilderness.entrancesNear(p.x, p.z, 1).map((e) => influenceOf(e, cities.progress(e.cityId)));
    return saturationAt(p.x, p.z, near, cleansedNear(wilderness, p.x, p.z, this.ctx.state.cleansed));
  }

  /** Where the weather is read: where the player stands, towns included. */
  private weatherPoint(): { x: number; z: number; ground: number } {
    const { x, z } = this.ctx.player.position;
    return { x, z, ground: Math.max(0, this.ctx.wilderness.heightAt(x, z)) };
  }

  private sampleWeather(snap: boolean): void {
    const { x, z, ground } = this.weatherPoint();
    const clock = this.ctx.state.clock;
    const w = this.weather(clock, x, z);
    // the shader lays settled snow by height itself; it only needs the fresh fall on top
    const settled = snowCover(meanTemperature(calendarAt(clock).yearPhase, ground));
    const t = this.weatherTarget;
    t.cloud = w.cloud;
    t.rain = w.precip * (1 - w.snow);
    t.snowfall = w.precip * w.snow;
    t.fog = w.fog;
    t.wet = w.wetness;
    t.freshSnow = Math.max(0, w.snowCover - settled);
    t.windX = w.wind[0];
    t.windZ = w.wind[1];
    t.rainbow = w.rainbow;
    t.frost = w.frost;
    // blossom and leaves come off in the wind, not in a downpour; there are no trees in a city
    const year = seasonBlend(calendarAt(clock).yearPhase);
    const litter =
      SEASONS[year.from]!.litter.amount * (1 - year.t) + SEASONS[year.to]!.litter.amount * year.t;
    const blow = Math.min(1, 0.3 + Math.hypot(w.wind[0], w.wind[1]) / 10);
    t.litter = litter * blow * (1 - 0.7 * w.precip);
    this.litterSeason = year.t < 0.5 ? year.from : year.to;
    if (snap) Object.assign(this.weatherNow, t);
  }

  /** Lightning in this play-clock second: draw the bolts, light the sky, let audio thunder. */
  private lightning(second: number): void {
    const { x, z } = this.weatherPoint();
    for (const b of boltsAt(this.weather, this.ctx.wilderness.seed, second, x, z, BOLT_REACH)) {
      const distance = Math.hypot(b.x - x, b.z - z);
      const at = { x: b.x, y: Math.max(0, this.ctx.wilderness.heightAt(b.x, b.z)), z: b.z };
      this.ctx.renderer.strike(at, b.shape);
      this.flash = Math.max(this.flash, 1 - (distance / BOLT_REACH) * 0.7);
      this.ctx.events.emit('weather:bolt', { at, distance });
    }
  }

  update(dt: number): void {
    this.sampleT -= dt;
    if (this.sampleT <= 0) {
      this.sampleT = 0.5;
      this.colourTarget = this.sample();
    }
    this.weatherT -= dt;
    if (this.weatherT <= 0) {
      this.sampleWeather(this.snap);
      this.snap = false;
      this.weatherT = 0.25;
    }
    // weather eases in over a few seconds, so nothing pops when the field crosses a threshold
    const k = Math.min(1, dt * 0.6);
    const now = this.weatherNow;
    for (const key of Object.keys(now) as (keyof WeatherLook)[])
      now[key] += (this.weatherTarget[key] - now[key]) * k;
    const second = Math.floor(this.ctx.state.clock);
    if (second !== this.second) {
      if (this.second !== -1) this.lightning(second);
      this.second = second;
    }
    this.flash = Math.max(0, this.flash - dt * 5);
    // colour comes back slowly; the tide's gloom rolls in faster than it lifts
    this.colour += (this.colourTarget - this.colour) * Math.min(1, dt * 1.5);
    const rate = this.gloomTarget > this.gloom ? 1.2 : 0.5;
    this.gloom += (this.gloomTarget - this.gloom) * Math.min(1, dt * rate);
    const a = this.ctx.renderer.atmosphere;
    a.colour = this.colour;
    a.gloom = this.gloom;
    const cal = calendarAt(this.ctx.state.clock);
    a.hour = cal.hour;
    a.declination = cal.declination;
    a.year = cal.yearPhase;
    a.seaTemp = meanTemperature(cal.yearPhase);
    Object.assign(a.weather, now);
    a.weather.flash = this.flash;
    a.weather.litterSeason = this.litterSeason;
    this.critters(dt, cal.hour, cal.declination, cal.yearPhase, now);
    this.springs(dt, cal.hour, now);
  }

  /** Flower seas in bloom within sight, for the paint pass's far wash of colour. */
  private seas(year: number): void {
    const { player, scenes, wilderness, renderer } = this.ctx;
    const near =
      scenes.active.ref.kind === 'wild'
        ? seasNear(wilderness, player.position.x, player.position.z, 450)
            .map((s) => ({ s, bloom: bloomOf(s.kind, year) }))
            .filter((o) => o.bloom > 0.02)
            .slice(0, SEA_SLOTS)
        : [];
    renderer.flowerSeas.forEach((v, i) => {
      const o = near[i];
      v.set(o?.s.x ?? 0, o?.s.z ?? 0, o?.s.r ?? 0, o ? SEA_FLOWERS[o.s.kind]!.colour + o.bloom * 0.9 : 0);
      renderer.flowerSeaLobes[i]!.set(o?.s.lobes[0] ?? 0, o?.s.lobes[1] ?? 0, 0, 0);
    });
  }

  /**
   * Hot springs near the player: their steam (thicker the colder the air at the pool, and in
   * the small hours) and the nearest one's warm patch where snow will not lie.
   */
  private springs(dt: number, hour: number, w: WeatherLook): void {
    const { player, scenes, wilderness, renderer } = this.ctx;
    this.springT -= dt;
    if (this.springT > 0) return;
    this.springT = 0.5;
    this.seas(renderer.atmosphere.year);
    const wild = scenes.active.ref.kind === 'wild';
    const near = wild
      ? springsNear(wilderness, player.position.x, player.position.z, 220).slice(0, STEAM_SPRINGS)
      : [];
    const sources = near.map((s) => ({ x: s.x, y: springLevel(s, wilderness), z: s.z, r: s.r }));
    const nearest = near[0];
    renderer.warmSpot.set(nearest?.x ?? 0, nearest?.z ?? 0, nearest?.r ?? 0, 0);
    const air =
      renderer.atmosphere.seaTemp -
      TUNING.season.lapse * (sources[0]?.y ?? 0) +
      4 * Math.sin((2 * Math.PI * (hour - 9)) / 24);
    renderer.steam.set(sources, 0.3 + 0.7 * smoothstep(20, 2, air), w.windX, w.windZ);
  }

  /** Fireflies on warm nights, butterflies on fair days, both only in coloured wild land; and
   * birds overhead by day. */
  private critters(dt: number, hour: number, declination: number, year: number, w: WeatherLook): void {
    const { player, scenes, wilderness, renderer } = this.ctx;
    const len = dayHours(declination);
    const day =
      smoothstep(11.5 - len / 2, 12.7 - len / 2, hour) *
      (1 - smoothstep(11.3 + len / 2, 12.5 + len / 2, hour));
    const sb = seasonBlend(year);
    const share = (s: number): number => (sb.from === s ? 1 - sb.t : 0) + (sb.to === s ? sb.t : 0);
    const [spring, summer, autumn] = [share(0), share(1), share(2)];
    const fair = (1 - Math.min(1, w.rain + w.snowfall)) * (scenes.active.ref.kind === 'wild' ? 1 : 0);
    // grey, drained land has none: they come back with the colour
    const life = smoothstep(0.3, 0.8, this.colour) * fair;
    const fireflies = (1 - day) * Math.min(1, summer + 0.5 * spring + 0.25 * autumn) * life;
    const calm = 1 - smoothstep(5, 10, Math.hypot(w.windX, w.windZ));
    const butterflies = day * (spring + summer + 0.3 * autumn) * calm * (1 - 0.6 * w.cloud) * life;
    renderer.critters.update(
      dt,
      player.position.x,
      player.position.z,
      (x, z) => Math.max(WATER_LEVEL, wilderness.heightAt(x, z)),
      { fireflies, butterflies, windX: w.windX, windZ: w.windZ },
    );
    // birds go to roost at dusk and keep off in rain and gales; fewer over grey land
    const gale = 1 - smoothstep(9, 16, Math.hypot(w.windX, w.windZ));
    const birds =
      day *
      (1 - Math.min(1, 1.5 * (w.rain + w.snowfall))) *
      gale *
      (0.35 + 0.65 * smoothstep(0.3, 0.8, this.colour));
    renderer.birds.update(
      dt,
      player.position.x,
      player.position.z,
      (x, z) => Math.max(WATER_LEVEL, wilderness.heightAt(x, z)),
      birds,
    );
  }

  dispose(): void {
    for (const r of this.release) r();
  }
}
