import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHARACTERS, defaultLook } from '@/content/characters';
import { ENEMIES } from '@/content/enemies';
import { color } from '@/content/palette';
import { MonsterFigures, type Pose, monsterRig, posedTop } from '@/systems/combat/monster-figure';
import { rigTop } from '@/systems/figures/figure';
import { PlayerFigures, type PlayerPose, characterRig } from '@/systems/figures/player-figure';

const rest: Pose = {
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  walk: 0,
  stride: 0,
  attack: -1,
  hurt: 0,
  air: false,
  dying: -1,
  t: 0,
  colors: [color('red')],
};

const standing: PlayerPose = {
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
};

describe('player figures', () => {
  // design: every character fits the shared hit box (head centred at 1.62 m) and stands 1.75–1.85 m
  for (const c of CHARACTERS)
    it(`${c.name} fits the shared hit box`, () => {
      const r = characterRig(c.key);
      const top = rigTop(r.root, r.parts);
      // hats and hoods stick up a little; the head itself must not
      expect(top).toBeGreaterThan(1.75);
      expect(top).toBeLessThan(2.05);
      const head = new THREE.Vector3().setFromMatrixPosition(r.head.matrixWorld);
      expect(head.y + 0.15).toBeCloseTo(1.62, 1);
    });

  it('draws every part of every figure, growing past the first batch', () => {
    const parent = new THREE.Group();
    const figures = new PlayerFigures(parent, new THREE.MeshBasicMaterial());
    const parts = CHARACTERS.reduce((n, c) => n + characterRig(c.key).parts.length, 0);
    figures.begin();
    for (let i = 0; i < 10; i++)
      for (const c of CHARACTERS) figures.draw(defaultLook(c.key), { ...standing, x: i });
    figures.end();
    const drawn = parent.children.reduce((n, m) => n + (m as THREE.InstancedMesh).count, 0);
    expect(drawn).toBe(parts * 10);
  });
});

describe('monster figures', () => {
  for (const def of ENEMIES)
    it(`${def.name} is drawn at its collision height`, () => {
      expect(posedTop(monsterRig(def), rest)).toBeCloseTo(def.height, 1);
    });

  it('墨团 stretches up and raises its arms to strike, its hit box unchanged', () => {
    const def = ENEMIES[0]!;
    const r = monsterRig(def);
    const atRest = posedTop(r, rest);
    expect(posedTop(r, { ...rest, attack: 0.55 })).toBeGreaterThan(atRest * 1.25);
    expect(def.height).toBe(1.2);
  });

  it('draws a group of monsters', () => {
    const parent = new THREE.Group();
    const figures = new MonsterFigures(parent, new THREE.MeshBasicMaterial());
    figures.begin();
    for (const def of ENEMIES) figures.draw(def, rest);
    figures.end();
    const drawn = parent.children.reduce((n, m) => n + (m as THREE.InstancedMesh).count, 0);
    expect(drawn).toBe(ENEMIES.reduce((n, d) => n + monsterRig(d).parts.length, 0));
  });
});

describe('monster hit flash', () => {
  it('draws the whole ink body in the stolen colour for a blink', () => {
    const colours = (flash: boolean): number[] => {
      const parent = new THREE.Group();
      const figures = new MonsterFigures(parent, new THREE.MeshBasicMaterial());
      figures.begin();
      figures.draw(ENEMIES[0]!, { ...rest, colors: [color('red')], flash });
      figures.end();
      return parent.children.flatMap((m) => {
        const mesh = m as THREE.InstancedMesh;
        return Array.from({ length: mesh.count }, (_, i) => mesh.instanceColor!.getX(i));
      });
    };
    expect(colours(false)).toContain(color('ink'));
    expect(colours(true)).not.toContain(color('ink'));
    expect(new Set(colours(true))).toEqual(new Set([color('red')]));
  });
});
