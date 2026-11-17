// F3 panel. F3 cycles: a single quiet frame-rate line (the default while developing), the full
// panel (frame time, position, chunk, biome, colliders, date and weather), and off. F2 toggles
// free flight (in the player system). Purely diagnostic; safe to delete from a mode.
import { BIOMES } from '@/content/biomes';
import { SEASONS } from '@/content/seasons';
import { TUNING } from '@/content/tuning';
import { dayHours } from '@/engine/render/daylight';
import type { GameContext, System } from '@/game/types';
import { calendarAt } from '@/world/climate/calendar';
import { type WeatherAt, createWeather } from '@/world/climate/weather';

export class DebugPanel implements System {
  readonly id = 'debug';
  private readonly el: HTMLElement;
  /** What is shown; F3 moves to the next. Off by default in a release build. */
  private mode: 'fps' | 'full' | 'off' = import.meta.env.DEV ? 'fps' : 'off';
  private frames = 0;
  private acc = 0;
  private fps = 0;
  private readonly weather: WeatherAt;

  constructor(
    private readonly ctx: GameContext,
    parent: HTMLElement,
  ) {
    this.weather = createWeather(ctx.wilderness);
    this.el = document.createElement('pre');
    this.el.className = 'debug-panel';
    parent.append(this.el);
  }

  update(dt: number): void {
    if (this.ctx.input.pressed('debugPanel'))
      this.mode = this.mode === 'fps' ? 'full' : this.mode === 'full' ? 'off' : 'fps';
    this.el.style.display = this.mode === 'off' ? 'none' : 'block';
    this.el.classList.toggle('compact', this.mode === 'fps');
    this.frames++;
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    if (this.mode === 'off') return;
    if (this.mode === 'fps') {
      // frame rate and frame time; the drawing scale too when automatic resolution lowered it
      const scale = this.ctx.renderer.resolutionScale;
      const ms = this.fps > 0 ? 1000 / this.fps : 0;
      this.el.textContent = `${this.fps.toFixed(0)} fps · ${ms.toFixed(1)} ms${scale < 1 ? ` · ${Math.round(scale * 100)}% 分辨率` : ''}`;
      return;
    }
    const p = this.ctx.player.position;
    const size = TUNING.world.chunkSize;
    const scene = this.ctx.scenes.active;
    const biome = scene.ref.kind === 'wild' ? BIOMES[this.ctx.wilderness.biomeAt(p.x, p.z)]!.name : '-';
    const cal = calendarAt(this.ctx.state.clock);
    const hh = Math.floor(cal.hour);
    const mm = Math.floor((cal.hour - hh) * 60);
    const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    this.el.textContent = [
      `${this.fps.toFixed(0)} fps · ${this.ctx.renderer.renderer.info.render.calls} draws · ${(this.ctx.renderer.renderer.info.render.triangles / 1000).toFixed(0)}k tris · ${Math.round(this.ctx.renderer.resolutionScale * 100)}%`,
      `pos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} · yaw ${this.ctx.player.yaw.toFixed(2)}`,
      `chunk ${Math.floor(p.x / size)},${Math.floor(p.z / size)} · ${biome}`,
      `scene ${scene.ref.kind === 'wild' ? 'wild' : scene.ref.id} · colliders ${scene.physics.boxCount}`,
      `${this.ctx.player.flying ? 'FLY (F2)' : 'walk (F2 fly)'} · seed ${this.ctx.state.seed}`,
      `${SEASONS[cal.season]!.name} 第 ${cal.seasonDay} 天 ${time} · 日长 ${dayHours(cal.declination).toFixed(1)} h`,
      ...(scene.ref.kind === 'wild' ? this.weatherLines(p.x, p.z) : []),
    ].join('\n');
  }

  /** The weather where the player stands (not drawn yet: these numbers are all there is). */
  private weatherLines(x: number, z: number): string[] {
    const w = this.weather(this.ctx.state.clock, x, z);
    const n = (v: number): string => v.toFixed(2);
    const falling = w.precip === 0 ? '-' : w.snow > 0.5 ? `雪 ${n(w.precip)}` : `雨 ${n(w.precip)}`;
    return [
      `${w.temp.toFixed(1)}°C · 云 ${n(w.cloud)} · ${falling} · 雷 ${n(w.thunder)} · 雾 ${n(w.fog)}`,
      `风 ${Math.hypot(...w.wind).toFixed(1)} m/s (${w.wind[0].toFixed(1)}, ${w.wind[1].toFixed(1)}) · 湿 ${n(w.wetness)} · 积雪 ${n(w.snowCover)}`,
      `虹 ${n(w.rainbow)} · 霜 ${n(w.frost)}`,
    ];
  }

  dispose(): void {
    this.el.remove();
  }
}
