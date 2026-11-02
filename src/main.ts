// Page entry: load or create the world save, start the open world, handle the start overlay
// and pointer lock. URL options: ?world=<id> picks a save slot, ?seed=<n> seeds a new world.
import { startOpenWorld, type OpenWorld } from './modes/open-world';
import { hashString } from './world/math/hash';
import { SaveError, createWorldState, type WorldState } from './world/state';
import { KeyValueStore, browserKeyValue } from './world/store';
import { installDevTools } from './shell/dev-tools';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const hudRoot = document.querySelector<HTMLElement>('#hud')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const playButton = document.querySelector<HTMLButtonElement>('#play')!;
const errorText = document.querySelector<HTMLElement>('#overlay-error')!;

/** Once the game has failed, the only way forward is a fresh page. */
function showFatal(e: unknown): void {
  console.error(e);
  if (document.pointerLockElement) document.exitPointerLock();
  overlay.hidden = false;
  errorText.textContent = `出错了：${e instanceof Error ? e.message : String(e)}`;
  playButton.textContent = '重新加载';
  playButton.onclick = () => location.reload();
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const worldId = params.get('world') ?? 'default';
  const notices: string[] = [];
  const { kv, persistent } = browserKeyValue();
  if (!persistent) notices.push('浏览器不允许本地存储：这次的进度不会保存');
  const store = new KeyValueStore(kv);

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
    state = createWorldState(worldId, seed);
    try {
      await store.save(state);
    } catch (e) {
      notices.push(`无法写入存档：${(e as Error).message}`);
    }
  }

  const game: OpenWorld = startOpenWorld({ canvas, hudRoot, state, store, onError: showFatal });
  installDevTools(game);
  for (const text of notices) game.ctx.events.emit('toast', { text, seconds: 8 });

  const input = game.ctx.input;
  playButton.onclick = async () => {
    errorText.textContent = '';
    overlay.hidden = true;
    canvas.focus();
    const locked = await input.requestLock();
    if (!locked)
      game.ctx.events.emit('toast', { text: '浏览器拒绝了鼠标捕获：按住鼠标拖动来转视角', seconds: 5 });
  };
  input.onLockChange = (locked) => {
    if (!locked) {
      overlay.hidden = false;
      void game.save.flush();
    }
  };
  window.addEventListener('pagehide', () => void game.save.flush());
}

boot().catch(showFatal);
