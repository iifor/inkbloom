// Tab opens the character panel: level, experience, and attribute points to spend with 1–4.
// While open it takes the number keys, so the tool belt does not switch.
import { ATTRIBUTES } from '@/content/progression';
import type { GameContext, System } from '@/game/types';
import { levelProgress, stats } from '@/world/progression';

const SLOTS = ['slot1', 'slot2', 'slot3', 'slot4'] as const;

export class CharacterPanel implements System {
  readonly id = 'character-panel';
  open = false;
  private readonly el: HTMLElement;

  constructor(
    private readonly ctx: GameContext,
    parent: HTMLElement,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'character-panel';
    this.el.hidden = true;
    parent.append(this.el);
  }

  update(): void {
    const { input } = this.ctx;
    if (input.consume('character')) this.open = !this.open;
    this.el.hidden = !this.open;
    if (!this.open) return;
    SLOTS.forEach((slot, i) => {
      if (!input.consume(slot)) return;
      const attr = ATTRIBUTES[i];
      if (!attr) return;
      const r = this.ctx.apply({ kind: 'assign', attr: attr.key });
      if (!r.ok) this.ctx.events.emit('toast', { text: r.reason, seconds: 1.5 });
    });
    this.render();
  }

  private render(): void {
    const g = this.ctx.state.growth;
    const lp = levelProgress(g.xp);
    const s = stats(g);
    const value = { health: `${s.maxHp}`, weapon: `${s.weapon}%`, skill: `${s.skill}%`, armor: `${s.armor}` };
    const rows = ATTRIBUTES.map(
      (a, i) =>
        `<tr><td>${i + 1}</td><td>${a.name}</td><td>${value[a.key]}</td><td class="muted">+${a.per} / 点 · ${a.help}</td></tr>`,
    ).join('');
    const html = `<h2>角色</h2>
      <p>等级 ${lp.level}${lp.need ? ` · 经验 ${lp.into} / ${lp.need}` : ' · 满级'}</p>
      <p>${g.points > 0 ? `<b>有 ${g.points} 个属性点</b>：按 1–4 分配` : '没有可分配的属性点（完成里程碑获得）'}</p>
      <table>${rows}</table>
      <p class="muted">Tab 关闭</p>`;
    if (this.el.innerHTML !== html) this.el.innerHTML = html;
  }

  dispose(): void {
    this.el.remove();
  }
}
