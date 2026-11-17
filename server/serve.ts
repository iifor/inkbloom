// Moves messages between WebSockets and a WorldHost: hello and welcome, motion, patches, and 20
// snapshots a second with the clock, nearby players and the towns each client keeps. The rules
// are in src/world/net/host.ts; saving to disk is the caller's (server/main.ts).
import { type WebSocket, WebSocketServer } from 'ws';
import type { WorldHost } from '@/world/net/host';
import { PROTOCOL, SEND_HZ, type ServerMessage, parseClientMessage } from '@/world/net/protocol';

/** A connection that has not said hello by now is dropped. */
const HELLO_TIMEOUT_MS = 5000;

export interface Served {
  /** The port it listens on (useful with port 0). */
  readonly port: number;
  close(): Promise<void>;
}

export function serve(
  host: WorldHost,
  opts: {
    readonly port: number;
    readonly bind?: string;
    /** Called when there is something to save, at most every `saveDelay` seconds. */
    readonly save?: () => void;
    readonly saveDelay?: number;
    readonly log?: (line: string) => void;
  },
): Promise<Served> {
  const log = opts.log ?? (() => {});
  const sockets = new Map<number, WebSocket>();
  const send = (ws: WebSocket, m: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  const broadcast = (m: ServerMessage, except?: number): void => {
    for (const [id, ws] of sockets) if (id !== except) send(ws, m);
  };
  const wss = new WebSocketServer({ port: opts.port, host: opts.bind ?? '0.0.0.0', maxPayload: 32 * 1024 });

  wss.on('connection', (ws, req) => {
    let id: number | null = null;
    const hello = setTimeout(() => id === null && ws.close(), HELLO_TIMEOUT_MS);

    ws.on('message', (data) => {
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
        const r = host.join(m.token, m.name, m.look);
        if (!r.ok) {
          send(ws, { t: 'refused', reason: r.reason });
          ws.close();
          return;
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
        log(`+ ${m.name} (${req.socket.remoteAddress}) · ${host.count}/${host.max}`);
        return;
      }
      switch (m.t) {
        case 'move':
          host.move(id, m, m.scene, m.town);
          break;
        case 'patch': {
          const r = host.patch(id, m.patch);
          if (!r.ok) send(ws, { t: 'rejected', seq: m.seq, reason: r.reason, you: host.sliceOf(id)! });
          else if (r.shared) broadcast({ t: 'applied', from: id, patch: m.patch }, id);
          break;
        }
        default:
          break;
      }
    });

    ws.on('close', () => {
      clearTimeout(hello);
      if (id === null) return;
      const name = host.info(id)?.name;
      host.leave(id);
      sockets.delete(id);
      broadcast({ t: 'left', id });
      log(`- ${name} · ${host.count}/${host.max}`);
    });
  });

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
      opts.save();
      dirtyFor = 0;
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
            for (const ws of sockets.values()) ws.close();
            wss.close(() => done());
          }),
      });
    });
  });
}
