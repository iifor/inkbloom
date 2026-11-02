// The overlay menus: main menu at start, pause menu when the mouse is released, and the
// settings, world list and controls screens. Plain DOM; worlds switch by reloading the page
// with ?world=<id>, so every world starts from a clean session.
import { levelOf } from '@/world/progression';
import { DEFAULT_SETTINGS, SETTING_LIMITS, type Settings } from '@/world/settings';
import type { WorldState } from '@/world/state';

export type Screen = 'main' | 'pause' | 'settings' | 'worlds' | 'controls';

export interface MenuActions {
  play(): void;
  newWorld(): void;
  openWorld(id: string): void;
  listWorlds(): Promise<WorldState[]>;
  settings(): Settings;
  applySettings(s: Settings): void;
}

const CONTROLS = [
  ['WASD', '移动'],
  ['空格', '跳 · 二段跳 · 有纸飞机后在空中按住滑翔'],
  ['Shift', '冲刺'],
  ['E / F', '交互 / 第二个动作（画室升级笔刷、在已恢复的城或标记之间传送）'],
  ['1 / 2 / 3', '笔刷 / 武器 / 墨迹标记'],
  ['左键', '还色、攻击、放标记'],
  ['右键', '切换修复/涂鸦、装弹、狙击瞄准、收回标记'],
  ['Q / R / 滚轮', '换颜色或换武器'],
  ['G', '武器技能'],
  ['Tab', '角色：分配属性点'],
  ['Esc', '暂停'],
  ['F2 / F3', '自由飞行 / 调试面板'],
];

export class Menu {
  private screen: Screen = 'main';
  private back: Screen = 'main';

  constructor(
    private readonly root: HTMLElement,
    private readonly world: WorldState,
    private readonly actions: MenuActions,
  ) {}

  show(screen: Screen): void {
    if (screen === 'main' || screen === 'pause') this.back = screen;
    this.screen = screen;
    this.root.hidden = false;
    void this.render();
  }

  hide(): void {
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  private async render(): Promise<void> {
    const w = this.world;
    const restored = [...w.cities.values()].filter((c) => c.completed).length;
    const summary = `${w.name} · Lv ${levelOf(w.growth.xp)} · 已恢复 ${restored} 座城`;
    let body = '';
    switch (this.screen) {
      case 'main':
        body = `<h1>重彩</h1><p>世界本来是彩色的。墨潮抽走了颜色。</p>
          <button data-a="play">开始：${esc(summary)}</button>
          <button data-a="new">新世界</button>
          <button data-a="worlds">世界列表</button>
          <button data-a="settings">设置</button>
          <button data-a="controls">操作说明</button>`;
        break;
      case 'pause':
        body = `<h2>暂停</h2><p>${esc(summary)}</p>
          <button data-a="play">继续游戏</button>
          <button data-a="settings">设置</button>
          <button data-a="controls">操作说明</button>
          <button data-a="main">回到主菜单</button>`;
        break;
      case 'settings': {
        const s = this.actions.settings();
        const [smin, smax] = SETTING_LIMITS.sensitivity;
        const [fmin, fmax] = SETTING_LIMITS.fov;
        body = `<h2>设置</h2>
          <label>鼠标灵敏度 <input type="range" data-s="sensitivity" min="${smin}" max="${smax}" step="0.1" value="${s.sensitivity}"><span>${s.sensitivity.toFixed(1)}</span></label>
          <label>视野 <input type="range" data-s="fov" min="${fmin}" max="${fmax}" step="1" value="${s.fov}"><span>${s.fov}°</span></label>
          <label>总音量 <input type="range" data-s="volume" min="0" max="1" step="0.05" value="${s.volume}"><span>${pct(s.volume)}</span></label>
          <label>音乐 <input type="range" data-s="music" min="0" max="1" step="0.05" value="${s.music}"><span>${pct(s.music)}</span></label>
          <label>音效 <input type="range" data-s="sfx" min="0" max="1" step="0.05" value="${s.sfx}"><span>${pct(s.sfx)}</span></label>
          <label>画质 <select data-s="quality"><option value="high"${s.quality === 'high' ? ' selected' : ''}>清晰</option><option value="low"${s.quality === 'low' ? ' selected' : ''}>流畅</option></select></label>
          <button data-a="reset">恢复默认</button>
          <button data-a="back">返回</button>`;
        break;
      }
      case 'worlds': {
        const worlds = await this.actions.listWorlds();
        const rows = worlds
          .map((x) => {
            const r = [...x.cities.values()].filter((c) => c.completed).length;
            const here = x.id === w.id ? '（当前）' : '';
            return `<button data-world="${esc(x.id)}">${esc(x.name)}${here} · Lv ${levelOf(x.growth.xp)} · 已恢复 ${r} 座城 <small>${esc(x.id)}</small></button>`;
          })
          .join('');
        body = `<h2>世界列表</h2>${rows || '<p>还没有世界</p>'}<button data-a="new">新世界</button><button data-a="back">返回</button>`;
        break;
      }
      case 'controls':
        body = `<h2>操作说明</h2><table class="controls">${CONTROLS.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
          <button data-a="back">返回</button>`;
        break;
    }
    this.root.querySelector('.menu-body')!.innerHTML = body;
    this.bind();
  }

  private bind(): void {
    const body = this.root.querySelector<HTMLElement>('.menu-body')!;
    body.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => {
      b.onclick = () => this.act(b.dataset.a!);
    });
    body.querySelectorAll<HTMLButtonElement>('button[data-world]').forEach((b) => {
      b.onclick = () => this.actions.openWorld(b.dataset.world!);
    });
    body.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-s]').forEach((el) => {
      el.oninput = () => {
        const s = { ...this.actions.settings() };
        const key = el.dataset.s as keyof Settings;
        if (key === 'quality') s.quality = el.value === 'low' ? 'low' : 'high';
        else s[key] = Number(el.value);
        this.actions.applySettings(s);
        const label = el.nextElementSibling;
        if (label && key !== 'quality')
          label.textContent =
            key === 'fov' ? `${s.fov}°` : key === 'sensitivity' ? s.sensitivity.toFixed(1) : pct(s[key]);
      };
    });
  }

  private act(a: string): void {
    switch (a) {
      case 'play':
        this.actions.play();
        break;
      case 'new':
        this.actions.newWorld();
        break;
      case 'worlds':
      case 'settings':
      case 'controls':
        this.show(a);
        break;
      case 'main':
        this.show('main');
        break;
      case 'back':
        this.show(this.back);
        break;
      case 'reset':
        this.actions.applySettings({ ...DEFAULT_SETTINGS });
        this.show('settings');
        break;
    }
  }
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
