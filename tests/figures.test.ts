import { WILD_MODELS } from '@/content/wild-models';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { CHARACTERS, defaultLook } from '@/content/characters';
import { ENEMIES, type EnemyDef, enemyIndex } from '@/content/enemies';
import { color } from '@/content/palette';
import { MonsterFigures, type Pose, monsterRig, posedTop } from '@/systems/combat/monster-figure';
import { InkAnimal } from '@/systems/combat/ink-animal';
import { rigTop } from '@/systems/figures/figure';
import { PlayerFigures, type PlayerPose, characterRig, posePlayer } from '@/systems/figures/player-figure';
import { HELD_ITEMS } from '@/world/net/protocol';

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

describe('player figures: what they hold', () => {
  const world = (o: THREE.Object3D, local?: THREE.Vector3): THREE.Vector3 => {
    o.updateWorldMatrix(true, false);
    return local ? o.localToWorld(local.clone()) : new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  };

  it('the prop sits in the main hand, and two-handed things in both, through every action', () => {
    for (const c of CHARACTERS) {
      const r = characterRig(c.key);
      for (const held of HELD_ITEMS)
        for (const kind of ['attack', 'skill'] as const)
          for (const t of [0, 0.2, 0.35, 0.5, 0.8]) {
            posePlayer(r, { ...standing, stride: 1, walk: t * 4, held, action: { kind, t }, paint: 1 });
            const prop = r.props[held];
            expect(world(r.palmR).distanceTo(world(prop.node))).toBeLessThan(0.01);
            // the other hand may fall a little short at full stretch, never far
            if (prop.off) expect(world(r.palmL).distanceTo(world(prop.node, prop.off))).toBeLessThan(0.06);
          }
    }
  });

  it("the katana's slash sweeps the blade from the right shoulder across the body", () => {
    const r = characterRig('courier');
    const tip = (t: number): THREE.Vector3 => {
      posePlayer(r, { ...standing, held: 'katana', action: { kind: 'attack', t } });
      return world(r.props.katana.node, r.props.katana.tip);
    };
    const rest = tip(0);
    const up = tip(0.2);
    const through = tip(0.45);
    // figures face -z, so their right is +x: raised on the right, cut through to the left
    expect(up.y).toBeGreaterThan(rest.y + 0.3);
    expect(up.x).toBeGreaterThan(0.2);
    expect(through.x).toBeLessThan(-0.4);
    expect(through.y).toBeLessThan(up.y - 0.6);
    // and back to rest at the end
    expect(tip(1).distanceTo(rest)).toBeLessThan(1e-6);
  });

  it('a gun kicks back toward the body when it fires', () => {
    const r = characterRig('ranger');
    const muzzle = (t: number): THREE.Vector3 => {
      posePlayer(r, { ...standing, held: 'rifle', aim: 1, action: t < 0 ? null : { kind: 'attack', t } });
      return world(r.props.rifle.node, r.props.rifle.tip);
    };
    const sighted = muzzle(-1);
    const kicked = muzzle(0.12);
    expect(kicked.z).toBeGreaterThan(sighted.z + 0.03);
    expect(kicked.y).toBeGreaterThan(sighted.y);
  });

  it('draws the held weapon with the figure (its model, one instance), and none while gliding', () => {
    const count = (p: PlayerPose): number => {
      const parent = new THREE.Group();
      const figures = new PlayerFigures(parent, new THREE.MeshBasicMaterial());
      figures.begin();
      figures.draw(defaultLook('mason'), p);
      figures.end();
      return parent.children.reduce((n, m) => n + (m as THREE.InstancedMesh).count, 0);
    };
    const bare = count(standing);
    expect(count({ ...standing, held: 'staff' })).toBe(bare + 1);
    expect(count({ ...standing, held: 'staff', glide: true })).toBe(bare);
    // the brush is still soft parts on the figure
    const r = characterRig('mason');
    expect(count({ ...standing, held: 'brush' })).toBe(bare + r.props.brush.parts.length);
  });
});

describe('monster figures', () => {
  it('poses the imported frog at its collision height, jumps, attacks and melts in place', async () => {
    const bytes = await readFile(new URL('../public/models/quaternius/ink-frog.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
    const material = new THREE.MeshBasicMaterial();
    const frog = new InkAnimal('frog', gltf, material);
    const height = ENEMIES[enemyIndex('frog')]!.height;
    const at = { ...rest, x: 37, y: 2, z: -18 };
    const bounds = (pose: Pose) => {
      frog.pose(pose, height);
      frog.root.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(frog.root, true);
    };
    const idle = bounds(at);
    expect(idle.min.y).toBeCloseTo(at.y, 2);
    expect(idle.max.y).toBeCloseTo(at.y + height, 2);
    expect(idle.getCenter(new THREE.Vector3()).x).toBeCloseTo(at.x, 1);
    expect(bounds({ ...at, stride: 1, walk: Math.PI }).max.y).toBeGreaterThan(idle.max.y);
    expect(bounds({ ...at, attack: 0.75 }).min.z).toBeLessThan(idle.min.z);
    expect(bounds({ ...at, dying: 1 }).max.y).toBeLessThan(at.y + height * 0.2);
    expect(bounds(at).max.y).toBeCloseTo(idle.max.y, 4);
    frog.dispose();
    material.dispose();
  });

  it.each([
    'rat',
    'snake',
    'snake-angry',
    'spider',
    'wasp',
    'star-mote',
    'star-orb',
    'star-wing',
    'star-brute',
    ...WILD_MODELS.map((m) => m.key),
  ] as const)('fits and animates the imported %s through combat', async (key) => {
    const file = key.includes('/') ? `wild/${key}` : `quaternius/ink-${key}`;
    const bytes = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
    const material = new THREE.MeshBasicMaterial();
    const actor = new InkAnimal(key, gltf, material);
    const height = ENEMIES[enemyIndex(key)]!.height;
    const bounds = (pose: Pose) => {
      actor.pose(pose, height);
      actor.root.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(actor.root, true);
    };
    const at = { ...rest, x: 64, y: 3, z: -11 };
    const idle = bounds(at);
    expect(idle.max.y).toBeCloseTo(at.y + height, 3);
    expect(idle.min.y).toBeCloseTo(
      at.y + (gltf.animations.some((c) => /(?:^|_)Flying$/.test(c.name)) ? height * 0.27 : 0),
      3,
    );
    const def: EnemyDef = ENEMIES[enemyIndex(key)]!;
    if (def.halfLength) {
      const span = idle.getSize(new THREE.Vector3());
      expect(span.z).toBeGreaterThan(span.y * 1.6);
      expect(span.x).toBeLessThan(span.y);
      expect(span.z / 2).toBeCloseTo(def.halfLength, 0);
    }
    for (const pose of [
      { stride: 1, walk: 1.7 },
      { air: true },
      { attack: 0.6 },
      { hurt: 0.7 },
      { dying: 0.5 },
    ]) {
      const box = bounds({ ...at, ...pose });
      expect(box.getSize(new THREE.Vector3()).length()).toBeLessThan(
        def.halfLength ? idle.getSize(new THREE.Vector3()).length() * 1.35 : 5,
      );
    }
    expect(bounds({ ...at, dying: 1 }).max.y).toBeLessThan(at.y + height * 0.2);
    expect(bounds(at).max.y).toBeCloseTo(idle.max.y, 4);
    actor.dispose();
    material.dispose();
  });

  for (const def of ENEMIES)
    it(`${def.name} is drawn at its collision height`, () => {
      // within a few percent: the big ones are drawn at the same proportions as the small
      expect(posedTop(monsterRig(def), rest) / def.height).toBeCloseTo(1, 1);
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
