// Two real clients against the real WebSocket server, on a random port.
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { originAllowed, serve, type Served } from '../server/serve';
import { defaultLook } from '@/content/characters';
import { WorldHost } from '@/world/net/host';
import { GROUNDED, PROTOCOL, type ServerMessage } from '@/world/net/protocol';
import { createWorldState } from '@/world/state';
import { createWilderness } from '@/world/wilderness/generator';
import { sourcesInChunk } from '@/world/wilderness/sources';

const SEED = 11;
const LOOK = defaultLook('ranger');

interface Client {
  readonly ws: WebSocket;
  readonly got: ServerMessage[];
  waitFor(t: ServerMessage['t'], test?: (m: ServerMessage) => boolean): Promise<ServerMessage>;
  send(m: object): void;
}

function client(port: number, name: string, token: string): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: ServerMessage[] = [];
  const waiting: { t: string; test: (m: ServerMessage) => boolean; done: (m: ServerMessage) => void }[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString()) as ServerMessage;
    got.push(m);
    for (const w of [...waiting])
      if (w.t === m.t && w.test(m)) {
        waiting.splice(waiting.indexOf(w), 1);
        w.done(m);
      }
  });
  const c: Client = {
    ws,
    got,
    send: (m) => ws.send(JSON.stringify(m)),
    waitFor: (t, test = () => true) =>
      new Promise((done, fail) => {
        const seen = got.find((m) => m.t === t && test(m));
        if (seen) return done(seen);
        waiting.push({ t, test, done });
        setTimeout(() => fail(new Error(`no ${t} for ${name}`)), 3000);
      }),
  };
  return new Promise((done) =>
    ws.on('open', () => {
      c.send({ t: 'hello', v: PROTOCOL, token, name, look: LOOK });
      done(c);
    }),
  );
}

let server: Served | null = null;
const clients: Client[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.close();
  await server?.close();
  server = null;
});

async function start(max = 10): Promise<number> {
  server = await serve(new WorldHost(createWorldState('it', SEED), new Map(), max), {
    port: 0,
    bind: '127.0.0.1',
  });
  return server.port;
}

describe('world server over WebSockets', () => {
  it('two players see each other and share a harvest', async () => {
    const port = await start();
    const a = await client(port, '甲', 'token-aaaaaaaa');
    clients.push(a);
    await a.waitFor('welcome');
    const b = await client(port, '乙', 'token-bbbbbbbb');
    clients.push(b);
    const welcome = await b.waitFor('welcome');
    expect(welcome.t === 'welcome' && welcome.players.map((p) => p.name)).toEqual(['甲']);
    await a.waitFor('joined');

    // both move; each sees the other in the snapshots
    const move = (c: Client, x: number): void =>
      c.send({
        t: 'move',
        p: [x, 5, 0],
        v: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        f: GROUNDED,
        scene: { kind: 'wild' },
        town: null,
      });
    move(a, 0);
    move(b, 10);
    const seen = await a.waitFor('snap', (m) => m.t === 'snap' && m.players.some((p) => p.p[0] === 10));
    expect(seen.t === 'snap' && seen.players.length).toBe(1);

    // a harvests a pigment source: b is told, and finds it gone
    const w = createWilderness(SEED);
    let source = '';
    for (let cx = -3; cx <= 3 && !source; cx++)
      for (let cz = -3; cz <= 3 && !source; cz++) source = sourcesInChunk(w, cx, cz)[0]?.id ?? '';
    a.send({ t: 'patch', seq: 1, patch: { kind: 'harvest', source } });
    const applied = await b.waitFor('applied');
    expect(applied.t === 'applied' && applied.patch).toEqual({ kind: 'harvest', source });
    b.send({ t: 'patch', seq: 1, patch: { kind: 'harvest', source } });
    const no = await b.waitFor('rejected');
    expect(no.t === 'rejected' && no.reason).toBeTruthy();
  });

  it('turns away a player when the world is full', async () => {
    const port = await start(2);
    for (const [name, token] of [
      ['甲', 'token-aaaaaaaa'],
      ['乙', 'token-bbbbbbbb'],
    ] as const) {
      const c = await client(port, name, token);
      clients.push(c);
      await c.waitFor('welcome');
    }
    const c = await client(port, '丙', 'token-cccccccc');
    clients.push(c);
    const r = await c.waitFor('refused');
    expect(r.t === 'refused' && r.reason).toContain('已满');
  });
});

describe('world server: who may connect', () => {
  it('lets in pages from this machine and private networks, not other web sites', () => {
    expect(originAllowed(undefined)).toBe(true);
    expect(originAllowed('http://localhost:5190')).toBe(true);
    expect(originAllowed('http://127.0.0.1:5190')).toBe(true);
    expect(originAllowed('http://192.168.1.20:5190')).toBe(true);
    expect(originAllowed('https://evil.example')).toBe(false);
    expect(originAllowed('https://my.site', ['https://my.site'])).toBe(true);
  });

  it('refuses a WebSocket from another web site', async () => {
    const port = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'https://evil.example' });
    const outcome = await new Promise<string>((done) => {
      ws.on('open', () => done('open'));
      ws.on('error', () => done('refused'));
    });
    expect(outcome).toBe('refused');
  });

  it('asks for the password, and lets in whoever gives it', async () => {
    server = await serve(new WorldHost(createWorldState('it', SEED), new Map(), 10), {
      port: 0,
      bind: '127.0.0.1',
      password: '开门',
    });
    const port = server.port;
    const without = await client(port, '甲', 'token-aaaaaaaa');
    clients.push(without);
    const no = await without.waitFor('refused');
    expect(no.t === 'refused' && no.password).toBe(true);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const welcome = await new Promise<ServerMessage>((done) => {
      ws.on('open', () =>
        ws.send(
          JSON.stringify({
            t: 'hello',
            v: PROTOCOL,
            token: 'token-bbbbbbbb',
            name: '乙',
            look: LOOK,
            password: '开门',
          }),
        ),
      );
      ws.on('message', (d) => done(JSON.parse(d.toString()) as ServerMessage));
    });
    ws.close();
    expect(welcome.t).toBe('welcome');
  });

  it('the same player reconnecting replaces their old connection, which is closed', async () => {
    const port = await start();
    const old = await client(port, '甲', 'token-aaaaaaaa');
    clients.push(old);
    await old.waitFor('welcome');
    const closed = new Promise<void>((done) => old.ws.on('close', () => done()));
    const again = await client(port, '甲', 'token-aaaaaaaa');
    clients.push(again);
    await again.waitFor('welcome');
    await closed;
  });
});
