// Moves messages between WebSockets and a WorldHost: hello and welcome, motion, patches, and 20
// snapshots a second with the clock, nearby players and the towns each client keeps. The rules
// are in src/world/net/host.ts; saving to disk is the caller's (server/main.ts).
//
// What a connection may do is limited here: pages from other web sites cannot connect (Origin
// check), an optional password keeps strangers out, each connection has a message budget, a
// few connections per address at most, and connections that stop answering are dropped.
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { type WebSocket, WebSocketServer } from 'ws';
import type { WorldHost } from '@/world/net/host';
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

export function serve(host: WorldHost, opts: ServeOptions): Promise<Served> {
  const log = opts.log ?? (() => {});
  const sockets = new Map<number, WebSocket>();
  const perAddress = new Map<string, number>();
  const send = (ws: WebSocket, m: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  const broadcast = (m: ServerMessage, except?: number): void => {
    for (const [id, ws] of sockets) if (id !== except) send(ws, m);
  };
  const addressOf = (req: IncomingMessage): string => req.socket.remoteAddress ?? '?';
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
      const m = parseClientMessage(data.toString());
      if (!m) return;
      if (id === null) {
        if (m.t !== 'hello') return;
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
          v: PROTOCOL,
          id,
          max: host.max,
          world: host.world(),
          you: host.sliceOf(id)!,
          players: host.everyone().filter((p) => p.id !== id),
        });
        broadcast({ t: 'joined', player: host.info(id)! }, id);
        log(`+ ${m.name} (${address}) · ${host.count}/${host.max}`);
        return;
      }
      switch (m.t) {
        case 'move':
          host.move(id, m, m.scene, m.town);
          break;
        case 'patch': {
          const r = host.patch(id, m.patch);
          if (!r.ok)
            send(ws, {
              t: 'rejected',
              seq: m.seq,
              kind: m.patch.kind,
              reason: r.reason,
              you: host.sliceOf(id)!,
            });
          // the checked, rebuilt patch: nothing a client added rides along to the others
          else if (r.shared) broadcast({ t: 'applied', from: id, patch: m.patch }, id);
          break;
        }
        default:
          break;
      }
    });

    ws.on('close', () => {
      clearTimeout(hello);
      const n = (perAddress.get(address) ?? 1) - 1;
      if (n > 0) perAddress.set(address, n);
      else perAddress.delete(address);
      // replaced by a newer connection of the same player: already handled
      if (id === null || sockets.get(id) !== ws) return;
      const name = host.info(id)?.name;
      host.leave(id);
      sockets.delete(id);
      broadcast({ t: 'left', id });
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
  const timer = setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    // the clock only runs while someone is playing, as it does in a single-player world
    if (sockets.size) host.tick(dt);
    const keepers = host.keepers();
    for (const [id, ws] of sockets)
      send(ws, {
        t: 'snap',
        clock: host.state.clock,
        players: host.nearby(id),
        keeps: [...keepers].filter(([, k]) => k === id).map(([town]) => town),
      });
    dirtyFor = host.dirty ? dirtyFor + dt : 0;
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
