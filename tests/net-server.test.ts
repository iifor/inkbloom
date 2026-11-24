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

function client(port: number, name: string, token: string, hello: object = {}): Promise<Client> {
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
      c.send({ t: 'hello', v: PROTOCOL, token, name, look: LOOK, ...hello });
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
  it('streams room occupancy and lock status to an authenticated non-player', async () => {
    const host = new WorldHost(createWorldState('directory', SEED), new Map(), 2);
    server = await serve(host, { port: 0, bind: '127.0.0.1', password: 'service' });
    const port = server.port;
    const denied = await client(port, '', '', { t: 'listRooms', password: '' });
    clients.push(denied);
    expect(await denied.waitFor('refused')).toMatchObject({ password: true });
    const observer = await client(port, '', '', { t: 'listRooms', password: 'service' });
    clients.push(observer);
    expect(await observer.waitFor('rooms')).toEqual({ t: 'rooms', rooms: [] });
    expect(host.count).toBe(0);
    const owner = await client(port, 'owner', 'directory-owner', {
      room: { action: 'create' },
      roomPassword: 'secret',
      password: 'service',
    });
    clients.push(owner);
    const welcome = await owner.waitFor('welcome');
    if (welcome.t !== 'welcome') throw new Error('missing welcome');
    const full = await client(port, 'guest', 'directory-guest', {
      room: { action: 'join', code: welcome.room },
      roomPassword: 'secret',
      password: 'service',
    });
    clients.push(full);
    const withCount = (count: number) =>
      observer.waitFor('rooms', (m) => m.t === 'rooms' && m.rooms[0]?.count === count);
    expect(await withCount(2)).toEqual({
      t: 'rooms',
      rooms: [{ code: welcome.room, count: 2, max: 2, locked: true }],
    });
    full.ws.close();
    owner.ws.close();
    expect(await withCount(0)).toMatchObject({ rooms: [{ count: 0 }] });
    const open = await client(port, 'open', 'directory-open', {
      room: { action: 'create' },
      password: 'service',
    });
    clients.push(open);
    expect(await observer.waitFor('rooms', (m) => m.t === 'rooms' && m.rooms.length === 2)).toMatchObject({
      rooms: [{ locked: true }, { locked: false, count: 1 }],
    });
  });
  it('isolates rooms and checks a private room password before joining', async () => {
    const port = await start();
    const enter = async (name: string, hello: object) => {
      const c = await client(port, name, 'token-' + name, hello);
      clients.push(c);
      return c;
    };
    const create = { action: 'create' };
    const owner = await enter('owner', { room: create, roomPassword: '花' });
    const welcome = await owner.waitFor('welcome');
    if (welcome.t !== 'welcome' || !welcome.room) throw new Error('missing room');
    const join = { action: 'join', code: welcome.room };
    const denied = await enter('guest', { room: join, roomPassword: '墨' });
    expect(await denied.waitFor('refused')).toMatchObject({ roomPassword: true });
    await new Promise<void>((done) =>
      denied.ws.readyState === WebSocket.CLOSED ? done() : denied.ws.once('close', done),
    );
    const guest = await enter('guest', { room: join, roomPassword: '花' });
    expect(await guest.waitFor('welcome')).toMatchObject({
      room: welcome.room,
      players: [{ name: 'owner' }],
    });
    const other = await enter('other', { room: create });
    const open = await other.waitFor('welcome');
    if (open.t !== 'welcome') throw new Error('missing welcome');
    expect(open.players).toEqual([]);
    expect(open.room).not.toBe(welcome.room);
    const friend = await enter('friend', { room: { action: 'join', code: open.room } });
    expect(await friend.waitFor('welcome')).toMatchObject({ players: [{ name: 'other' }] });
    expect(await owner.waitFor('friends')).toMatchObject({
      players: expect.not.arrayContaining([expect.objectContaining({ name: 'friend' })]),
    });
  });
  it('relays sitting, lying and getting up, then removes the pose on standing', async () => {
    const port = await start();
    const a = await client(port, '坐下的人', 'rest-aaaaaaaa');
    const b = await client(port, '观察的人', 'rest-bbbbbbbb');
    clients.push(a, b);
    const welcome = await a.waitFor('welcome');
    await b.waitFor('welcome');
    if (welcome.t !== 'welcome') throw new Error('welcome missing');
    const movement = {
      t: 'move',
      p: [0, 2, 0],
      v: [0, 0, 0],
      yaw: 0.5,
      pitch: 0,
      f: GROUNDED,
      scene: { kind: 'wild' },
      town: null,
    };
    b.send(movement);
    for (const [sitting, lying] of [
      [1, 0],
      [0, 1],
      [0, 0.4],
      [0, 0],
    ]) {
      const rest = { sitting, lying, groundPitch: 0.1, groundRoll: 0, yaw: 0 };
      a.send({ ...movement, ...(sitting || lying ? { rest } : {}) });
      const snap = await b.waitFor(
        'snap',
        (m) =>
          m.t === 'snap' &&
          m.players.some(
            (p) =>
              p.id === welcome.id &&
              (sitting || lying ? p.rest?.sitting === sitting && p.rest?.lying === lying : !p.rest),
          ),
      );
      expect(snap.t === 'snap' && snap.players.find((p) => p.id === welcome.id)?.rest).toEqual(
        sitting || lying ? rest : undefined,
      );
    }
  });
  it('finds and visits a friend outside the motion streaming radius', async () => {
    const port = await start();
    const a = await client(port, '甲', 'friend-aaaa');
    const b = await client(port, '乙', 'friend-bbbb');
    clients.push(a, b);
    const aw = await a.waitFor('welcome');
    const bw = await b.waitFor('welcome');
    if (aw.t !== 'welcome' || bw.t !== 'welcome') throw new Error('welcome missing');
    for (const [c, x] of [
      [a, 0],
      [b, 2000],
    ] as const)
      c.send({
        t: 'move',
        p: [x, 2, 0],
        v: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        f: GROUNDED,
        scene: { kind: 'wild' },
        town: null,
      });
    const directory = await a.waitFor(
      'friends',
      (m) => m.t === 'friends' && m.players.some((p) => p.p?.[0] === 2000),
    );
    expect(directory.t === 'friends' && directory.players[0]?.id).toBe(bw.id);
    const snap = await a.waitFor('snap');
    expect(snap.t === 'snap' && snap.players).toEqual([]);
    a.send({ t: 'visit', target: bw.id, request: 10 });
    const answer = await a.waitFor('visit');
    expect(answer).toMatchObject({ request: 10, target: { id: bw.id, p: [2000, 2, 0] } });
    b.ws.close();
    await a.waitFor('left');
    a.send({ t: 'visit', target: bw.id, request: 11 });
    const gone = await a.waitFor('visit', (m) => m.t === 'visit' && m.request === 11);
    expect(gone).toMatchObject({ target: null, reason: '伙伴已离线' });
  });
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
    // the harvester and everyone else get the same server-clock time for it
    const ok = await a.waitFor('ok');
    const when = ok.t === 'ok' && ok.fix?.harvested;
    expect(when).toEqual([[source, expect.any(Number)]]);
    expect(applied.t === 'applied' && applied.fix?.harvested).toEqual(when);
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

describe('world server: what others hold and do', () => {
  it('passes on what is in hand with the motion, and gestures to the players nearby', async () => {
    const port = await start();
    const a = await client(port, '甲', 'token-aaaaaaaa');
    clients.push(a);
    await a.waitFor('welcome');
    const b = await client(port, '乙', 'token-bbbbbbbb');
    clients.push(b);
    await b.waitFor('welcome');
    const move = (c: Client, x: number, extra: object = {}): void =>
      c.send({
        t: 'move',
        p: [x, 5, 0],
        v: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        f: GROUNDED,
        scene: { kind: 'wild' },
        town: null,
        ...extra,
      });
    move(a, 0, { h: 'katana' });
    move(b, 10);
    const snap = await b.waitFor('snap', (m) => m.t === 'snap' && m.players.length > 0);
    expect(snap.t === 'snap' && snap.players[0]!.h).toBe('katana');

    // a swing reaches b, from a, with nothing else in it
    a.send({ t: 'gesture', g: 'attack', extra: 1 });
    const seen = await b.waitFor('gesture');
    expect(seen).toEqual({ t: 'gesture', from: expect.any(Number), g: 'attack' });
    // and never comes back to the one who did it
    a.send({ t: 'gesture', g: 'skill' });
    await b.waitFor('gesture', (m) => m.t === 'gesture' && m.g === 'skill');
    expect(a.got.some((m) => m.t === 'gesture')).toBe(false);
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
