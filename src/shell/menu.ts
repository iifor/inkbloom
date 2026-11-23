// The overlay menus: main menu at start, pause menu on Escape, and the
// character, settings, world list and controls screens. Plain DOM; worlds switch by reloading
// the page with ?world=<id>, so every world starts from a clean session.
import './character-picker.css';
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
import {
  DEFAULT_SETTINGS,
  SETTING_LIMITS,
  TIME_SCALES,
  validTimeScale,
  type Settings,
} from '@/world/settings';
import { yearDuration } from '@/world/climate/calendar';
import type { WorldState } from '@/world/state';
import type { FriendStatus } from '@/game/types';
import { mountFriends } from './friends-panel';
import { VILLAGER_MODELS, VILLAGER_ROLES, type VillagerModel } from '@/systems/figures/kaykit-villager';

export type Screen =
  'main' | 'pause' | 'character' | 'join' | 'settings' | 'worlds' | 'controls' | 'arena' | 'friends';

/** The arena as the menu shows it. */
export interface ArenaInfo {
  readonly inside: boolean;
  readonly phase: 'waiting' | 'countdown' | 'fighting' | 'results';
  readonly mode: 'ffa' | 'teams';
  /** Seconds left in this phase. */
  readonly left: number;
  readonly names: readonly string[];
  readonly votes: { readonly ffa: number; readonly teams: number };
  /** This player's vote, when inside. */
  readonly mine: 'ffa' | 'teams' | null;
}

/** The server world this game is in, for the menu. */
export interface Online {
  readonly friends: readonly FriendStatus[];
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
  previewVillager?(key: VillagerModel): void;
  mountPreview?(stage: HTMLElement, controls: HTMLElement): void;
  /** Colours offered as the accent: the crayons found in this world. */
  accents(): readonly number[];
  /** The server world this game is in, or null when playing alone. */
  online(): Online | null;
  trackFriend(id: number): void;
  visitFriend(id: number): boolean;
  /** The address used last time, to fill in the join screen. */
  lastServer(): string;
  joinServer(address: string): void;
  leaveServer(): void;
  /** The arena, or null when playing alone (there is one only on a server). */
  arena(): ArenaInfo | null;
  arenaJoin(): void;
  arenaLeave(): void;
  arenaVote(mode: 'ffa' | 'teams'): void;
}

const PHASES = { waiting: '等人', countdown: '马上开始', fighting: '对战中', results: '一局刚结束' } as const;
const MODES = { ffa: '混战', teams: '组队' } as const;

const CONTROLS = [
  ['WASD', '移动'],
  ['空格', '跳 · 二段跳 · 有纸飞机后在空中按住滑翔'],
  ['Shift', '陆地冲刺，深水加快划水'],
  ['X / Z', '平坦草地上坐下 / 躺下，按移动键起身'],
  ['E / F', '交互 / 第二个动作（画室升级笔刷、祭坛长按 E、墨迹标记长按 F 传送）'],
  ['1 / 2 / 3', '笔刷 / 武器 / 墨迹标记'],
  ['左键', '还色、攻击、放标记'],
  ['右键', '切换修复/涂鸦、装弹、狙击瞄准、收回标记'],
  ['Q / R / 滚轮', '换颜色或换武器'],
  ['G', '武器技能'],
  ['Tab', '角色：分配属性点'],
  ['J', '再看一眼当前目标'],
  ['U', '释放鼠标，点击画面恢复操作'],
  ['Esc / P', '打开暂停菜单和设置'],
  ['F2', '展开 / 收起纸飞机；WASD 飞行，空格上升，Ctrl 下降，Shift 加速'],
  ['F3', '帧率（再按：详细信息、关闭）'],
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
  private stopFriends: (() => void) | null = null;
  private villagerPreview: VillagerModel | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly world: WorldState,
    private readonly actions: MenuActions,
  ) {}

  show(screen: Screen): void {
    this.stopFriends?.();
    this.stopFriends = null;
    if (screen === 'main' || screen === 'pause') this.back = screen;
    this.screen = screen;
    this.root.hidden = false;
    this.root.classList.toggle('side', screen === 'character');
    this.actions.preview(screen === 'character' ? this.draft.look : null);
    void this.render();
  }

  hide(): void {
    this.stopFriends?.();
    this.stopFriends = null;
    this.root.hidden = true;
    this.root.classList.remove('side');
    this.actions.preview(null);
  }

  /** Open the character screen on the current character (or a default one). */
  private editCharacter(): void {
    this.villagerPreview = null;
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
    const characterScroll = this.root.querySelector('.chars')?.scrollTop ?? 0;
    const toolsScroll = this.root.querySelector('.picker-tools')?.scrollTop ?? 0;
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
    const arena = this.actions.arena();
    const arenaButton = arena
      ? `<button data-a="arena">竞技场${arena.inside ? '（在场上）' : arena.names.length ? `（${arena.names.length} 人）` : ''}</button>`
      : '<button disabled title="联机时可用">竞技场（联机时可用）</button>';
    let body = '';
    switch (this.screen) {
      case 'main':
        body = `<h1>重彩</h1><p>世界本来是彩色的。墨潮抽走了颜色。</p>
          <button class="primary" data-a="play">${profile ? `开始：${esc(summary)}` : '开始：先选一个角色'}</button>
          ${profile ? `<button data-a="character">${who}</button>` : ''}
          ${net}
          ${online ? '<button data-a="leave">离开联机</button>' : '<button data-a="join">联机</button>'}
          ${arenaButton}
          ${online ? '<button data-a="friends">在线伙伴 · 定位 / 传送</button>' : ''}
          <button data-a="new">新世界</button>
          <button data-a="worlds">世界列表</button>
          <button data-a="settings">设置</button>
          <button data-a="controls">操作说明</button>`;
        break;
      case 'pause':
        body = `<h2>暂停</h2><p>${esc(summary)}</p>${net}
          <button class="primary" data-a="play">继续游戏</button>
          ${arena?.inside ? '<button data-a="arena-leave">退出竞技场</button>' : ''}
          <button data-a="character">${who || '选择角色'}</button>
          ${arenaButton}
          ${online ? '<button data-a="friends">在线伙伴 · 定位 / 传送</button>' : ''}
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
      case 'friends':
        body = `<h2>在线伙伴</h2><p class="hint">定位后，画面会持续显示方向和距离。传送会在伙伴附近寻找安全地面，竞技场内不可用。</p><div data-friends></div><button data-a="play">回到游戏</button><button data-a="back">返回</button>`;
        break;
      case 'arena': {
        if (!arena) {
          body = `<h2>竞技场</h2><p>联机时可用。</p><button data-a="back">返回</button>`;
          break;
        }
        const time =
          arena.phase === 'waiting'
            ? ''
            : ` · ${Math.floor(arena.left / 60)}:${String(Math.floor(arena.left % 60)).padStart(2, '0')}`;
        const who = arena.names.length ? `：${arena.names.map(esc).join('、')}` : '';
        const vote = (m: 'ffa' | 'teams'): string =>
          `<button data-a="vote-${m}"${arena.mine === m ? ' class="on"' : ''}>投${MODES[m]}（${arena.votes[m]}）</button>`;
        body = `<h2>竞技场</h2>
          <p>${PHASES[arena.phase]} · ${MODES[arena.mode]}${time} · ${arena.names.length} 人在场${who}</p>
          <p class="hint">野外围起来的一片地方，玩家之间对打。5 把武器都能用，倒下不掉墨，不影响世界进度。混战先到 10 杀、组队先到 20 杀，每局 5 分钟。</p>
          ${
            arena.inside
              ? `<p class="hint">下一局打什么：按投票多的来</p><div class="votes">${vote('ffa')}${vote('teams')}</div>
                 <button class="primary" data-a="play">回到场上</button>
                 <button data-a="arena-leave">退出竞技场</button>`
              : '<button class="primary" data-a="arena-join">进入竞技场</button>'
          }
          <button data-a="back">返回</button>`;
        break;
      }
      case 'settings': {
        const s = this.actions.settings();
        const [smin, smax] = SETTING_LIMITS.sensitivity;
        const [fmin, fmax] = SETTING_LIMITS.fov;
        const online = !!this.actions.online();
        body = `<h2>设置</h2>
          <label>鼠标灵敏度 <input type="range" data-s="sensitivity" min="${smin}" max="${smax}" step="0.1" value="${s.sensitivity}"><span>${s.sensitivity.toFixed(1)}</span></label>
          <label>视野 <input type="range" data-s="fov" min="${fmin}" max="${fmax}" step="1" value="${s.fov}"><span>${s.fov}°</span></label>
          <label>总音量 <input type="range" data-s="volume" min="0" max="1" step="0.05" value="${s.volume}"><span>${pct(s.volume)}</span></label>
          <label>音乐 <input type="range" data-s="music" min="0" max="1" step="0.05" value="${s.music}"><span>${pct(s.music)}</span></label>
          <label>音效 <input type="range" data-s="sfx" min="0" max="1" step="0.05" value="${s.sfx}"><span>${pct(s.sfx)}</span></label>
          <label>画质 <select data-s="quality"><option value="high"${s.quality === 'high' ? ' selected' : ''}>清晰</option><option value="low"${s.quality === 'low' ? ' selected' : ''}>流畅</option></select></label>
          <label>时间流速 <select data-s="timeScale"${online ? ' disabled' : ''}>${TIME_SCALES.map((rate) => `<option value="${rate}"${rate === (online ? 1 : s.timeScale) ? ' selected' : ''}>${rate}×${rate === 1 ? '（正常）' : ''} · ${yearDuration(rate)}</option>`).join('')}</select></label>
          <p class="hint">${online ? '联机时跟随服务器时间。' : '加快昼夜、天气和四季；移动、战斗与资源刷新保持原速。'}</p>
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
        const villager = this.villagerPreview;
        const names: Record<VillagerModel, string> = {
          rogue: '轻装村民',
          'rogue-hooded': '兜帽村民',
          knight: '守卫',
          barbarian: '伐木工',
          mage: '法师',
        };
        const d = this.draft;
        const accents = this.actions.accents().includes(d.look.accent)
          ? this.actions.accents()
          : [...this.actions.accents(), d.look.accent];
        const choices = villager ? VILLAGER_MODELS.map((key) => ({ key, name: names[key] })) : CHARACTERS;
        const chars = choices
          .map(({ key, name }) => {
            const selected = key === (villager ?? d.look.character);
            return `<button class="char${selected ? ' on' : ''}" aria-pressed="${selected}" data-${villager ? 'villager' : 'char'}="${key}"><b>${name}</b></button>`;
          })
          .join('');
        const current = characterDef(d.look.character);
        const row = (label: string, swatches: string): string =>
          `<div class="swatches"><span>${label}</span>${swatches}</div>`;
        const colors = `<section class="picker-colors"><h3>外观配色</h3>
          ${row('肤色', SKIN_TONES.map((k, i) => swatch('skin', i, color(k), SKIN_NAMES[i]!, d.look.skin === i)).join(''))}
          ${row('发色', HAIR_COLORS.map((k, i) => swatch('hair', i, color(k), HAIR_NAMES[i]!, d.look.hair === i)).join(''))}
          ${row('强调色', accents.map((c) => swatch('accent', c, c, PALETTE[c]!.name, d.look.accent === c)).join(''))}
          </section>`;
        body = `<section class="picker" role="dialog" aria-labelledby="picker-title">
          <header><h2 id="picker-title">${villager ? '村民预览' : '选择角色'}</h2>
          ${villager ? '' : `<label>玩家昵称<input type="text" data-name maxlength="${NAME_MAX}" value="${esc(d.name)}"></label>`}</header>
          <div class="picker-main">
            <aside class="picker-list"><h3>${villager ? '村民列表' : '角色列表'}</h3>
            <div class="chars">${chars}</div>
            ${villager ? '' : '<button class="picker-switch" data-a="villager-preview">查看村民动作 ›</button>'}</aside>
            <figure><div class="picker-stage"></div><figcaption><b>${villager ? names[villager] : current.name}</b>
              <span>${villager ? (VILLAGER_ROLES[villager].profession ? '携带职业装备' : '普通村民 · 无武器') : esc(current.blurb)}</span></figcaption></figure>
            <aside class="picker-tools"><div data-motion-host></div>${villager ? '' : colors}</aside>
          </div><footer>${
            villager
              ? '<button data-a="player-preview">返回角色选择</button>'
              : `<button data-a="back">返回</button><button class="primary" data-a="char-ok">${this.firstRun ? '确认并开始' : '确认选择'}</button>`
          }
          </footer></section>`;
        break;
      }
      case 'controls':
        body = `<h2>操作说明</h2><table class="controls">${CONTROLS.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
          <button data-a="back">返回</button>`;
        break;
    }
    this.root.querySelector('.menu-body')!.innerHTML = body;
    if (this.screen === 'character') {
      this.actions.mountPreview?.(
        this.root.querySelector('.picker-stage')!,
        this.root.querySelector('[data-motion-host]')!,
      );
      this.root.querySelector('.picker-tools')!.scrollTop = toolsScroll;
    }
    const characterList = this.root.querySelector('.chars');
    if (characterList) characterList.scrollTop = characterScroll;
    this.bind();
    if (this.screen === 'friends') {
      this.stopFriends?.();
      this.stopFriends = mountFriends(
        this.root.querySelector('[data-friends]')!,
        () => this.actions.online()?.friends ?? [],
        (id) => this.actions.trackFriend(id),
        (id) => {
          if (this.actions.visitFriend(id)) this.actions.play();
        },
      );
    }
  }

  private bind(): void {
    const body = this.root.querySelector<HTMLElement>('.menu-body')!;
    body.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => {
      b.onclick = () => this.act(b.dataset.a!);
    });
    body.querySelectorAll<HTMLButtonElement>('button[data-world]').forEach((b) => {
      b.onclick = () => this.actions.openWorld(b.dataset.world!);
    });
    body.querySelectorAll<HTMLButtonElement>('[data-villager]').forEach((button) => {
      button.onclick = () => {
        this.villagerPreview = button.dataset.villager as VillagerModel;
        this.actions.previewVillager?.(this.villagerPreview);
        void this.render();
      };
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
        else if (key === 'timeScale') s.timeScale = validTimeScale(Number(el.value));
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
      case 'villager-preview':
        this.villagerPreview = 'rogue';
        this.actions.previewVillager?.(this.villagerPreview);
        void this.render();
        break;
      case 'player-preview':
        this.villagerPreview = null;
        this.actions.preview(this.draft.look);
        void this.render();
        break;
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
      case 'arena':
      case 'friends':
        this.show(a);
        break;
      case 'arena-join':
        this.actions.arenaJoin();
        this.actions.play();
        break;
      case 'arena-leave':
        this.actions.arenaLeave();
        this.actions.play();
        break;
      case 'vote-ffa':
      case 'vote-teams':
        this.actions.arenaVote(a === 'vote-ffa' ? 'ffa' : 'teams');
        // the server's answer comes back in a moment; show it then
        setTimeout(() => this.screen === 'arena' && this.show('arena'), 150);
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
        this.firstRun = false;
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
  return `<button class="swatch${on ? ' on' : ''}" aria-label="${esc(title)}" aria-pressed="${on}" data-${kind}="${value}" title="${esc(title)}" style="background:rgb(${rgb})"></button>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
