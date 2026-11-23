import * as THREE from 'three';
import { expect, it } from 'vitest';
import { CHARACTERS, defaultLook } from '@/content/characters';
import {
  FLYING,
  GROUNDED,
  SWIMMING,
  DOWNED,
  parseClientMessage,
  type Motion,
  type RestMotion,
} from '@/world/net/protocol';
import { interpolate } from '@/systems/net/remote-players';
import { PlayerFigures, type PlayerPose } from '@/systems/figures/player-figure';
import { heldIn } from '@/systems/figures/player-hold';
import { NetSystem } from '@/systems/net/net-system';
import type { Connection } from '@/systems/net/connection';
import type { RemotePlayers } from '@/systems/net/remote-players';
import { headless } from './support/headless';

const seated: RestMotion = { sitting: 1, lying: 0, groundPitch: 0.1, groundRoll: -0.05, yaw: 3.13 };
const lying: RestMotion = { ...seated, sitting: 0, lying: 1 };
const move = (rest?: RestMotion): Motion => ({
  p: [0, 0, 0],
  v: [0, 0, 0],
  yaw: -3.13,
  pitch: 0,
  f: GROUNDED,
  h: 'rifle',
  ...(rest ? { rest } : {}),
});
const pose: PlayerPose = {
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  walk: 0,
  stride: 0,
  air: false,
  glide: false,
  hurt: 0,
  dying: -1,
  t: 0,
  held: 'rifle',
};

it('checks and rebuilds rest data while retaining moves from standing players', () => {
  const parse = (rest: unknown, f = GROUNDED) =>
    parseClientMessage(
      JSON.stringify({
        t: 'move',
        ...move(),
        rest,
        f,
        scene: { kind: 'wild' },
        town: null,
      }),
    );
  expect(parse({ ...lying, extra: 'discard' })).toMatchObject({ rest: lying });
  expect(parse(undefined)).not.toHaveProperty('rest');
  for (const value of [
    null,
    {},
    { ...lying, lying: 2 },
    { ...lying, sitting: -1 },
    { ...lying, groundPitch: 4 },
    { ...lying, yaw: 'NaN' },
    { ...lying, sitting: 1 },
  ])
    expect(parse(value)).toBeNull();
  for (const flag of [FLYING, SWIMMING, DOWNED]) expect(parse(lying, flag)).not.toHaveProperty('rest');
});

it('interpolates sitting, lying and getting up without snapping or spinning on wrapped headings', () => {
  const between = (a: Motion, b: Motion) =>
    interpolate(
      [
        { t: 0, m: a },
        { t: 1, m: b },
      ],
      0.5,
    )!;
  expect(between(move(), move(seated)).rest?.sitting).toBeCloseTo(0.5);
  expect(between(move(seated), move(lying)).rest).toMatchObject({ sitting: 0.5, lying: 0.5 });
  const rising = between(move(lying), move());
  expect(rising.rest?.lying).toBeCloseTo(0.5);
  expect(Math.abs(rising.rest!.yaw)).toBeCloseTo(Math.PI, 2);
  expect(between(move(), move()).rest).toBeUndefined();
});

it('sends the actual rest blend, then clears it when standing', () => {
  const h = headless();
  const sent: unknown[] = [];
  const connection = {
    welcome: { players: [] },
    closed: null,
    take: () => [],
    send: (m: unknown) => sent.push(m),
  } as unknown as Connection;
  const net = new NetSystem(
    h.ctx,
    connection,
    {} as RemotePlayers,
    { apply: () => {}, flush: () => {}, correct: () => {} },
    () => ({ item: 'rifle', painting: false, aiming: false }),
  );
  Object.assign(h.ctx.player, { restMotion: lying });
  net.update(0.1);
  expect(sent.at(-1)).toMatchObject({ rest: lying });
  Object.assign(h.ctx.player, { restMotion: undefined });
  net.update(0.1);
  expect(sent.at(-1)).not.toHaveProperty('rest');
});

it('draws lower seated and supine heads for every character and restores weapons on standing', () => {
  const material = new THREE.MeshBasicMaterial();
  const figures = new PlayerFigures(new THREE.Group(), material);
  for (const character of CHARACTERS) {
    const look = defaultLook(character.key);
    const standHead = new THREE.Vector3(),
      sitHead = new THREE.Vector3(),
      lieHead = new THREE.Vector3();
    figures.begin();
    figures.draw(look, pose, standHead);
    figures.draw(look, { ...pose, rest: seated }, sitHead);
    figures.draw(look, { ...pose, rest: lying }, lieHead);
    figures.end();
    expect(sitHead.y).toBeLessThan(standHead.y - 0.5);
    expect(lieHead.y).toBeLessThan(sitHead.y - 0.2);
    expect(Math.abs(lieHead.z)).toBeGreaterThan(0.4);
    expect(heldIn({ ...pose, rest: lying })).toBeNull();
    expect(heldIn({ ...pose, rest: seated })).toBeNull();
    expect(heldIn(pose)).toBe('rifle');
  }
  figures.dispose();
  material.dispose();
});
