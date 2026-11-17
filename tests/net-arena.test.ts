// The arena through the world host (no sockets), then over real WebSockets.
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { serve, type Served } from '../server/serve';
import { ARENA } from '@/content/arena';
import { defaultLook } from '@/content/characters';
import { type Vec, sees } from '@/world/arena/hits';
import type { Outgoing } from '@/world/net/arena-host';
import { WorldHost } from '@/world/net/host';
import { GROUNDED, PROTOCOL, type ServerMessage, type Vec3, parseClientMessage } from '@/world/net/protocol';
import { createWorldState } from '@/world/state';
import { createWilderness } from '@/world/wilderness/generator';

const SEED = 11;
const LOOK = defaultLook('ranger');
const wild = { kind: 'wild' } as const;
const EYE = 1.65;

function setup() {
  const h = new WorldHost(createWorldState('arena', SEED), new Map(), 10);
  const w = createWilderness(SEED);
  const site = h.arena.site;
  const ground = (x: number, z: number): Vec => ({ x, y: w.heightAt(x, z), z });
  const put = (id: number, p: Vec): void =>
    h.move(id, { p: [p.x, p.y, p.z], v: [0, 0, 0], yaw: 0, pitch: 0, f: GROUNDED }, wild, null);
  const join = (i: number): number => {
    const r = h.join(`arena-token-${i}`, `玩家${i}`, LOOK);
    if (!r.ok) throw new Error(r.reason);
    return r.id;
  };
  /** Two spots inside, 6 m apart, that see each other over the ground and cover. */
  const pair = (): [Vec, Vec] => {
    const solid = { heightAt: w.heightAt.bind(w), boxes: [...site.cover, ...site.trunks] };
    for (const s of site.spawns) {
      const a = ground(s.x, s.z);
      const len = Math.hypot(site.x - s.x, site.z - s.z);
      const b = ground(s.x + ((site.x - s.x) / len) * 6, s.z + ((site.z - s.z) / len) * 6);
      if (sees(solid, { ...a, y: a.y + EYE }, { ...b, y: b.y + 1 })) return [a, b];
    }
    throw new Error('no clear pair of spots');
  };
  const run = (seconds: number): Outgoing[] => {
    const out: Outgoing[] = [];
    for (let t = 0; t < seconds; t += 0.05) out.push(...h.tick(0.05));
    return out;
  };
  return { h, site, put, join, pair, run };
}

const msgs = (out: Outgoing[], t: ServerMessage['t']) => out.map((o) => o.m).filter((m) => m.t === t);
const toward = (a: Vec, b: Vec): Vec3 => {
  const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return [(b.x - a.x) / d, (b.y - a.y) / d, (b.z - a.z) / d];
};

describe('the arena on the world host', () => {
  it('two players in, a round starts, a head shot and a kill are the server’s to decide', () => {
    const { h, put, join, pair, run } = setup();
    const a = join(1);
    const b = join(2);
    const [pa, pb] = pair();
    expect(msgs(h.arena.join(a), 'spawn')).toHaveLength(1);
    h.arena.join(b);
    // to the fight: the countdown, then both stand where the test wants them
    const start = run(ARENA.countdown + 0.2);
    expect(msgs(start, 'arena').some((m) => m.t === 'arena' && m.state.phase === 'fighting')).toBe(true);
    run(ARENA.grace + 0.2);
    for (let i = 0; i < 3; i++) {
      put(a, pa);
      put(b, pb);
      run(0.05);
    }
    const eye: Vec3 = [pa.x, pa.y + EYE, pa.z];
    const head = { x: pb.x, y: pb.y + 1.62, z: pb.z };
    const at = h.state.clock;
    const shot = h.arena.act(a, {
      w: 'rifle',
      k: 'shot',
      o: eye,
      d: toward({ x: eye[0], y: eye[1], z: eye[2] }, head),
      at,
    });
    const hit = msgs(shot, 'hit')[0];
    expect(hit).toMatchObject({ t: 'hit', from: a, to: b, head: true, hp: 100 - Math.round(9 * 1.5) });
    // others in the arena are told what was fired
    expect(msgs(shot, 'act')).toHaveLength(1);
    // the rifle cannot fire again at once
    expect(
      msgs(
        h.arena.act(a, {
          w: 'rifle',
          k: 'shot',
          o: eye,
          d: toward({ x: eye[0], y: eye[1], z: eye[2] }, head),
          at,
        }),
        'hit',
      ),
    ).toEqual([]);
    // a sniper's head shot finishes it
    const kill = h.arena.act(a, {
      w: 'sniper',
      k: 'shot',
      o: eye,
      d: toward({ x: eye[0], y: eye[1], z: eye[2] }, head),
      at,
    });
    expect(msgs(kill, 'down')).toEqual([{ t: 'down', who: b, by: a, w: 'sniper' }]);
    const later = run(ARENA.respawn + 0.1);
    expect(msgs(later, 'spawn').map((m) => m.t === 'spawn' && m.who)).toContain(b);
  });

  it('a shot from somewhere the shooter is not, or by someone outside, does nothing', () => {
    const { h, put, join, pair, run } = setup();
    const a = join(1);
    const b = join(2);
    const c = join(3);
    const [pa, pb] = pair();
    h.arena.join(a);
    h.arena.join(b);
    run(ARENA.countdown + ARENA.grace + 0.5);
    put(a, pa);
    put(b, pb);
    put(c, pa);
    run(0.1);
    const head = { x: pb.x, y: pb.y + 1.62, z: pb.z };
    const far: Vec3 = [pa.x + 20, pa.y + EYE, pa.z];
    expect(
      h.arena.act(a, {
        w: 'sniper',
        k: 'shot',
        o: far,
        d: toward({ x: far[0], y: far[1], z: far[2] }, head),
        at: h.state.clock,
      }),
    ).toEqual([]);
    const eye: Vec3 = [pa.x, pa.y + EYE, pa.z];
    // c never joined the arena
    expect(
      h.arena.act(c, {
        w: 'sniper',
        k: 'shot',
        o: eye,
        d: toward({ x: eye[0], y: eye[1], z: eye[2] }, head),
        at: h.state.clock,
      }),
    ).toEqual([]);
  });

  it('a player dropping out leaves the arena too', () => {
    const { h, join, run } = setup();
    const a = join(1);
    const b = join(2);
    h.arena.join(a);
    h.arena.join(b);
    h.leave(b);
    const out = run(0.1);
    const state = msgs(out, 'arena')[0];
    expect(state?.t === 'arena' && state.state.members.map((m) => m.id)).toEqual([a]);
  });

  it('checks act and arena messages field by field', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'arena', a: 'join' }))).toEqual({ t: 'arena', a: 'join' });
    expect(parseClientMessage(JSON.stringify({ t: 'arena', a: 'vote', mode: 'teams' }))).toMatchObject({
      mode: 'teams',
    });
    expect(parseClientMessage(JSON.stringify({ t: 'arena', a: 'vote', mode: 'all' }))).toBeNull();
    const act = { t: 'act', w: 'rifle', k: 'shot', o: [1, 2, 3], d: [0, 0, -2], at: 5 };
    expect(parseClientMessage(JSON.stringify(act))).toMatchObject({ d: [0, 0, -1] });
    // a rifle has no ink circle; a weapon that does not exist; no direction
    expect(parseClientMessage(JSON.stringify({ ...act, k: 'field' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...act, w: 'nuke' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...act, d: [0, 0, 0] }))).toBeNull();
  });
});

describe('the arena over WebSockets', () => {
  let server: Served | null = null;
  const sockets: WebSocket[] = [];
  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    await server?.close();
    server = null;
  });

  function client(port: number, token: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(ws);
    const got: ServerMessage[] = [];
    ws.on('message', (d) => got.push(JSON.parse(d.toString()) as ServerMessage));
    const waitFor = (test: (m: ServerMessage) => boolean): Promise<ServerMessage> =>
      new Promise((done, fail) => {
        const started = Date.now();
        const look = (): void => {
          const m = got.find(test);
          if (m) done(m);
          else if (Date.now() - started > 3000) fail(new Error('timed out'));
          else setTimeout(look, 10);
        };
        look();
      });
    const send = (m: object): void => ws.send(JSON.stringify(m));
    return new Promise<{ send: typeof send; waitFor: typeof waitFor; got: ServerMessage[] }>((done) =>
      ws.on('open', () => {
        send({ t: 'hello', v: PROTOCOL, token, name: token.slice(0, 4), look: LOOK });
        done({ send, waitFor, got });
      }),
    );
  }

  it('joining tells everyone, spawns the player, and the others see what they fire', async () => {
    server = await serve(new WorldHost(createWorldState('it', SEED), new Map(), 10), {
      port: 0,
      bind: '127.0.0.1',
    });
    const a = await client(server.port, 'token-aaaaaaaa');
    const welcome = await a.waitFor((m) => m.t === 'welcome');
    const b = await client(server.port, 'token-bbbbbbbb');
    await b.waitFor((m) => m.t === 'welcome');
    const aid = welcome.t === 'welcome' ? welcome.id : -1;
    a.send({ t: 'arena', a: 'join' });
    const spawn = await a.waitFor((m) => m.t === 'spawn');
    expect(spawn).toMatchObject({ who: aid });
    // someone outside the arena still hears how it stands (for the menu)
    const state = await b.waitFor((m) => m.t === 'arena');
    expect(state.t === 'arena' && state.state.members.map((m) => m.id)).toEqual([aid]);
    b.send({ t: 'arena', a: 'join' });
    await b.waitFor((m) => m.t === 'spawn');
    // a fires from where it stands: b sees the shot
    const p = spawn.t === 'spawn' ? spawn.p : [0, 0, 0];
    a.send({ t: 'move', p, v: [0, 0, 0], yaw: 0, pitch: 0, f: GROUNDED, scene: wild, town: null });
    await new Promise((r) => setTimeout(r, 120));
    a.send({ t: 'act', w: 'rifle', k: 'shot', o: [p[0], p[1] + EYE, p[2]], d: [0, 0, -1], at: 0 });
    const seen = await b.waitFor((m) => m.t === 'act');
    expect(seen).toMatchObject({ from: aid, w: 'rifle', k: 'shot' });
  });
});
