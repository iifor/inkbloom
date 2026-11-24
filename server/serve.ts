// Moves messages between WebSockets and a WorldHost: hello and welcome, motion, patches,
// gestures passed on to the players nearby, and 20 snapshots a second with the clock, nearby
// players and the towns each client keeps. The rules are in src/world/net/host.ts; saving to
// disk is the caller's (server/main.ts).
//
// What a connection may do is limited here: pages from other web sites cannot connect (Origin
// check), an optional password keeps strangers out, each connection has a message budget, a
// few connections per address at most, and connections that stop answering are dropped.
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { type WebSocket, WebSocketServer } from 'ws';
import type { Outgoing } from '@/world/net/arena-host';
import { createWorldState } from '@/world/state';
import { WorldHost } from '@/world/net/host';
import { PROTOCOL, SEND_HZ, type ServerMessage, parseClientMessage } from '@/world/net/protocol';

/** A connection that has not said hello by now is dropped. */
const HELLO_TIMEOUT_MS = 5000;
/** Messages a connection may send: a burst, then this many a second (motion is 20). */
const MESSAGE_BURST = 120;
const MESSAGE_RATE = 60;
/** A connection over budget this many times is closed. */
const STRIKES = 200;
/** Connections at once from one address. */
const PER_ADDRESS = 4;

export interface ServeOptions {
  readonly port: number;
  readonly bind?: string;
  /** Players must give this to join; empty or absent: no password. */
  readonly password?: string;
  /** Web page origins allowed to connect besides local and private-network ones; '*' allows any. */
  readonly origins?: readonly string[];
  /** Called when there is something to save, at most every `saveDelay` seconds. */
  readonly save?: () => void;
  readonly saveDelay?: number;
  /** Seconds between heartbeats; a connection that misses one is dropped. */
  readonly heartbeat?: number;
  readonly log?: (line: string) => void;
}

export interface Served {
  /** The port it listens on (useful with port 0). */
  readonly port: number;
  close(): Promise<void>;
}

/** Hosts a page may be served from and still connect: this machine and private networks. */
function privateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '');
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h === '::1' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^f[cd][0-9a-f]{2}:/i.test(h)
  );
}

/** Whether a browser page from this origin may connect. Non-browser clients send no origin. */
export function originAllowed(origin: string | undefined, allowed: readonly string[] = []): boolean {
  if (!origin || allowed.includes('*') || allowed.includes(origin)) return true;
  // a page opened from a file has the origin "null"
  if (origin === 'null') return true;
  try {
    return privateHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

const samePassword = (given: string, want: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
};

const send = (ws: WebSocket, m: ServerMessage): void => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
};

function worldSession(host: WorldHost) {
  const sockets = new Map<number, WebSocket>();
  const broadcast = (m: ServerMessage, except?: number): void => {
    for (const [id, ws] of sockets) if (id !== except) send(ws, m);
  };
  /** Arena messages: to everyone, to those in the arena, or to one player. */
  const deliver = (out: readonly Outgoing[]): void => {
    if (!out.length) return;
    const inArena = host.arena.members();
    for (const { to, m } of out) {
      if (to === 'all') broadcast(m);
      else if (to === 'arena')
        for (const id of inArena) {
          const ws = sockets.get(id);
          if (ws) send(ws, m);
        }
      else if (sockets.has(to)) send(sockets.get(to)!, m);
    }
  };
  return { host, sockets, broadcast, deliver };
}

export function serve(defaultHost: WorldHost, opts: ServeOptions): Promise<Served> {
  const log = opts.log ?? (() => {});
  const lobby = worldSession(defaultHost);
  const rooms = new Map<string, { session: typeof lobby; password: string; lastActive: number }>();
  const browsers = new Set<WebSocket>();
  function roomList(): ServerMessage {
    return {
      t: 'rooms',
      rooms: Array.from(rooms, ([code, { session, password }]) => ({
        code,
        count: session.host.count,
        max: session.host.max,
        locked: !!password,
      })),
    };
  }
  function publishRooms(): void {
    if (!browsers.size) return;
    const list = roomList();
    for (const ws of browsers) send(ws, list);
  }
  const perAddress = new Map<string, number>();
  const addressOf = (req: IncomingMessage): string => {
    const peer = req.socket.remoteAddress ?? '?';
    const client = req.headers['x-real-ip'];
    if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) && typeof client === 'string' && isIP(client))
      return client;
    return peer;
  };
  const wss = new WebSocketServer({
    port: opts.port,
    host: opts.bind ?? '0.0.0.0',
    maxPayload: 32 * 1024,
    verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) => {
      if (!originAllowed(origin, opts.origins)) {
        log(`refused a page from ${origin}`);
        return false;
      }
      return (perAddress.get(addressOf(req)) ?? 0) < PER_ADDRESS;
    },
  });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (ws, req) => {
    const address = addressOf(req);
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    let id: number | null = null;
    let session = lobby;
    let roomCode: string | undefined;
    let budget = MESSAGE_BURST;
    let last = performance.now();
    let strikes = 0;
    const hello = setTimeout(() => id === null && ws.close(), HELLO_TIMEOUT_MS);

    ws.on('message', (data) => {
      // the message budget: refill by time, spend one per message, drop what is over
      const now = performance.now();
      budget = Math.min(MESSAGE_BURST, budget + ((now - last) / 1000) * MESSAGE_RATE);
      last = now;
      if (budget < 1) {
        if (++strikes >= STRIKES) ws.close();
        return;
      }
      budget -= 1;
      if (ws.readyState !== ws.OPEN) return;
      const m = parseClientMessage(data.toString());
      if (!m) return;
      if (id === null) {
        if (browsers.has(ws) || (m.t !== 'hello' && m.t !== 'listRooms')) return;
        clearTimeout(hello);
        if (m.v !== PROTOCOL) {
          send(ws, { t: 'refused', reason: '游戏版本和服务器不一样，请刷新页面' });
          ws.close();
          return;
        }
        if (opts.password && !samePassword(m.password ?? '', opts.password)) {
          send(ws, { t: 'refused', reason: m.password ? '密码不对' : '这个服务器需要密码', password: true });
          ws.close();
          return;
        }
        if (m.t === 'listRooms') {
          browsers.add(ws);
          send(ws, roomList());
          return;
        }
        if (m.room?.action === 'create') {
          if (rooms.size >= 64) {
            send(ws, { t: 'refused', reason: '房间已满，请稍后再创建' });
            ws.close();
            return;
          }
          do {
            roomCode = randomBytes(3).toString('hex').toUpperCase();
          } while (rooms.has(roomCode));
          const state = createWorldState(roomCode, randomInt(0x7fffffff), `房间 ${roomCode}`);
          session = worldSession(new WorldHost(state, new Map(), defaultHost.max));
          rooms.set(roomCode, { session, password: m.roomPassword ?? '', lastActive: now });
        } else if (m.room?.action === 'join') {
          roomCode = m.room.code;
          const room = rooms.get(roomCode);
          if (!room || (room.password && !samePassword(m.roomPassword ?? '', room.password))) {
            send(ws, {
              t: 'refused',
              reason: room ? '请输入正确的房间密码' : '房间不存在或已关闭',
              roomPassword: !!room,
            });
            ws.close();
            return;
          }
          session = room.session;
        }
        const { host, sockets, broadcast } = session;
        const r = host.join(m.token, m.name, m.look);
        if (!r.ok) {
          send(ws, { t: 'refused', reason: r.reason });
          ws.close();
          return;
        }
        // the same player again: their old connection is a dropped one; close it
        if (r.replaced !== null) {
          const stale = sockets.get(r.replaced);
          sockets.delete(r.replaced);
          broadcast({ t: 'left', id: r.replaced });
          stale?.close();
        }
        id = r.id;
        sockets.set(id, ws);
        send(ws, {
          t: 'welcome',
          room: roomCode,
          v: PROTOCOL,
          id,
          max: host.max,
          world: host.world(),
          you: host.sliceOf(id)!,
          players: host.everyone().filter((p) => p.id !== id),
        });
        broadcast({ t: 'joined', player: host.info(id)! }, id);
        // how the arena stands, for the menu (once anyone has been in it)
        if (host.arena.started) send(ws, host.arena.stateMessage());
        if (roomCode) publishRooms();
        log(`+ ${m.name} (${address}) · ${host.count}/${host.max}`);
        return;
      }
      const { host, sockets, broadcast, deliver } = session;
      switch (m.t) {
        case 'visit':
          send(ws, host.visit(id, m.target, m.request));
          break;
        case 'move':
          host.move(id, m, m.scene, m.town);
          break;
        case 'patch': {
          const r = host.patch(id, m.patch);
          const you = host.sliceOf(id)!;
          if (!r.ok)
            send(ws, { t: 'rejected', seq: m.seq, kind: m.patch.kind, reason: r.reason, you, fix: r.fix });
          else {
            send(ws, { t: 'ok', seq: m.seq, fix: r.fix, you });
            // the checked, rebuilt patch: nothing a client added rides along to the others
            if (r.shared) broadcast({ t: 'applied', from: id, patch: m.patch, fix: r.fix }, id);
          }
          break;
        }
        case 'arena':
          if (m.a === 'join') deliver(host.arena.join(id));
          else if (m.a === 'leave') deliver(host.arena.leave(id));
          else if (m.mode) deliver(host.arena.vote(id, m.mode));
          break;
        case 'act':
          deliver(host.arena.act(id, m));
          break;
        case 'gesture':
          for (const to of host.gesture(id)) {
            const ws = sockets.get(to);
            if (ws) send(ws, { t: 'gesture', from: id, g: m.g });
          }
          break;
        default:
          break;
      }
    });

    ws.on('close', () => {
      clearTimeout(hello);
      browsers.delete(ws);
      const n = (perAddress.get(address) ?? 1) - 1;
      if (n > 0) perAddress.set(address, n);
      else perAddress.delete(address);
      // replaced by a newer connection of the same player: already handled
      const { host, sockets, broadcast } = session;
      if (id === null || sockets.get(id) !== ws) return;
      const name = host.info(id)?.name;
      host.leave(id);
      if (roomCode) rooms.get(roomCode)!.lastActive = performance.now();
      sockets.delete(id);
      broadcast({ t: 'left', id });
      if (roomCode) publishRooms();
      log(`- ${name} · ${host.count}/${host.max}`);
    });
  });

  // heartbeat: a connection that did not answer the last ping is gone (a pulled cable, a
  // sleeping laptop); drop it so it stops holding a place and its town
  const beat = setInterval(
    () => {
      for (const ws of wss.clients) {
        if (alive.get(ws) === false) {
          ws.terminate();
          continue;
        }
        alive.set(ws, false);
        ws.ping();
      }
    },
    (opts.heartbeat ?? 15) * 1000,
  );

  // the world runs on: the clock, everyone's view of everyone near them, and the saves
  let last = performance.now();
  let dirtyFor = 0;
  let directoryIn = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    directoryIn -= dt;
    function tick({ host, sockets, deliver }: typeof lobby) {
      if (!sockets.size) return;
      // the clock only runs while someone is playing, as it does in a single-player world
      deliver(host.tick(dt));
      const keepers = host.keepers();
      if (directoryIn <= 0) {
        for (const [id, ws] of sockets) send(ws, { t: 'friends', players: host.locations(id) });
      }
      for (const [id, ws] of sockets)
        send(ws, {
          t: 'snap',
          clock: host.state.clock,
          players: host.nearby(id),
          keeps: [...keepers].filter(([, k]) => k === id).map(([town]) => town),
        });
    }
    tick(lobby);
    const roomCount = rooms.size;
    for (const [code, room] of rooms) {
      if (!room.session.sockets.size && now - room.lastActive >= 300_000) rooms.delete(code);
      else tick(room.session);
    }
    if (rooms.size !== roomCount) publishRooms();
    if (directoryIn <= 0) directoryIn = 1;
    dirtyFor = defaultHost.dirty ? dirtyFor + dt : 0;
    if (opts.save && dirtyFor >= (opts.saveDelay ?? 2)) {
      dirtyFor = 0;
      try {
        opts.save();
      } catch (e) {
        // a full disk must not take the world down; try again next time
        log(`could not save: ${(e as Error).message}`);
      }
    }
  }, 1000 / SEND_HZ);

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      const address = wss.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : opts.port,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(timer);
            clearInterval(beat);
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}
