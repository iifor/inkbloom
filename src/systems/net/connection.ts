// The browser's line to a world server: open a WebSocket, say hello, wait for the welcome. After
// that, messages queue up here and the NetSystem takes them once a frame, so the game only ever
// changes state inside its own frame loop.
import type { Look } from '@/content/characters';
import {
  type ClientMessage,
  DEFAULT_PORT,
  PROTOCOL,
  type ServerMessage,
  parseServerMessage,
} from '@/world/net/protocol';
import type { WorldStore } from '@/world/store';
import type { KeyValue } from '@/world/store';

export type Welcome = Extract<ServerMessage, { t: 'welcome' }>;

export class Connection {
  private queue: ServerMessage[] = [];
  /** Why the line went down, once it has. */
  closed: string | null = null;

  constructor(
    private readonly ws: WebSocket,
    readonly url: string,
    readonly welcome: Welcome,
  ) {
    ws.onmessage = (e) => {
      const m = parseServerMessage(String(e.data));
      if (m) this.queue.push(m);
    };
    ws.onclose = () => {
      this.closed ??= '和服务器的连接断开了';
    };
  }

  send(m: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Everything that arrived since the last call. */
  take(): ServerMessage[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  close(): void {
    this.closed ??= '已离开';
    this.ws.close();
  }
}

/** "host", "host:port" or a ws:// URL, as a ws:// URL with a port. */
export function serverUrl(raw: string): string {
  const s = raw.trim();
  if (/^wss?:\/\//.test(s)) return s;
  return /:\d+$/.test(s) ? `ws://${s}` : `ws://${s}:${DEFAULT_PORT}`;
}

/** The server would not take this player; `password` when it wants (another) password. */
export class JoinRefused extends Error {
  constructor(
    message: string,
    readonly password: boolean,
  ) {
    super(message);
  }
}

/**
 * A random id this browser keeps for one server, so it gives a player their own things back.
 * One per server: a server only ever sees its own, so a stranger's server cannot learn the id
 * a player uses elsewhere and pose as them there.
 */
export function playerToken(kv: KeyValue, url: string): string {
  const key = `inkbloom:token:${url}`;
  let t = kv.getItem(key);
  if (!t || !/^[\w-]{8,64}$/.test(t)) {
    t = crypto.randomUUID();
    kv.setItem(key, t);
  }
  return t;
}

/** Connect and join; rejects with a message for the player if it does not work. */
export function connect(
  url: string,
  hello: { readonly token: string; readonly name: string; readonly look: Look; readonly password: string },
  timeoutMs = 8000,
): Promise<Connection> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      reject(new Error(`地址不对：${url}`));
      return;
    }
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`连不上 ${url}：没有回应`));
    }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, ...hello } satisfies ClientMessage));
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`连不上 ${url}：服务器没开，或者地址不对`));
    };
    ws.onmessage = (e) => {
      const m = parseServerMessage(String(e.data));
      if (m?.t === 'refused') {
        clearTimeout(timer);
        reject(new JoinRefused(m.reason, m.password === true));
      } else if (m?.t === 'welcome') {
        clearTimeout(timer);
        resolve(new Connection(ws, url, m));
      }
    };
  });
}

/** Saves in a server world: the server keeps everything, so there is nothing to write here. */
export class NetStore implements WorldStore {
  async load(): Promise<null> {
    return null;
  }
  async save(): Promise<void> {}
  async remove(): Promise<void> {}
  async quarantine(): Promise<null> {
    return null;
  }
  async list(): Promise<[]> {
    return [];
  }
}
