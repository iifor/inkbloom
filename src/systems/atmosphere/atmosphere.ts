// The mood of the view. Each frame it tells the renderer how much colour is around the player
// (the sky turns from a pencil sketch to a painted blue sky with it), how far the ink tide
// has drained the world (black and white, ink closing in from the edges), the time of day and
// year, and the weather where the player is (eased, so it never pops), with lightning. A
// listener like audio and effects: gameplay never reads it.
import { TUNING } from '@/content/tuning';
import type { GameContext, System } from '@/game/types';
import { calendarAt } from '@/world/climate/calendar';
import { meanTemperature, snowCover } from '@/world/climate/temperature';
import { type WeatherAt, boltsAt, createWeather } from '@/world/climate/weather';
import { saturationAt } from '@/world/wilderness/drain';

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
    const near = wilderness
      .entrancesNear(p.x, p.z, 1)
      .map((e) => ({ x: e.x, z: e.z, progress: cities.progress(e.cityId) }));
    return saturationAt(p.x, p.z, near);
  }

  /** Where the weather is read: the player in the wild; in a city, its entrance tower outside
   * (a city is its own scene with its own coordinates). */
  private weatherPoint(): { x: number; z: number; ground: number } {
    const { player, scenes, wilderness } = this.ctx;
    const ref = scenes.active.ref;
    const m = ref.kind === 'city' ? /^c(-?\d+)_(-?\d+)$/.exec(ref.id) : null;
    const size = TUNING.world.chunkSize;
    const x = m ? (Number(m[1]) + 0.5) * size : player.position.x;
    const z = m ? (Number(m[2]) + 0.5) * size : player.position.z;
    return { x, z, ground: Math.max(0, wilderness.heightAt(x, z)) };
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
    if (snap) Object.assign(this.weatherNow, t);
  }

  /** Lightning in this play-clock second: draw the bolts, light the sky, let audio thunder. */
  private lightning(second: number): void {
    const { x, z } = this.weatherPoint();
    const wild = this.ctx.scenes.active.ref.kind === 'wild';
    for (const b of boltsAt(this.weather, this.ctx.wilderness.seed, second, x, z, BOLT_REACH)) {
      const distance = Math.hypot(b.x - x, b.z - z);
      const at = { x: b.x, y: Math.max(0, this.ctx.wilderness.heightAt(b.x, b.z)), z: b.z };
      // in a city the bolts are out over the walls: only their light and sound come through
      if (wild) this.ctx.renderer.strike(at, b.shape);
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
  }

  dispose(): void {
    for (const r of this.release) r();
  }
}
