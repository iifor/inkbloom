import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { characterMaterial, enableCharacterPaint } from '@/engine/render/character-paint';
import { color } from '@/content/palette';

export const VILLAGER_MODELS = ['rogue', 'mage', 'barbarian', 'knight', 'rogue-hooded'] as const;
export type VillagerModel = (typeof VILLAGER_MODELS)[number];
export const VILLAGER_MOTIONS = {
  idle: { label: '待机', clip: 'Idle' },
  walk: { label: '行走', clip: 'Walking_A' },
  run: { label: '奔跑', clip: 'Running_A' },
  jump: { label: '跳跃', clip: 'Jump_Full_Short' },
  interact: { label: '招呼', clip: 'Interact' },
  slash: { label: '挥动', clip: '1H_Melee_Attack_Chop' },
  shoot: { label: '瞄准动作', clip: '1H_Ranged_Shoot' },
  cheer: { label: '欢呼', clip: 'Cheer' },
} as const;
export type VillagerMotion = keyof typeof VILLAGER_MOTIONS;
export const VILLAGER_ROLES: Record<VillagerModel, { title: string; profession: string | null }> = {
  rogue: { title: '村民', profession: null },
  'rogue-hooded': { title: '村民', profession: null },
  knight: { title: '守卫', profession: 'guard' },
  barbarian: { title: '伐木工', profession: 'woodcutter' },
  mage: { title: '法师', profession: 'mage' },
};
const pending = new Map<VillagerModel, Promise<GLTF>>();

export function loadVillager(key: VillagerModel): Promise<GLTF> {
  let request = pending.get(key);
  if (!request) {
    request = new GLTFLoader()
      .loadAsync(`${import.meta.env.BASE_URL}models/kaykit/${key}.glb`)
      .catch((error) => {
        pending.delete(key);
        throw error;
      });
    pending.set(key, request);
  }
  return request;
}

/** Authored KayKit proportions and animations, shaded by the same paint pass as the village. */
export class KayKitVillager {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  private readonly material = makeInkMaterial({ cloth: true });
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction;
  private close = false;
  private greetingCooldown = 0;
  private preview = false;

  constructor(source: Pick<GLTF, 'scene' | 'animations'>, phase = 0) {
    enableCharacterPaint(this.material);
    this.model = clone(source.scene);
    this.root.name = 'kaykit-villager';
    this.root.add(this.model);
    this.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry = object.geometry.clone();
      const count = object.geometry.getAttribute('position').count;
      const pigment = object.geometry.getAttribute('_inkcolor');
      if (!pigment) throw new Error('KayKit model is missing baked palette colors');
      object.geometry.setAttribute('aColor', pigment);
      const surface = new Float32Array(count);
      const swatch = object.geometry.getAttribute('_swatch');
      const head = /_Head(?:_Hooded)?$/.test(object.name);
      for (let i = 0; i < count; i++) {
        const index = pigment.getX(i);
        const hair = head && swatch.getX(i) === 1;
        const leather = index === color('brown') || index === color('bark');
        surface[i] = characterMaterial(hair ? 'hair' : leather ? 'brown' : '', index);
      }
      object.geometry.setAttribute('aCharacterMaterial', new THREE.Float32BufferAttribute(surface, 1));
      object.geometry.setAttribute(
        'aSurface',
        new THREE.Float32BufferAttribute(new Float32Array(count).fill(-2), 1),
      );
      object.geometry.setAttribute('aPane', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
      object.material = this.material;
      object.frustumCulled = false;
    });
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const { clip: name } of Object.values(VILLAGER_MOTIONS)) {
      const clip = source.animations.find((a) => a.name === name);
      if (!clip) throw new Error(`KayKit model is missing ${name}`);
      const action = this.mixer.clipAction(clip);
      if (name !== 'Idle') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(name, action);
    }
    this.current = this.actions.get('Idle')!;
    this.current.play();
    this.mixer.update(phase % this.current.getClip().duration);
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model, true);
    const scale = 1.65 / (box.max.y - box.min.y);
    this.model.scale.multiplyScalar(scale);
    this.model.position.y -= box.min.y * scale;
    this.mixer.addEventListener('finished', () => {
      if (!this.preview) this.play('Idle');
    });
  }

  private play(name: string): void {
    const next = this.actions.get(name)!;
    if (this.current === next) return;
    next.reset().setEffectiveWeight(1).play();
    this.current.crossFadeTo(next, 0.25, false);
    this.current = next;
  }

  celebrate(): void {
    this.play('Cheer');
  }

  previewMotion(motion: VillagerMotion, firstPerson: boolean, dt: number): void {
    this.preview = true;
    const name = VILLAGER_MOTIONS[motion].clip;
    this.actions.get(name)!.setLoop(THREE.LoopRepeat, Infinity);
    this.play(name);
    this.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // Retain the original arms, hands and bone-attached profession equipment.
      object.visible = !firstPerson || /_Arm(Left|Right)$|^(1H_|2H_|Badge_)/.test(object.name);
    });
    this.mixer.update(dt);
  }

  update(dt: number, close: boolean): void {
    this.greetingCooldown = Math.max(0, this.greetingCooldown - dt);
    if (close && !this.close && this.greetingCooldown === 0) {
      this.play('Interact');
      this.greetingCooldown = 8;
    }
    this.close = close;
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.root.removeFromParent();
    const skeletons = new Set<THREE.Skeleton>();
    this.model.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    });
    for (const skeleton of skeletons) skeleton.dispose();
    this.material.dispose();
  }
}
