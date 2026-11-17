// Plain-DOM heads-up display. Reads game state once per frame and only touches the DOM when a
// value changed. Menus will move to a UI framework later; the HUD stays plain DOM.
//
// A quiet HUD: most of the time only the crosshair is on screen. Things appear when they have
// something to say and fade again: the objective when it changes (or on J), resources when
// they change, block progress when it moves, what the tool in hand is doing when that changes
// (or while aiming it at something), health when hurt, a title card on arriving somewhere.
// Lessons (toast `once`) show the first time only.
import { PALETTE } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import type { GameContext, System } from '@/game/types';
import { CityScene } from '@/systems/city/city-scene';
import type { SceneManager } from '@/systems/scenes/scene-manager';
import type { ToolBelt } from '@/systems/tools/tool';
import type { ObjectiveSystem } from './objectives';
import { SIDE_NAMES, type TideStatus } from '@/systems/city/ink-tide';
import { levelProgress } from '@/world/progression';
import { WEAPONS } from '@/content/weapons';
import { lesson } from './hints';

/** Seconds things stay up after they change. */
const SHOW = {
  goal: 8,
  recall: 6,
  res: 3,
  progress: 4,
  slots: 2.5,
  tool: 3,
  title: 3.5,
  fullHealth: 2,
} as const;
/** Most messages on screen at once; the oldest goes first. */
const MAX_TOASTS = 3;

/** HUD time, in seconds: wall clock, so fades run on while the game is paused too. */
const now = (): number => performance.now() / 1000;
function tideLine(t: TideStatus | null, here: number): string {
  if (!t) return '';
  const where = t.chunk === here ? '本街区' : '附近街区';
  if (t.phase === 'warning')
    return `墨潮 · ${Math.ceil(t.seconds)} 秒后从${SIDE_NAMES[t.from]}边涌向${where}`;
  // how to push it back is a lesson when the wave starts; here only what is happening
  const state = t.blocked ?? (t.pushing ? '推回中' : '');
  return `墨潮 ${Math.round(t.front * 100)}% · ${Math.ceil(t.seconds)} 秒${state ? ` · ${state}` : ''}`;
}

const LOW_HEALTH = TUNING.combat.feel.lowHealth;

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
    | 'lowhp'
    | 'tide'
    | 'slots'
    | 'lines'
    | 'bar'
    | 'barFill'
    | 'prompt'
    | 'toasts'
    | 'swatch'
    | 'title'
    | 'titleText'
    | 'titleSub'
    | 'tool',
    HTMLElement
  >;
  private readonly cache = new Map<string, string>();
  private readonly release: (() => void)[] = [];
  /** HUD times until which each part stays up (see SHOW). */
  private goalUntil = 0;
  private recallUntil = 0;
  private resUntil = 0;
  private progressUntil = 0;
  private slotsUntil = 0;
  private toolUntil = 0;
  private fullSince = 0;
  private goalSeenAt = -Infinity;
  private lastParts: { level: string; ink: string; generic: string } | null = null;
  private resNews = '';
  private lastProgress = '';
  private lastTool = -1;
  private lastToolLine = '';

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
      <div class="hud-lowhp" data-k="lowhp"></div>
      <div class="hud-hurt" data-k="hurt"></div>
      <div class="hud-cross"></div>
      <div class="hud-hp" data-k="hp"><i data-k="hpFill"></i></div>
      <div class="hud-bar" data-k="bar"><i data-k="barFill"></i></div>
      <div class="hud-prompt" data-k="prompt"></div>
      <div class="hud-tool" data-k="tool"><div class="hud-slots" data-k="slots"></div><span class="hud-swatch" data-k="swatch"></span><div data-k="lines"></div></div>
      <div class="hud-toasts" data-k="toasts"></div>
      <div class="hud-title" data-k="title"><b data-k="titleText"></b><span data-k="titleSub"></span></div>`;
    const q = (k: string): HTMLElement => root.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
    this.el = {
      place: q('place'),
      progress: q('progress'),
      res: q('res'),
      goal: q('goal'),
      hp: q('hp'),
      hpFill: q('hpFill'),
      hurt: q('hurt'),
      lowhp: q('lowhp'),
      tide: q('tide'),
      slots: q('slots'),
      lines: q('lines'),
      bar: q('bar'),
      barFill: q('barFill'),
      prompt: q('prompt'),
      toasts: q('toasts'),
      swatch: q('swatch'),
      title: q('title'),
      titleText: q('titleText'),
      titleSub: q('titleSub'),
      tool: q('tool'),
    };
    this.release.push(
      ctx.events.on('toast', ({ text, seconds, once }) => {
        // a lesson already learned is not repeated
        if (once && !lesson(once)) return;
        this.toast(text, seconds);
      }),
    );
    this.release.push(ctx.events.on('title', ({ text, sub }) => this.title(text, sub)));
    this.release.push(ctx.events.on('player:hurt', () => this.flash(this.el.hurt, 'on', 250)));
    this.release.push(ctx.events.on('growth:level', ({ level }) => this.toast(`升到 ${level} 级`, 4)));
    this.release.push(
      ctx.events.on('weapon:unlocked', ({ key }) => {
        const w = WEAPONS.find((x) => x.key === key);
        if (w) this.toast(`得到新武器：${w.name}`, 5);
      }),
    );
    this.release.push(
      ctx.events.on('growth:points', ({ gained }) => this.toast(`获得 ${gained} 个属性点（Tab）`, 4)),
    );
    this.release.push(
      // hit marker: a cross round the crosshair; a bigger red one for a kill
      ctx.events.on('shot:hit', ({ killed }) =>
        this.flash(
          root.querySelector<HTMLElement>('.hud-cross')!,
          killed ? 'kill' : 'hit',
          killed ? 260 : 150,
        ),
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
    const box = this.el.toasts;
    // the same message twice in a row says nothing new
    for (const c of box.children) if (c.textContent === text) return;
    while (box.children.length >= MAX_TOASTS) box.firstElementChild?.remove();
    const t = document.createElement('div');
    t.textContent = text;
    box.append(t);
    setTimeout(() => t.remove(), seconds * 1000);
  }

  /** A place name across the upper screen; update() fades it in, holds it, fades it out. */
  private title(text: string, sub?: string): void {
    this.el.titleText.textContent = text;
    this.el.titleSub.textContent = sub ?? '';
    this.titleAt = now();
  }

  private titleAt = -Infinity;

  /** The title card's opacity at HUD time t: in over 0.8 s, held, out over 1 s. */
  private titleFade(t: number): number {
    const age = t - this.titleAt;
    if (age < 0.8) return age / 0.8;
    if (age < SHOW.title) return 1;
    return Math.max(0, 1 - (age - SHOW.title));
  }

  /** Show or hide an element with the HUD's fade (only touching the DOM on a change). */
  private shown(key: string, el: HTMLElement, on: boolean): void {
    const v = on ? '1' : '0';
    if (this.cache.get(`shown:${key}`) === v) return;
    this.cache.set(`shown:${key}`, v);
    el.classList.toggle('quiet', !on);
  }

  update(): void {
    const t = now();
    const scene = this.scenes.active;
    const brush = this.belt.active?.id === 'brush';
    if (this.ctx.input.pressed('goal')) this.recallUntil = t + SHOW.recall;
    if (this.objectives.changedAt !== this.goalSeenAt) {
      this.goalSeenAt = this.objectives.changedAt;
      this.goalUntil = t + SHOW.goal;
    }
    const recall = t < this.recallUntil;
    // driven from here rather than a CSS transition, so it fades the same in every browser
    const fade = this.titleFade(t).toFixed(2);
    if (this.cache.get('titleFade') !== fade) {
      this.cache.set('titleFade', fade);
      this.el.title.style.opacity = fade;
      this.el.title.style.transform = `translate(-50%, ${((1 - Number(fade)) * 8).toFixed(1)}px)`;
    }
    const goalOn = recall || t < this.goalUntil;
    // in the arena the quest can wait: the strip at the top says what matters
    const arena = this.ctx.arena?.inside ?? false;
    this.set('place', this.el.place, arena ? '竞技场' : scene.name);
    let progress = '';
    if (scene instanceof CityScene) {
      const chunk = scene.chunkAt(this.ctx.player.position);
      progress = `街区 ${Math.round(scene.progress(chunk) * 100)}% · 全城 ${Math.round(scene.progress() * 100)}%`;
      this.set('tide', this.el.tide, tideLine(scene.tide.status(), chunk));
    } else this.set('tide', this.el.tide, '');
    // block progress is news when it moves (a surface painted, another district walked into)
    if (progress !== this.lastProgress) {
      if (progress) this.progressUntil = t + SHOW.progress;
      this.lastProgress = progress;
    }
    this.set('progress', this.el.progress, progress);
    const progressOn = scene instanceof CityScene && (recall || (brush && t < this.progressUntil));
    this.shown('progress', this.el.progress, progressOn);
    const inv = this.ctx.state.inventory;
    const g = this.ctx.state.growth;
    const lp = levelProgress(g.xp);
    const points = g.points ? ` · ${g.points} 属性点（Tab）` : '';
    const parts = {
      level: `Lv ${lp.level}${points}`,
      ink: `墨 ${inv.ink}`,
      generic: `颜料 ${inv.generic}`,
    };
    // news is only what changed: a new level or points, ink, pigment (unless the brush's own
    // line is already counting it). Experience ticking up is not; the first values are not
    if (this.lastParts) {
      const changed = (Object.keys(parts) as (keyof typeof parts)[]).filter(
        (k) => parts[k] !== this.lastParts![k] && !(k === 'generic' && brush),
      );
      if (changed.length) {
        this.resNews = changed.map((k) => parts[k]).join(' · ');
        this.resUntil = t + SHOW.res;
      }
    }
    this.lastParts = parts;
    // J shows the lot
    const all = `Lv ${lp.level}${lp.need ? ` (${lp.into}/${lp.need})` : ''}${points} · ${parts.ink} · ${parts.generic}`;
    this.set('res', this.el.res, recall ? all : this.resNews);
    const resOn = recall || t < this.resUntil;
    this.shown('res', this.el.res, resOn);
    this.set('goal', this.el.goal, this.objectives.text);
    this.shown('goal', this.el.goal, goalOn && !arena);
    this.shown('place', this.el.place.parentElement!, goalOn || resOn || progressOn);
    const { hp, maxHp, alive } = this.ctx.combat;
    const pct = `${Math.round((hp / maxHp) * 100)}%`;
    if (this.cache.get('hp') !== pct) {
      this.cache.set('hp', pct);
      this.el.hpFill.style.width = pct;
      this.el.hp.classList.toggle('low', hp < maxHp * LOW_HEALTH);
      // low on health: ink creeps in from the screen edges, thicker the closer to falling
      const low = alive ? Math.max(0, 1 - hp / (maxHp * LOW_HEALTH)) : 0;
      this.el.lowhp.style.opacity = low.toFixed(2);
    }
    this.el.hurt.classList.toggle('dead', !alive);
    // health is news only when it is not full
    if (hp < maxHp || !alive) this.fullSince = t;
    this.shown('hp', this.el.hp, t - this.fullSince < SHOW.fullHealth);

    this.set(
      'slots',
      this.el.slots,
      this.belt.tools
        .map((tool, i) => `${i === this.belt.index ? '▸' : ' '}${i + 1} ${tool.name}`)
        .join('   '),
    );
    // which slot is which: shown for a moment after switching
    if (this.belt.index !== this.lastTool) {
      if (this.lastTool >= 0) this.slotsUntil = t + SHOW.slots;
      this.lastTool = this.belt.index;
    }
    this.shown('slots', this.el.slots, recall || t < this.slotsUntil);
    const hud = this.ctx.player.waterMode === 'swimming' ? undefined : this.belt.active?.hud();
    // the tool's own line (mode and pigment, weapon and ammo) is news when it changes; the rest
    // (what the brush is aimed at, a skill cooling down) shows for as long as it is there
    const [own = '', ...rest] = hud?.lines ?? [];
    if (own !== this.lastToolLine) {
      if (this.lastToolLine) this.toolUntil = t + SHOW.tool;
      this.lastToolLine = own;
    }
    const busy = hud?.progress !== null && hud?.progress !== undefined;
    const ownOn = recall || busy || t < this.toolUntil || t < this.slotsUntil;
    const lines = [
      ...(ownOn && own ? [own] : []),
      ...rest,
      ...(this.ctx.player.gliding ? ['纸飞机滑翔中'] : []),
    ];
    this.set('lines', this.el.lines, lines.join('\n'));
    this.shown('tool', this.el.tool, lines.length > 0 || recall || t < this.slotsUntil);
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
