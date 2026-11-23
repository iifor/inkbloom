import * as THREE from 'three';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { defaultLook } from '@/content/characters';
import { WorldHost } from '@/world/net/host';
import { DOWNED, GROUNDED, parseClientMessage, type ServerMessage, type Motion } from '@/world/net/protocol';
import { createWorldState } from '@/world/state';
import { PhysicsWorld } from '@/engine/physics/world';
import { friendLanding } from '@/world/friend-landing';
import { SceneManager } from '@/systems/scenes/scene-manager';
import type { WildScene } from '@/systems/wilderness/wild-scene';
import { NetSystem } from '@/systems/net/net-system';
import type { Connection } from '@/systems/net/connection';
import type { RemotePlayers } from '@/systems/net/remote-players';
import { headless } from './support/headless';

const look = defaultLook('courier');
const motion = (x: number, f = GROUNDED): Motion => ({ p: [x, 2, 0], v: [0, 0, 0], yaw: 0, pitch: 0, f });
const wild = { kind: 'wild' } as const;
afterEach(() => vi.restoreAllMocks());

function hostPair() {
  const host = new WorldHost(createWorldState('friends', 11));
  const join = (token: string, x: number) => {
    const r = host.join(token, token, look);
    if (!r.ok) throw new Error(r.reason);
    host.move(r.id, motion(x), wild, null);
    return r.id;
  };
  return { host, a: join('friend-a', 0), b: join('friend-b', 2000) };
}

describe('friend directory and visits', () => {
  it('locates a distant player without streaming their figure; limits repeat visits', () => {
    const { host, a, b } = hostPair();
    expect(host.nearby(a)).toEqual([]);
    expect(host.locations(a)[0]?.p).toEqual([2000, 2, 0]);
    expect(host.visit(a, b, 1).target?.id).toBe(b);
    expect(host.visit(a, b, 2).reason).toContain('8 秒');
    host.tick(8);
    host.move(a, motion(0), wild, null);
    host.move(b, motion(2020), wild, null);
    expect(host.visit(a, b, 3).target?.p).toEqual([2020, 2, 0]);
  });
  it('rejects self, missing, stale and downed players', () => {
    const { host, a, b } = hostPair();
    expect(host.visit(a, a, 1).target).toBeNull();
    expect(host.visit(a, 999, 2).reason).toContain('离线');
    host.move(b, motion(2000, DOWNED), wild, null);
    expect(host.visit(a, b, 3).reason).toContain('倒下');
    host.tick(6);
    expect(host.locations(a)[0]?.p).toBeNull();
    expect(host.visit(a, b, 4).reason).toContain('位置');
    host.leave(b);
    expect(host.locations(a)).toEqual([]);
  });
  it('hides arena positions from both sides and forbids visits', () => {
    const { host, a, b } = hostPair();
    host.arena.join(b);
    expect(host.locations(a)[0]).toMatchObject({ p: null, arena: true });
    expect(host.locations(b)[0]?.p).toBeNull();
    expect(host.visit(a, b, 1).reason).toContain('竞技场');
    expect(host.visit(b, a, 1).reason).toContain('竞技场');
  });
  it('validates request ids and never accepts client-provided destination coordinates', () => {
    expect(
      parseClientMessage(JSON.stringify({ t: 'visit', target: 2, request: 1, p: [999, 999, 999] })),
    ).toEqual({ t: 'visit', target: 2, request: 1 });
    for (const value of [-1, 0, 1.5, '2', null, 1e30])
      expect(parseClientMessage(JSON.stringify({ t: 'visit', target: value, request: 1 }))).toBeNull();
  });
});

describe('safe ground near a friend', () => {
  it('lands below an airborne friend, beside them, outside solid obstacles', () => {
    const physics = new PhysicsWorld(8);
    physics.ground = () => 2;
    physics.addBox('wall', { x: 1, y: 2, z: -2 }, { x: 5, y: 9, z: 2 });
    const point = friendLanding({ x: 0, y: 100, z: 0 }, physics, physics.ground)!;
    expect(point.y).toBeCloseTo(2.06);
    expect(point.x < 0.65 || Math.abs(point.z) > 2.35).toBe(true);
  });
  it('finds a bank, rejects an open lake and cliffs, allows a bridge deck', () => {
    const physics = new PhysicsWorld(8);
    physics.ground = (x) => (x > 9 ? 2 : -4);
    expect(friendLanding({ x: 0, y: -1, z: 0 }, physics, physics.ground)?.x).toBeGreaterThan(9);
    physics.ground = () => -4;
    expect(friendLanding({ x: 0, y: 0, z: 0 }, physics, physics.ground)).toBeNull();
    physics.addBox('bridge', { x: 1, y: 0, z: -2 }, { x: 5, y: 0.3, z: 2 });
    expect(friendLanding({ x: 0, y: 0, z: 0 }, physics, physics.ground)?.y).toBeCloseTo(0.36);
    physics.removeGroup('bridge');
    physics.ground = (x) => 100 + x * 2;
    expect(friendLanding({ x: 0, y: 100, z: 0 }, physics, physics.ground)).toBeNull();
  });
  it('prepares colliders before probing a candidate', () => {
    const physics = new PhysicsWorld(8);
    physics.ground = () => 2;
    let loaded = false;
    const point = friendLanding({ x: 0, y: 2, z: 0 }, physics, physics.ground, () => {
      if (loaded) return;
      loaded = true;
      physics.addBox('wall', { x: 1, y: 2, z: -2 }, { x: 5, y: 8, z: 2 });
    })!;
    expect(point.x < 0.65 || Math.abs(point.z) > 2.35).toBe(true);
  });
});

it('uses the fade, cancels a vanished target and stops flying only after finding ground', () => {
  const h = headless();
  h.physics.ground = () => 2;
  Object.assign(h.ctx, {
    renderer: { scene: new THREE.Scene() },
    wilderness: { entrancesNear: () => [], townAt: () => null, heightAt: () => 2 },
  });
  const scene = { ...h.ctx.scenes.active, ensureAt: vi.fn(), activate: () => {} } as unknown as WildScene;
  const manager = new SceneManager(h.ctx, scene, () => {
    throw new Error('unexpected city');
  });
  Object.assign(h.ctx, { scenes: manager });
  let online = true;
  const target = () => (online ? { pos: new THREE.Vector3(50, 80, 0), name: '伙伴' } : null);
  h.ctx.player.flying = true;
  expect(manager.travelNear(target)).toBe(true);
  h.run(0.3, (dt) => manager.update(dt));
  expect(h.ctx.player.position.x).toBe(0);
  online = false;
  h.run(1, (dt) => manager.update(dt));
  expect(h.ctx.player.position.x).toBe(0);
  expect(h.ctx.player.flying).toBe(true);
  online = true;
  manager.travelNear(target);
  h.run(1.3, (dt) => manager.update(dt));
  expect(h.ctx.player.position.x).toBeGreaterThan(48);
  expect(h.ctx.player.position.y).toBeCloseTo(2.06);
  expect(h.ctx.player.flying).toBe(false);
  manager.dispose();
});

it('correlates visit replies, expires directory data and cancels after a peer leaves', () => {
  const h = headless();
  const players = [{ id: 2, name: '朋友', look }];
  let inbox: ServerMessage[] = [];
  const send = vi.fn(),
    travelNear = vi.fn(() => true);
  h.ctx.scenes.travelNear = travelNear;
  const conn = {
    welcome: { players, max: 10, id: 1 },
    closed: null,
    send,
    take: () => inbox.splice(0),
    close: () => {},
  } as unknown as Connection;
  const remote = {
    add: () => {},
    list: () => players,
    remove: () => players.splice(0),
    push: () => {},
  } as unknown as RemotePlayers;
  const net = new NetSystem(
    h.ctx,
    conn,
    remote,
    { apply: () => {}, flush: () => {}, correct: () => {} },
    () => ({ item: null, painting: false, aiming: false }) as never,
  );
  const location = { id: 2, p: [2000, 2, 0] as const, scene: wild, arena: false, alive: true };
  inbox.push({ t: 'friends', players: [location] });
  net.update(0.05);
  net.trackFriend(2);
  expect(net.friendGuide).toContain('2.0 公里');
  expect(net.visitFriend(2)).toBe(true);
  expect(net.visitFriend(2)).toBe(false);
  inbox.push({ t: 'visit', request: 100, target: location, reason: '' });
  net.update(0.05);
  expect(travelNear).not.toHaveBeenCalled();
  inbox.push({ t: 'visit', request: 1, target: location, reason: '' });
  net.update(0.05);
  expect(travelNear).toHaveBeenCalledOnce();
  const resolve = (travelNear.mock.calls[0] as unknown as [() => unknown])[0];
  expect(resolve()).toMatchObject({ name: '朋友' });
  vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 6000);
  expect(net.friends[0]?.canVisit).toBe(false);
  expect(resolve()).toBeNull();
  inbox.push({ t: 'left', id: 2 });
  net.update(0.05);
  expect(net.friendGuide).toBe('');
  expect(net.friends).toEqual([]);
});
