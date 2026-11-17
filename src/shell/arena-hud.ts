// The arena on the HUD, while this player is in it: a paper strip at the top with the score and
// the time, who went down lately at the right, and the whole table while Tab is held.
import { ARENA } from '@/content/arena';
import type { GameContext, System } from '@/game/types';
import { TEAM_COLORS, TEAM_NAMES, type ArenaSystem } from '@/systems/arena/arena-system';
import { PALETTE } from '@/content/palette';

const css = (index: number): string => {
  const c = PALETTE[index]?.rgb ?? [0, 0, 0];
  return `rgb(${c.map((v) => Math.round(v * 255)).join(', ')})`;
};
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** Redraws a second at most this often (the strip only shows whole seconds). */
const EVERY = 0.2;

export class ArenaHud implements System {
  readonly id = 'arena-hud';
  private readonly strip: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly table: HTMLElement;
  private wait = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly arena: ArenaSystem,
    parent: HTMLElement,
  ) {
    this.strip = document.createElement('div');
    this.strip.className = 'arena-strip';
    this.feed = document.createElement('div');
    this.feed.className = 'arena-feed';
    this.table = document.createElement('div');
    this.table.className = 'arena-table';
    parent.append(this.strip, this.feed, this.table);
    this.hide();
  }

  private hide(): void {
    this.strip.hidden = true;
    this.feed.hidden = true;
    this.table.hidden = true;
  }

  update(dt: number): void {
    const a = this.arena;
    const s = a.state;
    if (!a.inside || !s) {
      this.hide();
      return;
    }
    // the table while Tab is held
    const tab = this.ctx.input.held('character');
    this.table.hidden = !tab;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = EVERY;
    this.strip.hidden = false;
    const left = clock(a.secondsLeft());
    const mine = s.members.find((m) => m.id === a.me);
    switch (s.phase) {
      case 'waiting':
        this.strip.textContent = `竞技场 · 等对手进来（${s.members.length} 人）`;
        break;
      case 'countdown':
        this.strip.textContent = `${Math.ceil(a.secondsLeft())} 秒后开始 · 投票：${s.mode === 'teams' ? '组队' : '混战'}（Esc 菜单里改）`;
        break;
      case 'results':
        this.strip.textContent = `这一局结束 · ${left} 后下一局`;
        break;
      case 'fighting':
        if (s.mode === 'teams') {
          const kills = [0, 1].map((t) =>
            s.members.filter((m) => m.team === t).reduce((n, m) => n + m.kills, 0),
          );
          this.strip.innerHTML = `<b style="color:${css(TEAM_COLORS[0])}">${TEAM_NAMES[0]} ${kills[0]}</b> : <b style="color:${css(TEAM_COLORS[1])}">${kills[1]} ${TEAM_NAMES[1]}</b> · 先到 ${ARENA.killsTeams} · ${left}`;
        } else {
          const best = Math.max(0, ...s.members.map((m) => m.kills));
          this.strip.textContent = `混战 · 你 ${mine?.kills ?? 0} 杀 · 最高 ${best} · 先到 ${ARENA.killsFfa} · ${left}`;
        }
        break;
    }
    this.feed.hidden = a.feed.length === 0;
    this.feed.replaceChildren(
      ...a.feed.map((f) => {
        const el = document.createElement('div');
        el.textContent = f.text;
        if (f.mine) el.className = 'mine';
        return el;
      }),
    );
    if (tab) this.drawTable();
  }

  private drawTable(): void {
    const a = this.arena;
    const s = a.state!;
    const rows = [...s.members].sort((x, y) => y.kills - x.kills || x.deaths - y.deaths);
    const head = `<div class="row head"><span>玩家</span><span>击倒</span><span>倒下</span></div>`;
    const body = rows
      .map((m) => {
        const team =
          s.mode === 'teams' && m.team >= 0
            ? `style="border-left-color:${css(TEAM_COLORS[m.team as 0 | 1])}"`
            : '';
        const name = a.nameOf(m.id).replace(/[<>&]/g, '');
        return `<div class="row${m.id === a.me ? ' me' : ''}" ${team}><span>${name}</span><span>${m.kills}</span><span>${m.deaths}</span></div>`;
      })
      .join('');
    this.table.innerHTML = `<h3>${s.mode === 'teams' ? '组队' : '混战'}</h3>${head}${body}`;
  }

  dispose(): void {
    this.strip.remove();
    this.feed.remove();
    this.table.remove();
  }
}
