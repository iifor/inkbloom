// Page entry: load or create the world save, start the open world, and drive the menus and
// pointer lock. URL options: ?world=<id> picks a save slot, ?seed=<n> seeds a new world,
// ?server=<host:port> joins a world server instead (multiplayer; see server/main.ts).
import { CHARACTER_KEYS, defaultLook, type Look } from './content/characters';
import { PALETTE } from './content/palette';
import { startOpenWorld, type OpenWorld } from './modes/open-world';
import { prepareOffline } from './shell/offline';
import { Menu } from './shell/menu';
import { installDevTools } from './shell/dev-tools';
import { CharacterPreview } from './systems/figures/preview';
import {
  type Connection,
  JoinRefused,
  NetStore,
  connect,
  playerToken,
  serverUrl,
  roomServerUrl,
  watchRooms,
} from './systems/net/connection';
import { ROOM_CODE, type RoomRequest } from './world/net/protocol';
import { hashString } from './world/math/hash';
import { deserializeSlice, putSlice } from './world/net/slices';
import { DEFAULT_NAME, loadProfile, saveProfile } from './world/profile';
import { loadSettings, saveSettings, type Settings } from './world/settings';
import { SaveError, createWorldState, deserializeWorld, type WorldState } from './world/state';
import { type KeyValue, KeyValueStore, type WorldStore, browserKeyValue } from './world/store';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const hudRoot = document.querySelector<HTMLElement>('#hud')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const errorText = document.querySelector<HTMLElement>('#overlay-error')!;
const startup = document.querySelector<HTMLElement>('#startup')!;
const startupProgress = document.querySelector<HTMLProgressElement>('#startup-progress')!;
const startupPercent = document.querySelector<HTMLElement>('#startup-percent')!;
const startupStatus = document.querySelector<HTMLElement>('#startup-status')!;

function loading(progress: number, label: string): void {
  const percent = Math.round((progress / 5) * 100);
  startupProgress.value = percent;
  startupPercent.textContent = `${percent}%`;
  if (startupStatus.textContent !== label) startupStatus.textContent = label;
}

/** Once the game has failed, the only way forward is a fresh page. */
function showFatal(e: unknown): void {
  console.error(e);
  if (document.pointerLockElement) document.exitPointerLock();
  startup.hidden = true;
  overlay.hidden = false;
  overlay.querySelector('.menu-body')!.innerHTML = '<h2>出错了</h2><button id="reload">重新加载</button>';
  overlay.querySelector<HTMLButtonElement>('#reload')!.onclick = () => location.reload();
  errorText.textContent = e instanceof Error ? e.message : String(e);
}

function openWorld(id: string): void {
  const url = new URL(location.href);
  url.searchParams.set('world', id);
  url.searchParams.delete('seed');
  url.searchParams.delete('server');
  url.searchParams.delete('room');
  history.replaceState(null, '', url);
  location.reload();
}

/** Reload into a server world, or (null) back to playing alone. */
function openServer(address: string | null): void {
  const url = new URL(location.href);
  url.searchParams.delete('room');
  url.searchParams.delete('server');
  history.replaceState(address ? { address } : null, '', url);
  location.reload();
}

/** A server's password, as the player last typed it for that server. */
const passwordKey = (url: string): string => `inkbloom:pw:${url}`;

/** Could not join: say why, offer to try again (with a password, if it wants one) or play alone. */
function showJoinFailed(kv: KeyValue, url: string, e: unknown, room?: RoomRequest): void {
  const wantsPassword = e instanceof JoinRefused && (e.password || e.roomPassword);
  const label = e instanceof JoinRefused && e.roomPassword ? '房间密码' : '服务器密码';
  startup.hidden = true;
  overlay.hidden = false;
  overlay.querySelector('.menu-body')!.innerHTML = `<h2>没能加入联机</h2><p></p>
    ${wantsPassword ? `<label>${label} <input type="password" id="pw" maxlength="128" autocomplete="off"></label>` : ''}
    <button class="primary" id="retry">${wantsPassword ? '加入' : '再试一次'}</button><button id="alone">单人游戏</button>`;
  overlay.querySelector('.menu-body p')!.textContent = e instanceof Error ? e.message : String(e);
  overlay.querySelector<HTMLButtonElement>('#retry')!.onclick = () => {
    const pw = overlay.querySelector<HTMLInputElement>('#pw');
    if (pw && e instanceof JoinRefused && e.roomPassword && room?.action === 'join')
      sessionStorage.setItem(`inkbloom:room-pw:${room.code}`, pw.value);
    else if (pw) kv.setItem(passwordKey(url), pw.value);
    location.reload();
  };
  overlay.querySelector<HTMLButtonElement>('#alone')!.onclick = () => openServer(null);
}

/** A link to a server this browser has not joined from its own menu: ask before connecting. */
function confirmJoin(url: string): Promise<boolean> {
  startup.hidden = true;
  overlay.hidden = false;
  overlay.querySelector('.menu-body')!.innerHTML = `<h2>加入联机世界？</h2><p></p>
    <p class="hint">只加入你认识的人开的服务器。</p>
    <button class="primary" id="join">加入</button><button id="alone">单人游戏</button>`;
  overlay.querySelector('.menu-body p')!.textContent = url;
  return new Promise((done) => {
    overlay.querySelector<HTMLButtonElement>('#join')!.onclick = () => done(true);
    overlay.querySelector<HTMLButtonElement>('#alone')!.onclick = () => done(false);
  });
}

async function boot(): Promise<void> {
  loading(0, '正在读取世界…');
  const params = new URLSearchParams(location.search);
  const { kv, persistent } = browserKeyValue();
  prepareOffline(persistent);
  const local = new KeyValueStore(kv);
  let store: WorldStore = local;
  const notices: string[] = [];
  if (!persistent) notices.push('浏览器不允许本地存储：这次的进度不会保存');
  // with no ?world=, continue the most recently used world
  const worldId = params.get('world') ?? kv.getItem('inkbloom:last') ?? 'default';

  let state: WorldState | null = null;
  // a server world: the server sends the world and this player's own things
  const address: string | null = params.get('server') || history.state?.address || null;
  const code = params.get('room')?.trim().toUpperCase();
  const room: RoomRequest | undefined = address
    ? undefined
    : code !== undefined
      ? { action: 'join', code }
      : history.state?.createRoom
        ? { action: 'create' }
        : undefined;
  const roomKey = `inkbloom:room-pw:${room?.action === 'join' ? room.code : 'create'}`;
  let net: Connection | undefined;
  if (address || room) {
    const url = address ? serverUrl(address) : roomServerUrl();
    if (room?.action === 'join' && !ROOM_CODE.test(room.code)) {
      showJoinFailed(kv, url, new Error('房间号格式无效'), room);
      return;
    }
    // joining from a link someone sent: say where to, and let the player say no
    if (address && kv.getItem('inkbloom:server') !== address && !(await confirmJoin(url))) {
      openServer(null);
      return;
    }
    overlay.hidden = true;
    startup.hidden = false;
    loading(0, '正在连接世界…');
    // asked once is enough: a retry (a password, a hiccup) goes straight in
    if (address) {
      kv.setItem('inkbloom:server', address);
      const clean = new URL(location.href);
      clean.searchParams.delete('server');
      clean.searchParams.delete('room');
      history.replaceState({ address }, '', clean);
    }
    const p = loadProfile(kv) ?? { name: DEFAULT_NAME, look: defaultLook('courier') };
    try {
      net = await connect(url, {
        room,
        roomPassword: room ? (sessionStorage.getItem(roomKey) ?? '') : undefined,
        token: playerToken(kv, url),
        name: p.name,
        look: p.look,
        password: kv.getItem(passwordKey(url)) ?? '',
      });
    } catch (e) {
      showJoinFailed(kv, url, e, room);
      return;
    }
    if (room && net.welcome.room) {
      const clean = new URL(location.href);
      clean.searchParams.set('room', net.welcome.room);
      history.replaceState(null, '', clean);
      if (room.action === 'create') {
        const password = sessionStorage.getItem(roomKey);
        if (password) sessionStorage.setItem(`inkbloom:room-pw:${net.welcome.room}`, password);
        sessionStorage.removeItem(roomKey);
      }
    }
    state = deserializeWorld(net.welcome.world);
    putSlice(state, deserializeSlice(net.welcome.you));
    store = new NetStore();
  } else {
    kv.setItem('inkbloom:last', worldId);
    try {
      state = await store.load(worldId);
    } catch (e) {
      if (!(e instanceof SaveError)) throw e;
      const backup = await store.quarantine(worldId);
      notices.push(`存档损坏（${e.message}），已备份到 ${backup} 并新建世界`);
    }
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

  const game: OpenWorld = await startOpenWorld({
    canvas,
    hudRoot,
    state,
    store,
    kv,
    net,
    onError: showFatal,
    loading,
  });
  installDevTools(game);
  for (const text of notices) game.ctx.events.emit('toast', { text, seconds: 8 });

  let settings = loadSettings(kv);
  const apply = (s: Settings): void => {
    settings = s;
    saveSettings(kv, s);
    game.ctx.input.sensitivity = 0.0022 * s.sensitivity;
    game.ctx.renderer.setFov(s.fov);
    game.ctx.renderer.setQuality(s.quality);
    game.clock.timeScale = s.timeScale;
    game.audio.synth.setVolumes({ master: s.volume, sfx: s.sfx, music: s.music });
  };
  apply(settings);

  let profile = loadProfile(kv);
  // the hands holding the weapons, and swimming, are this character's
  const dress = (look: Look): void => {
    game.weapons.setLook(look);
    game.player.setLook(look);
  };
  if (profile) dress(profile.look);
  game.loop.step(0);
  loading(5, '加载完成');
  // Leave one paint for the completed indicator before revealing the menu.
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const preview = new CharacterPreview(game.ctx);
  const world = state;
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
        game.ctx.events.emit('toast', {
          text: '浏览器拒绝了鼠标捕获：按住鼠标拖动来转视角',
          seconds: 5,
          once: 'pointer-lock',
        });
    },
    newWorld() {
      void game.save.flush().then(() => openWorld(`w${Date.now().toString(36)}`));
    },
    openWorld(id) {
      void game.save.flush().then(() => openWorld(id));
    },
    listWorlds: () => local.list(),
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
    profile: () => profile,
    saveProfile(p) {
      saveProfile(kv, p);
      profile = loadProfile(kv);
      if (profile) dress(profile.look);
    },
    preview: (look) => preview.show(look),
    previewVillager: (key) => preview.showVillager(key),
    mountPreview: (stage, controls) => preview.mount(stage, controls),
    accents: () => world.unlocked.filter((c) => PALETTE[c]?.paintable),
    online() {
      const n = game.net;
      if (!n) return null;
      return {
        address: net?.welcome.room ? `房间 ${net.welcome.room}` : (address ?? ''),
        max: n.max,
        others: n.players.map((p) => p.name),
        down: n.down,
        friends: n.friends,
      };
    },
    trackFriend: (id) => game.net?.trackFriend(id),
    visitFriend: (id) => game.net?.visitFriend(id) ?? false,
    lastServer: () => kv.getItem('inkbloom:server') ?? `${location.hostname || '127.0.0.1'}`,
    watchRooms(password, update, failed) {
      const url = roomServerUrl();
      return watchRooms(
        url,
        password ?? kv.getItem(passwordKey(url)) ?? '',
        (rooms) => {
          if (password !== null) kv.setItem(passwordKey(url), password);
          update(rooms);
        },
        failed,
      );
    },
    enterRoom(request, password) {
      void game.save.flush().then(() => {
        const url = new URL(location.href);
        url.searchParams.delete('server');
        const key = `inkbloom:room-pw:${request.action === 'join' ? request.code : 'create'}`;
        if (password) sessionStorage.setItem(key, password);
        else sessionStorage.removeItem(key);
        if (request.action === 'join') url.searchParams.set('room', request.code);
        else url.searchParams.delete('room');
        history.replaceState({ createRoom: request.action === 'create' }, '', url);
        location.reload();
      });
    },
    joinServer(addr) {
      // chosen in this game's own menu: no need to ask again
      kv.setItem('inkbloom:server', addr);
      void game.save.flush().then(() => openServer(addr));
    },
    leaveServer() {
      game.net?.leave();
      openServer(null);
    },
    arena() {
      const a = game.arena;
      if (!a) return null;
      const s = a.state;
      const members = s?.members ?? [];
      return {
        inside: a.inside,
        phase: s?.phase ?? 'waiting',
        mode: s?.mode ?? 'ffa',
        left: a.secondsLeft(),
        names: members.map((m) => a.nameOf(m.id)),
        votes: {
          ffa: members.filter((m) => m.vote === 'ffa').length,
          teams: members.filter((m) => m.vote === 'teams').length,
        },
        mine: members.find((m) => m.id === a.me)?.vote ?? null,
      };
    },
    arenaJoin: () => game.arena?.join(),
    arenaLeave: () => game.arena?.leave(),
    arenaVote: (mode) => game.arena?.vote(mode),
  });
  const previewKey = CHARACTER_KEYS.find((key) => key === params.get('preview'));
  if (previewKey) menu.editCharacter(previewKey);
  else menu.show('main');
  input.onLockChange = (locked) => {
    if (!locked) void game.save.flush();
  };
  input.onPause = () => {
    if (!overlay.hidden) return;
    input.clear();
    input.exitLock();
    menu.show('pause');
    void game.save.flush();
  };
  window.addEventListener('pagehide', () => void game.save.flush());
  canvas.inert = false;
  startup.hidden = true;
  game.loop.start();
}

boot().catch(showFatal);
