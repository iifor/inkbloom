import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { characterMaterial, enableCharacterPaint } from '@/engine/render/character-paint';
import type { Occupation, ResidentMotion } from '@/world/city/resident-routine';
import { color } from '@/content/palette';
import type { NpcFighter } from '@/systems/combat/npc-combat';
import { kaykitDyeRole, residentDyes } from './resident-dyes';

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
export type VillagerMotion = keyof typeof VILLAGER_MOTIONS | `native-${string}`;
type Motion = { readonly clip: string; readonly label: string };
export type ResidentMotions = Record<ResidentMotion, Motion> & Partial<Record<VillagerMotion, Motion>>;
export const VILLAGER_ROLES: Record<
  VillagerModel,
  { title: string; profession: Exclude<Occupation, 'villager'> | null }
> = {
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

/** Per-resident skeleton and mixer, shaded by the same paint pass as the village. */
export class ResidentFigure {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  private readonly material = makeInkMaterial({ cloth: true });
  private readonly clips: Map<string, THREE.AnimationClip>;
  private current: THREE.AnimationAction;
  private preview = false;
  private head?: THREE.Bone;
  private readonly headBase = new THREE.Quaternion();
  private gazeApplied = false;
  private gazeYaw = 0;
  private gazePitch = 0;
  private readonly headAt = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly parentRotation = new THREE.Quaternion();
  private readonly gazeRotation = new THREE.Quaternion();
  private readonly pitchRotation = new THREE.Quaternion();

  constructor(
    source: Pick<GLTF, 'scene' | 'animations'>,
    phase = 0,
    private readonly motions: ResidentMotions = VILLAGER_MOTIONS,
    identitySeed?: number,
  ) {
    enableCharacterPaint(this.material);
    const dyes = identitySeed === undefined ? undefined : residentDyes(identitySeed);
    this.model = clone(source.scene);
    this.root.name = this.motions === VILLAGER_MOTIONS ? 'kaykit-villager' : 'quaternius-villager';
    this.root.add(this.model);
    this.model.traverse((object) => {
      if (object instanceof THREE.Bone && /^head$/i.test(object.name)) this.head = object;
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry = object.geometry.clone();
      const count = object.geometry.getAttribute('position').count;
      const pigment = object.geometry.getAttribute('_inkcolor');
      if (!pigment) throw new Error('Resident model is missing baked palette colors');
      const mask = object.geometry.getAttribute('_inkdye');
      const surface = new Float32Array(count);
      const swatch = object.geometry.getAttribute('_swatch');
      const tiles = swatch ? Array.from({ length: 32 }, (_, tile) => kaykitDyeRole(object.name, tile)) : null;
      const dyed = dyes && (mask || tiles) ? new Float32Array(count) : null;
      for (let i = 0; i < count; i++) {
        const index = pigment.getX(i);
        const role = mask?.getX(i) ?? (tiles ? tiles[swatch!.getX(i)]! : 0);
        if (dyed) dyed[i] = role ? dyes![role]! : index;
        const hair = role === 3;
        const leather = index === color('brown') || index === color('bark');
        surface[i] = hair ? 3 : dyed && role ? 0 : characterMaterial(leather ? 'brown' : '', index);
      }
      object.geometry.setAttribute('aColor', dyed ? new THREE.Float32BufferAttribute(dyed, 1) : pigment);
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
    this.clips = new Map(source.animations.map((clip) => [clip.name, clip]));
    this.current = this.action('Idle');
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

  private action(name: string): THREE.AnimationAction {
    const clip = this.clips.get(name);
    if (!clip) throw new Error(`Resident model is missing ${name}`);
    const existing = this.mixer.existingAction(clip);
    if (existing) return existing;
    const action = this.mixer.clipAction(clip);
    if (name !== 'Idle' && name !== this.motions.walk.clip) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    return action;
  }

  private play(name: string): void {
    const next = this.action(name);
    if (this.current === next) return;
    next.reset().setEffectiveWeight(1).play();
    this.current.crossFadeTo(next, 0.25, false);
    this.current = next;
  }

  celebrate(): void {
    this.play(this.motions.cheer?.clip ?? this.motions.interact.clip);
  }

  combatPose(dt: number, fighter: NpcFighter): void {
    this.resetGaze();
    this.preview = true; // Hold a completed down animation instead of returning to idle.
    const names =
      fighter.down > 0
        ? ['Death', 'Death_A', 'Defeat']
        : fighter.hurt > 0
          ? ['Hit_React', 'RecieveHit', 'Hit_A']
          : fighter.swing >= 0
            ? ['Punch', this.motions.slash?.clip ?? '', '1H_Melee_Attack_Chop']
            : [fighter.approachHeading !== undefined ? this.motions.walk.clip : this.motions.idle.clip];
    this.play(names.find((name) => this.clips.has(name)) ?? this.motions.idle.clip);
    this.mixer.update(dt);
    if (!names.some((name) => this.clips.has(name)) && fighter.down > 0) this.root.rotation.z = Math.PI / 2;
    else this.root.rotation.z = 0;
  }

  previewMotion(motion: VillagerMotion, firstPerson: boolean, dt: number): void {
    this.resetGaze();
    this.preview = true;
    const name = this.motions[motion]!.clip;
    this.action(name).setLoop(THREE.LoopRepeat, Infinity);
    this.play(name);
    this.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // Retain the original arms, hands and bone-attached profession equipment.
      object.visible = !firstPerson || /_Arm(Left|Right)$|^(1H_|2H_|Badge_)/.test(object.name);
    });
    this.mixer.update(dt);
  }

  update(
    dt: number,
    close: boolean,
    motion: ResidentMotion = 'idle',
    lookAt?: { x: number; y: number; z: number },
  ): void {
    if (this.preview) this.play(this.motions.idle.clip);
    this.preview = false;
    this.root.rotation.z = 0;
    this.resetGaze();
    if (close) this.play(this.motions.idle.clip);
    else if (motion === 'walk') this.play(this.motions.walk.clip);
    else if (
      this.current.getClip().name === 'Idle' ||
      this.current.getClip().name === this.motions.walk.clip
    ) {
      this.play(this.motions[motion]!.clip);
    }
    this.mixer.update(dt);
    this.applyGaze(dt, lookAt);
  }

  private resetGaze(): void {
    // Restore the animated pose before the mixer, also for rigs without a head track.
    if (this.gazeApplied && this.head) this.head.quaternion.copy(this.headBase);
    this.gazeApplied = false;
  }

  private applyGaze(dt: number, target?: { x: number; y: number; z: number }): void {
    if (!this.head?.parent) return;
    if (!target && Math.abs(this.gazeYaw) + Math.abs(this.gazePitch) < 0.0001) return;
    this.head.getWorldPosition(this.headAt);
    const bodyYaw = this.root.rotation.y;
    let yaw = 0,
      pitch = 0;
    if (target) {
      const dx = target.x - this.headAt.x,
        dz = target.z - this.headAt.z;
      const difference = Math.atan2(dx, dz) - bodyYaw;
      yaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(difference), Math.cos(difference)), -0.5, 0.5);
      pitch = THREE.MathUtils.clamp(Math.atan2(target.y - this.headAt.y, Math.hypot(dx, dz)), -0.35, 0.3);
    }
    const ease = 1 - Math.exp(-9 * dt);
    this.gazeYaw += (yaw - this.gazeYaw) * ease;
    this.gazePitch += (pitch - this.gazePitch) * ease;
    if (Math.abs(this.gazeYaw) + Math.abs(this.gazePitch) < 0.0001) return;
    this.headBase.copy(this.head.quaternion);
    this.head.parent.getWorldQuaternion(this.parentRotation);
    this.right.set(Math.cos(bodyYaw), 0, -Math.sin(bodyYaw));
    this.gazeRotation.setFromAxisAngle(this.up, this.gazeYaw);
    this.pitchRotation.setFromAxisAngle(this.right, -this.gazePitch);
    this.gazeRotation.multiply(this.pitchRotation);
    // Convert a world-space adjustment into the bone parent's axes (rigs differ).
    this.pitchRotation
      .copy(this.parentRotation)
      .invert()
      .multiply(this.gazeRotation)
      .multiply(this.parentRotation);
    this.head.quaternion.copy(this.pitchRotation).multiply(this.headBase);
    this.gazeApplied = true;
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

export { ResidentFigure as KayKitVillager };
