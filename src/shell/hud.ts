// Plain-DOM heads-up display. Reads game state once per frame and only touches the DOM when a
// value changed. Menus will move to a UI framework later; the HUD stays plain DOM.
import { PALETTE } from '@/content/palette';
import type { GameContext, System } from '@/game/types';
import { CityScene } from '@/systems/city/city-scene';
import type { SceneManager } from '@/systems/scenes/scene-manager';
import type { ToolBelt } from '@/systems/tools/tool';
import type { ObjectiveSystem } from './objectives';
import { SIDE_NAMES, type TideStatus } from '@/systems/city/ink-tide';
import { BLOCK_NAMES, blockState } from '@/world/city/blocks';

function tideLine(t: TideStatus | null, here: number): string {
  if (!t) return '';
  const where = t.chunk === here ? '本街区' : '附近街区';
  if (t.phase === 'warning') return `墨潮 ${Math.ceil(t.seconds)} 秒后从${SIDE_NAMES[t.from]}边涌向${where}`;
  const action = t.blocked ?? (t.pushing ? '正在推回墨潮' : '对准墨帘按住左键推回（消耗通用颜料）');
  return `墨潮侵入${where} ${Math.round(t.front * 100)}% · 剩 ${Math.ceil(t.seconds)} 秒 · ${action}`;
}

const css = (rgb: readonly number[]): string => `rgb(${rgb.map((v) => Math.round(v * 255)).join(',')})`;

export class Hud implements System {
  readonly id = 'hud';
  private readonly el: Record<
    | 'place'
    | 'progress'
    | 'res'
    | 'goal'
    | 'hp'
    | 'hpFill'
    | 'hurt'
    | 'tide'
    | 'slots'
    | 'lines'
    | 'bar'
    | 'barFill'
    | 'prompt'
    | 'toasts'
    | 'swatch',
    HTMLElement
  >;
  private readonly cache = new Map<string, string>();
  private readonly release: (() => void)[] = [];

  constructor(
    private readonly ctx: GameContext,
    private readonly root: HTMLElement,
    private readonly belt: ToolBelt,
    private readonly scenes: SceneManager,
    private readonly objectives: ObjectiveSystem,
  ) {
    root.innerHTML = `
      <div class="hud-place"><b data-k="place"></b><span data-k="progress"></span><div class="hud-res" data-k="res"></div><div class="hud-goal" data-k="goal"></div></div>
      <div class="hud-tide" data-k="tide"></div>
      <div class="hud-hurt" data-k="hurt"></div>
      <div class="hud-cross"></div>
      <div class="hud-hp" data-k="hp"><i data-k="hpFill"></i></div>
      <div class="hud-bar" data-k="bar"><i data-k="barFill"></i></div>
      <div class="hud-prompt" data-k="prompt"></div>
      <div class="hud-tool"><div class="hud-slots" data-k="slots"></div><span class="hud-swatch" data-k="swatch"></span><div data-k="lines"></div></div>
      <div class="hud-toasts" data-k="toasts"></div>`;
    const q = (k: string): HTMLElement => root.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
    this.el = {
      place: q('place'),
      progress: q('progress'),
      res: q('res'),
      goal: q('goal'),
      hp: q('hp'),
      hpFill: q('hpFill'),
      hurt: q('hurt'),
      tide: q('tide'),
      slots: q('slots'),
      lines: q('lines'),
      bar: q('bar'),
      barFill: q('barFill'),
      prompt: q('prompt'),
      toasts: q('toasts'),
      swatch: q('swatch'),
    };
    this.release.push(ctx.events.on('toast', ({ text, seconds }) => this.toast(text, seconds)));
    this.release.push(ctx.events.on('player:hurt', () => this.flash(this.el.hurt, 'on', 250)));
    this.release.push(
      ctx.events.on('shot:hit', ({ killed }) =>
        this.flash(root.querySelector<HTMLElement>('.hud-cross')!, killed ? 'kill' : 'hit', 120),
      ),
    );
  }

  private set(key: string, el: HTMLElement, text: string): void {
    if (this.cache.get(key) === text) return;
    this.cache.set(key, text);
    el.textContent = text;
  }

  private flash(el: HTMLElement, cls: string, ms: number): void {
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  toast(text: string, seconds = 2.5): void {
    const t = document.createElement('div');
    t.textContent = text;
    this.el.toasts.append(t);
    setTimeout(() => t.remove(), seconds * 1000);
  }

  update(): void {
    const scene = this.scenes.active;
    this.set('place', this.el.place, scene.name);
    if (scene instanceof CityScene) {
      const chunk = scene.chunkAt(this.ctx.player.position);
      const here = scene.progress(chunk);
      const stains = scene.stains.remaining(chunk);
      this.set(
        'progress',
        this.el.progress,
        ` 街区${BLOCK_NAMES[blockState(here)]} ${Math.round(here * 100)}% · 全城 ${Math.round(scene.progress() * 100)}% · 本街区墨渍 ${stains}`,
      );
      this.set('tide', this.el.tide, tideLine(scene.tide.status(), chunk));
    } else {
      this.set('progress', this.el.progress, '');
      this.set('tide', this.el.tide, '');
    }
    const inv = this.ctx.state.inventory;
    this.set('res', this.el.res, `墨 ${inv.ink} · 通用颜料 ${inv.generic}`);
    this.set('goal', this.el.goal, this.objectives.text);
    const { hp, maxHp, alive } = this.ctx.combat;
    const pct = `${Math.round((hp / maxHp) * 100)}%`;
    if (this.cache.get('hp') !== pct) {
      this.cache.set('hp', pct);
      this.el.hpFill.style.width = pct;
      this.el.hp.classList.toggle('low', hp < maxHp * 0.3);
    }
    this.el.hurt.classList.toggle('dead', !alive);

    this.set(
      'slots',
      this.el.slots,
      this.belt.tools.map((t, i) => `${i === this.belt.index ? '▸' : ' '}${i + 1} ${t.name}`).join('   '),
    );
    const hud = this.belt.active?.hud();
    this.set('lines', this.el.lines, hud?.lines.join('\n') ?? '');
    const sw = hud?.swatch ?? null;
    const swKey = String(sw);
    if (this.cache.get('swatch') !== swKey) {
      this.cache.set('swatch', swKey);
      this.el.swatch.style.display = sw === null ? 'none' : 'inline-block';
      if (sw !== null) this.el.swatch.style.background = css(PALETTE[sw]!.rgb);
    }
    const p = hud?.progress ?? null;
    this.el.bar.style.visibility = p === null ? 'hidden' : 'visible';
    if (p !== null) this.el.barFill.style.width = `${Math.round(p * 100)}%`;
    const focused = this.ctx.interactions.focused;
    const alt = focused?.alt?.label() ?? null;
    this.set('prompt', this.el.prompt, focused ? focused.label() + (alt ? `\n${alt}` : '') : '');
  }

  dispose(): void {
    for (const r of this.release) r();
    this.root.innerHTML = '';
  }
}
