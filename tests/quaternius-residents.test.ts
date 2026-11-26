import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, expect, it } from 'vitest';
import { kaykitDyeRole, residentDyes } from '@/systems/figures/resident-dyes';
import { PALETTE } from '@/content/palette';
import {
  ResidentFigure,
  type VillagerMotion,
  VILLAGER_MODELS,
  VILLAGER_ROLES,
} from '@/systems/figures/kaykit-villager';
import {
  RESIDENT_MODELS,
  isKayKit,
  modelForResident,
  residentInfo,
  residentMotions,
} from '@/systems/figures/resident-models';

async function readModel(key: string, folder = 'quaternius') {
  const bytes = await readFile(new URL(`../public/models/${folder}/${key}.glb`, import.meta.url));
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
}
let shared: THREE.AnimationClip[];
beforeAll(async () => {
  shared = (await readModel('animated/BaseCharacter')).animations;
});

it.each([
  'rogue',
  'animated/CasualFemale',
  'rpg/Wizard',
  'cube/Character_Female_2',
  'platformer/Character',
] as const)('%s stops working to look at a visitor without accumulating head rotation', async (key) => {
  const source = await readModel(key, isKayKit(key) ? 'kaykit' : 'quaternius');
  if (key.startsWith('animated/')) source.animations = shared;
  const actor = new ResidentFigure(source, 0, residentMotions(key));
  const control = new ResidentFigure(source, 0, residentMotions(key));
  let head: THREE.Bone | undefined;
  actor.model.traverse((o) => {
    if (o instanceof THREE.Bone && /^head$/i.test(o.name)) head = o;
  });
  expect(head).toBeDefined();
  actor.update(0.1, false, 'slash');
  control.update(0.1, false, 'slash');
  for (let frame = 0; frame < 180; frame++) {
    actor.update(1 / 60, true, 'slash', { x: 2, y: 1.7, z: 2 });
    control.update(1 / 60, true, 'slash');
  }
  const controlHead = control.model.getObjectByName(head!.name)!;
  const angle = head!.quaternion.angleTo(controlHead.quaternion);
  expect(angle).toBeGreaterThan(0.1);
  expect(angle).toBeLessThan(0.7);
  expect(
    actor.mixer
      .existingAction(source.animations.find((c) => c.name === residentMotions(key).idle.clip)!)
      ?.getEffectiveWeight(),
  ).toBeCloseTo(1);
  for (let frame = 0; frame < 120; frame++) {
    actor.update(1 / 60, false, 'walk');
    control.update(1 / 60, false, 'walk');
  }
  expect(head!.quaternion.angleTo(controlHead.quaternion)).toBeLessThan(0.001);
  actor.dispose();
  control.dispose();
});

it('gives every resident a reachable model while keeping the occupation of its existing home', () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 500; seed++) {
    const key = modelForResident(seed);
    seen.add(key);
    expect(residentInfo(key).profession).toBe(VILLAGER_ROLES[VILLAGER_MODELS[seed % 5]!].profession);
  }
  expect(seen).toEqual(new Set(RESIDENT_MODELS));
  expect(RESIDENT_MODELS.filter((k) => k.startsWith('animated/'))).toHaveLength(52);
  expect(RESIDENT_MODELS.filter((k) => k.startsWith('rpg/'))).toHaveLength(6);
});

it.each(RESIDENT_MODELS.filter((key) => !isKayKit(key)))(
  '%s has visible pigments and properly fitted, bound native actions',
  async (key) => {
    const source = await readModel(key);
    const animations = key.startsWith('animated/') ? shared : source.animations;
    const motions = residentMotions(key);
    expect(
      Object.values(motions)
        .map((m) => m!.clip)
        .sort(),
    ).toEqual(animations.map((c) => c.name).sort());
    const actor = new ResidentFigure({ ...source, animations }, 0, motions);
    const pigments = new Set<number>();
    actor.model.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const attr = obj.geometry.getAttribute('aColor');
      for (let i = 0; i < attr.count; i++) pigments.add(attr.getX(i));
    });
    expect(pigments.size).toBeGreaterThan(1);
    for (const idx of pigments) expect(PALETTE[idx]).toBeDefined();
    for (const clip of animations) {
      for (const track of clip.tracks) {
        const target = THREE.PropertyBinding.parseTrackName(track.name).nodeName;
        if (!THREE.PropertyBinding.findNode(actor.model, target)) throw Error(`Missing ${target} in ${key}`);
      }
    }
    expect(new THREE.Box3().setFromObject(actor.root, true).min.y).toBeCloseTo(0, 2);
    for (const motion of Object.keys(motions) as VillagerMotion[]) {
      actor.previewMotion(motion, false, 0.5);
      actor.root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(actor.root, true);
      const size = bounds.getSize(new THREE.Vector3());
      expect(size.length(), motion).toBeGreaterThan(0.45);
      expect(size.length(), motion).toBeLessThan(3.6);
      expect(size.y, motion).toBeLessThan(2.4);
    }
    actor.dispose();
  },
);

it.each([
  'cube/Character_Female_2',
  'animated/CasualFemale',
  'rpg/Wizard',
  'platformer/Character',
  'rogue',
] as const)('%s dyes only the marked faces and reproduces the same outfit after unloading', async (key) => {
  const source = await readModel(key, isKayKit(key) ? 'kaykit' : 'quaternius');
  if (key.startsWith('animated/')) source.animations = shared;
  const sample = (seed?: number) => {
    const actor = new ResidentFigure(source, 0, residentMotions(key), seed);
    const values: number[] = [],
      fixed: number[] = [],
      hair: number[] = [];
    actor.model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const a = o.geometry.attributes;
      for (let i = 0; i < a.aColor!.count; i++) {
        const tile = a._swatch?.getX(i);
        const role = tile === undefined ? (a._inkdye?.getX(i) ?? 0) : kaykitDyeRole(o.name, tile);
        const pigment = a.aColor!.getX(i);
        values.push(pigment);
        if (!role) fixed.push(pigment - a._inkcolor!.getX(i));
        if (role === 3) hair.push(pigment);
      }
    });
    actor.dispose();
    return { values, fixed, hair };
  };
  const original = sample(),
    first = sample(0),
    second = sample(1);
  expect(first.values).not.toEqual(second.values);
  expect(first.values).not.toEqual(original.values);
  expect(new Set(first.fixed)).toEqual(new Set([0]));
  if (key === 'cube/Character_Female_2' || key === 'animated/CasualFemale' || key === 'rogue') {
    expect(new Set(first.hair)).toEqual(new Set([residentDyes(0)[3]]));
  }
  expect(sample(0).values).toEqual(first.values);
  expect(sample().values).toEqual(original.values);
});

it('returns to routine animation after a held combat or down pose', async () => {
  const { NpcFighter, NpcBattles } = await import('@/systems/combat/npc-combat');
  const { PhysicsWorld } = await import('@/engine/physics/world');
  const source = await readModel('rogue', 'kaykit');
  const actor = new ResidentFigure(source);
  const fighter = new NpcFighter(new NpcBattles(), new PhysicsWorld(), actor.root.position);
  fighter.swing = 0.2;
  for (let i = 0; i < 90; i++) actor.combatPose(1 / 60, fighter);
  for (let i = 0; i < 30; i++) actor.update(1 / 60, false, 'idle');
  expect(
    actor.mixer.existingAction(source.animations.find((c) => c.name === 'Idle')!)?.getEffectiveWeight(),
  ).toBeCloseTo(1);
  fighter.damage(1000);
  actor.combatPose(0.2, fighter);
  for (let i = 0; i < 30; i++) actor.update(1 / 60, false, 'walk');
  expect(actor.root.rotation.z).toBe(0);
  expect(
    actor.mixer.existingAction(source.animations.find((c) => c.name === 'Walking_A')!)?.getEffectiveWeight(),
  ).toBeCloseTo(1);
  fighter.dispose();
  actor.dispose();
});
