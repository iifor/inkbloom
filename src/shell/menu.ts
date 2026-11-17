// The overlay menus: main menu at start, pause menu when the mouse is released, and the
// character, settings, world list and controls screens. Plain DOM; worlds switch by reloading
// the page with ?world=<id>, so every world starts from a clean session. The character screen
// sits on the left so the chosen look can stand in the world on the right (CharacterPreview).
import {
  CHARACTERS,
  HAIR_COLORS,
  HAIR_NAMES,
  type Look,
  SKIN_NAMES,
  SKIN_TONES,
  characterDef,
  defaultLook,
} from '@/content/characters';
import { PALETTE, color } from '@/content/palette';
import { DEFAULT_NAME, NAME_MAX, type Profile } from '@/world/profile';
import { levelOf } from '@/world/progression';
import { DEFAULT_SETTINGS, SETTING_LIMITS, type Settings } from '@/world/settings';
import type { WorldState } from '@/world/state';

export type Screen = 'main' | 'pause' | 'character' | 'join' | 'settings' | 'worlds' | 'controls';

/** The server world this game is in, for the menu. */
export interface Online {
  readonly address: string;
  readonly max: number;
  /** Everyone else's names. */
  readonly others: readonly string[];
  /** Why the connection went down, if it has. */
  readonly down: string | null;
}

export interface MenuActions {
  play(): void;
  newWorld(): void;
  openWorld(id: string): void;
  listWorlds(): Promise<WorldState[]>;
  settings(): Settings;
  applySettings(s: Settings): void;
  /** Download the playtest report for this world. */
  exportReport(): void;
  /** The player's character, or null before the first one is chosen. */
  profile(): Profile | null;
  saveProfile(p: Profile): void;
  /** Stand `look` in the world beside the menu, or take it away with null. */
  preview(look: Look | null): void;
  /** Colours offered as the accent: the crayons found in this world. */
  accents(): readonly number[];
  /** The server world this game is in, or null when playing alone. */
  online(): Online | null;
  /** The address used last time, to fill in the join screen. */
  lastServer(): string;
  joinServer(address: string): void;
  leaveServer(): void;
}

const CONTROLS = [
  ['WASD', '移动'],
  ['空格', '跳 · 二段跳 · 有纸飞机后在空中按住滑翔'],
  ['Shift', '陆地冲刺，深水加快划水'],
  ['E / F', '交互 / 第二个动作（画室升级笔刷、在已恢复的城或标记之间传送）'],
  ['1 / 2 / 3', '笔刷 / 武器 / 墨迹标记'],
  ['左键', '还色、攻击、放标记'],
  ['右键', '切换修复/涂鸦、装弹、狙击瞄准、收回标记'],
  ['Q / R / 滚轮', '换颜色或换武器'],
  ['G', '武器技能'],
  ['Tab', '角色：分配属性点'],
  ['J', '再看一眼当前目标'],
  ['Esc', '暂停'],
  ['F2 / F3', '自由飞行 / 帧率（再按：详细信息、关闭）'],
];

export class Menu {
  private screen: Screen = 'main';
  private back: Screen = 'main';
  /** The character being edited on the character screen. */
  private draft: Profile = { name: DEFAULT_NAME, look: defaultLook('courier') };
  /** The accent was picked by hand, so switching character keeps it. */
  private accentPicked = false;
  /** Choosing the first character, on the way into the game. */
  private firstRun = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly world: WorldState,
    private readonly actions: MenuActions,
  ) {}

  show(screen: Screen): void {
    if (screen === 'main' || screen === 'pause') this.back = screen;
    this.screen = screen;
    this.root.hidden = false;
    this.root.classList.toggle('side', screen === 'character');
    this.actions.preview(screen === 'character' ? this.draft.look : null);
    void this.render();
  }

  hide(): void {
    this.root.hidden = true;
    this.root.classList.remove('side');
    this.actions.preview(null);
  }

  /** Open the character screen on the current character (or a default one). */
  private editCharacter(): void {
    const p = this.actions.profile();
    this.draft = p
      ? { name: p.name, look: { ...p.look } }
      : { name: DEFAULT_NAME, look: defaultLook('courier') };
    this.accentPicked = p !== null;
    this.show('character');
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  private async render(): Promise<void> {
    const w = this.world;
    const restored = [...w.cities.values()].filter((c) => c.completed).length;
    const summary = `${w.name} · Lv ${levelOf(w.growth.xp)} · 已恢复 ${restored} 座城`;
    const profile = this.actions.profile();
    const who = profile ? `角色：${esc(profile.name)} · ${characterDef(profile.look.character).name}` : '';
    const online = this.actions.online();
    // in a server world: where, who else is here, and a way out
    const net = online
      ? `<p class="online">${
          online.down
            ? esc(online.down)
            : `联机 ${esc(online.address)} · 在线 ${online.others.length + 1} / ${online.max}${
                online.others.length ? `：${online.others.map(esc).join('、')}` : ''
              }`
        }</p>`
      : '';
    let body = '';
    switch (this.screen) {
      case 'main':
        body = `<h1>重彩</h1><p>世界本来是彩色的。墨潮抽走了颜色。</p>
          <button class="primary" data-a="play">${profile ? `开始：${esc(summary)}` : '开始：先选一个角色'}</button>
          ${profile ? `<button data-a="character">${who}</button>` : ''}
          ${net}
          ${online ? '<button data-a="leave">离开联机</button>' : '<button data-a="join">联机</button>'}
          <button data-a="new">新世界</button>
          <button data-a="worlds">世界列表</button>
          <button data-a="settings">设置</button>
          <button data-a="controls">操作说明</button>`;
        break;
      case 'pause':
        body = `<h2>暂停</h2><p>${esc(summary)}</p>${net}
          <button class="primary" data-a="play">继续游戏</button>
          <button data-a="character">${who || '选择角色'}</button>
          ${online ? '<button data-a="leave">离开联机</button>' : ''}
          <button data-a="settings">设置</button>
          <button data-a="controls">操作说明</button>
          <button data-a="report">导出试玩报告</button>
          <button data-a="main">回到主菜单</button>`;
        break;
      case 'join':
        body = `<h2>联机</h2>
          <p>和朋友进同一个世界，最多 10 人。开服的人在项目里运行 <b>npm run server</b>，把那台电脑的地址发给大家。</p>
          <label>地址 <input type="text" data-server placeholder="例如 192.168.1.20:5195" value="${esc(this.actions.lastServer())}"></label>
          <button class="primary" data-a="join-go">加入</button>
          <p class="hint">联机时用的是服务器上的世界，你在单人世界里的进度不受影响。</p>
          <button data-a="back">返回</button>`;
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
      case 'character': {
        const d = this.draft;
        const accents = this.actions.accents().includes(d.look.accent)
          ? this.actions.accents()
          : [...this.actions.accents(), d.look.accent];
        const chars = CHARACTERS.map(
          (c) =>
            `<button class="char${c.key === d.look.character ? ' on' : ''}" data-char="${c.key}"><b>${c.name}</b><small>${c.blurb}</small></button>`,
        ).join('');
        const row = (label: string, swatches: string): string =>
          `<div class="swatches"><span>${label}</span>${swatches}</div>`;
        body = `<h2>选择角色</h2>
          <div class="chars">${chars}</div>
          ${row('肤色', SKIN_TONES.map((k, i) => swatch('skin', i, color(k), SKIN_NAMES[i]!, d.look.skin === i)).join(''))}
          ${row('发色', HAIR_COLORS.map((k, i) => swatch('hair', i, color(k), HAIR_NAMES[i]!, d.look.hair === i)).join(''))}
          ${row('强调色', accents.map((c) => swatch('accent', c, c, PALETTE[c]!.name, d.look.accent === c)).join(''))}
          <p class="hint">强调色可以选这个世界里找到的蜡笔颜色，以后占遗迹也用它。外观不影响命中。</p>
          <label>名字 <input type="text" data-name maxlength="${NAME_MAX}" value="${esc(d.name)}"></label>
          <button class="primary" data-a="char-ok">${this.firstRun ? '确定，开始游戏' : '确定'}</button>
          ${this.firstRun ? '' : '<button data-a="back">返回</button>'}`;
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
    const edit = (look: Partial<Look>): void => {
      this.draft.look = { ...this.draft.look, ...look };
      this.actions.preview(this.draft.look);
      void this.render();
    };
    body.querySelectorAll<HTMLButtonElement>('button[data-char]').forEach((b) => {
      b.onclick = () => {
        const def = defaultLook(b.dataset.char as Look['character']);
        // skin and hair are the player's own; the accent follows the character until picked
        edit({ character: def.character, accent: this.accentPicked ? this.draft.look.accent : def.accent });
      };
    });
    body.querySelectorAll<HTMLButtonElement>('button[data-skin]').forEach((b) => {
      b.onclick = () => edit({ skin: Number(b.dataset.skin) });
    });
    body.querySelectorAll<HTMLButtonElement>('button[data-hair]').forEach((b) => {
      b.onclick = () => edit({ hair: Number(b.dataset.hair) });
    });
    body.querySelectorAll<HTMLButtonElement>('button[data-accent]').forEach((b) => {
      b.onclick = () => {
        this.accentPicked = true;
        edit({ accent: Number(b.dataset.accent) });
      };
    });
    const name = body.querySelector<HTMLInputElement>('input[data-name]');
    if (name) name.oninput = () => (this.draft.name = name.value);
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
        // the first game starts by choosing a character
        if (!this.actions.profile()) {
          this.firstRun = true;
          this.editCharacter();
        } else this.actions.play();
        break;
      case 'character':
        this.editCharacter();
        break;
      case 'char-ok':
        this.actions.saveProfile(this.draft);
        if (this.firstRun) {
          this.firstRun = false;
          this.hide();
          this.actions.play();
        } else this.show(this.back);
        break;
      case 'new':
        this.actions.newWorld();
        break;
      case 'worlds':
      case 'settings':
      case 'controls':
      case 'join':
        this.show(a);
        break;
      case 'join-go': {
        const addr = this.root.querySelector<HTMLInputElement>('input[data-server]')?.value.trim();
        if (addr) this.actions.joinServer(addr);
        break;
      }
      case 'leave':
        this.actions.leaveServer();
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
      case 'report':
        this.actions.exportReport();
        break;
    }
  }
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** A round colour button; `value` is what it sets, `paint` the palette colour it shows. */
function swatch(kind: string, value: number, paint: number, title: string, on: boolean): string {
  const rgb = PALETTE[paint]!.rgb.map((v) => Math.round(v * 255)).join(',');
  return `<button class="swatch${on ? ' on' : ''}" data-${kind}="${value}" title="${esc(title)}" style="background:rgb(${rgb})"></button>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
