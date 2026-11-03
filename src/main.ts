// Page entry: load or create the world save, start the open world, and drive the menus and
// pointer lock. URL options: ?world=<id> picks a save slot, ?seed=<n> seeds a new world.
import { startOpenWorld, type OpenWorld } from './modes/open-world';
import { Menu } from './shell/menu';
import { installDevTools } from './shell/dev-tools';
import { hashString } from './world/math/hash';
import { loadSettings, saveSettings, type Settings } from './world/settings';
import { SaveError, createWorldState, type WorldState } from './world/state';
import { KeyValueStore, browserKeyValue } from './world/store';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const hudRoot = document.querySelector<HTMLElement>('#hud')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const errorText = document.querySelector<HTMLElement>('#overlay-error')!;

/** Once the game has failed, the only way forward is a fresh page. */
function showFatal(e: unknown): void {
  console.error(e);
  if (document.pointerLockElement) document.exitPointerLock();
  overlay.hidden = false;
  overlay.querySelector('.menu-body')!.innerHTML = '<h2>出错了</h2><button id="reload">重新加载</button>';
  overlay.querySelector<HTMLButtonElement>('#reload')!.onclick = () => location.reload();
  errorText.textContent = e instanceof Error ? e.message : String(e);
}

function openWorld(id: string): void {
  const url = new URL(location.href);
  url.searchParams.set('world', id);
  url.searchParams.delete('seed');
  location.href = url.toString();
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const { kv, persistent } = browserKeyValue();
  const store = new KeyValueStore(kv);
  const notices: string[] = [];
  if (!persistent) notices.push('浏览器不允许本地存储：这次的进度不会保存');
  // with no ?world=, continue the most recently used world
  const worldId = params.get('world') ?? kv.getItem('inkbloom:last') ?? 'default';
  kv.setItem('inkbloom:last', worldId);

  let state: WorldState | null = null;
  try {
    state = await store.load(worldId);
  } catch (e) {
    if (!(e instanceof SaveError)) throw e;
    const backup = await store.quarantine(worldId);
    notices.push(`存档损坏（${e.message}），已备份到 ${backup} 并新建世界`);
  }
  if (!state) {
    const seedParam = params.get('seed');
    const seed =
      seedParam !== null && /^-?\d+$/.test(seedParam)
        ? Number(seedParam) | 0
        : hashString(`${worldId}:${Date.now()}`);
    const count = (await store.list()).length;
    state = createWorldState(worldId, seed, `世界 ${count + 1}`);
    try {
      await store.save(state);
    } catch (e) {
      notices.push(`无法写入存档：${(e as Error).message}`);
    }
  }

  const game: OpenWorld = startOpenWorld({ canvas, hudRoot, state, store, kv, onError: showFatal });
  installDevTools(game);
  for (const text of notices) game.ctx.events.emit('toast', { text, seconds: 8 });

  let settings = loadSettings(kv);
  const apply = (s: Settings): void => {
    settings = s;
    saveSettings(kv, s);
    game.ctx.input.sensitivity = 0.0022 * s.sensitivity;
    game.ctx.renderer.setFov(s.fov);
    game.ctx.renderer.setQuality(s.quality);
    game.audio.synth.setVolumes({ master: s.volume, sfx: s.sfx, music: s.music });
  };
  apply(settings);

  const input = game.ctx.input;
  const menu = new Menu(overlay, state, {
    async play() {
      errorText.textContent = '';
      // audio may only start from a click; the play button is one
      game.audio.start();
      apply(settings);
      menu.hide();
      canvas.focus();
      if (!(await input.requestLock()))
        game.ctx.events.emit('toast', { text: '浏览器拒绝了鼠标捕获：按住鼠标拖动来转视角', seconds: 5 });
    },
    newWorld() {
      void game.save.flush().then(() => openWorld(`w${Date.now().toString(36)}`));
    },
    openWorld(id) {
      void game.save.flush().then(() => openWorld(id));
    },
    listWorlds: () => store.list(),
    settings: () => settings,
    applySettings: apply,
    exportReport() {
      // a Markdown file the player can send back; nothing is uploaded anywhere
      const blob = new Blob([game.playtest.report()], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `inkbloom-playtest-${state.id}-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  });
  menu.show('main');
  input.onLockChange = (locked) => {
    if (!locked) {
      menu.show('pause');
      void game.save.flush();
    }
  };
  window.addEventListener('pagehide', () => void game.save.flush());
}

boot().catch(showFatal);
