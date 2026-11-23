import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { PALETTE } from '@/content/palette';
import {
  KayKitVillager,
  VILLAGER_MODELS,
  VILLAGER_ROLES,
  VILLAGER_MOTIONS,
} from '@/systems/figures/kaykit-villager';

const equipment: Record<string, string[]> = {
  knight: ['1H_Sword', 'Badge_Shield'],
  barbarian: ['1H_Axe'],
  mage: ['2H_Staff'],
};
describe.each(VILLAGER_MODELS)('KayKit %s resident', (key) => {
  let source: GLTF;
  beforeAll(async () => {
    const bytes = await readFile(new URL(`../public/models/kaykit/${key}.glb`, import.meta.url));
    source = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
  });
  it('keeps only role equipment, flat palette colors and authored preview animations', () => {
    expect(source.animations.map((a) => a.name).sort()).toEqual(
      Object.values(VILLAGER_MOTIONS)
        .map((m) => m.clip)
        .sort(),
    );
    const handheld: string[] = [];
    const paletteBySwatch = new Map<number, number>();
    source.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (!(o instanceof THREE.SkinnedMesh) && !/_(Hat|Helmet|Cape)$/.test(o.name)) handheld.push(o.name);
      const colors = o.geometry.getAttribute('_inkcolor');
      expect(colors.count).toBe(o.geometry.getAttribute('position').count);
      for (let i = 0; i < colors.count; i++) {
        expect(Number.isInteger(colors.getX(i))).toBe(true);
        expect(colors.getX(i)).toBeGreaterThanOrEqual(0);
        expect(colors.getX(i)).toBeLessThan(PALETTE.length);
      }
      for (let i = 0; i < colors.count; i += 3) {
        const tile = o.geometry.getAttribute('_swatch').getX(i);
        if (!paletteBySwatch.has(tile)) paletteBySwatch.set(tile, colors.getX(i));
        expect(colors.getX(i)).toBe(paletteBySwatch.get(tile));
        expect(colors.getX(i)).toBe(colors.getX(i + 1));
        expect(colors.getX(i)).toBe(colors.getX(i + 2));
      }
    });
    expect(handheld.sort()).toEqual((equipment[key] ?? []).sort());
    expect(Boolean(VILLAGER_ROLES[key].profession)).toBe(handheld.length > 0);
  });
  it('animates independently, returns to idle after greeting and releases its instance', () => {
    const actor = new KayKitVillager(source),
      other = new KayKitVillager(source, 0.7);
    const parent = new THREE.Group();
    parent.add(actor.root);
    const before = new THREE.Box3().setFromObject(actor.root, true);
    expect(before.max.y - before.min.y).toBeCloseTo(1.65, 2);
    expect(Math.abs(before.min.y)).toBeLessThan(0.02);
    actor.update(0.2, true);
    actor.celebrate();
    for (let i = 0; i < 180; i++) {
      actor.update(1 / 30, false);
      actor.root.updateMatrixWorld(true);
      actor.model.traverse((o) => {
        if (!(o instanceof THREE.SkinnedMesh)) return;
        expect(o.skeleton).not.toBe((other.model.getObjectByName(o.name) as THREE.SkinnedMesh).skeleton);
        for (let n = 0; n < o.geometry.getAttribute('position').count; n += 93)
          expect(o.getVertexPosition(n, new THREE.Vector3()).toArray().every(Number.isFinite)).toBe(true);
      });
    }
    expect((actor as unknown as { current: THREE.AnimationAction }).current.getClip().name).toBe('Idle');
    actor.dispose();
    expect(parent.children).toHaveLength(0);
    other.dispose();
  });
  it('previews native motions in both views and restores the complete body', () => {
    const actor = new KayKitVillager(source);
    for (const motion of Object.keys(VILLAGER_MOTIONS) as (keyof typeof VILLAGER_MOTIONS)[]) {
      actor.previewMotion(motion, true, 0.3);
      let arms = 0;
      actor.model.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        if (/_Arm(Left|Right)$/.test(o.name)) {
          expect(o.visible).toBe(true);
          arms++;
        }
        if (/_Head$|_Body$|_Leg(Left|Right)$/.test(o.name)) expect(o.visible).toBe(false);
      });
      expect(arms).toBe(2);
      actor.previewMotion(motion, false, 0.3);
      actor.model.traverse((o) => {
        if (o instanceof THREE.Mesh) expect(o.visible).toBe(true);
      });
    }
    actor.dispose();
  });
});
