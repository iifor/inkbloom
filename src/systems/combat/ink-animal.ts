import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { WILD_MODELS, type WildModelKey } from '@/content/wild-models';
import { color } from '@/content/palette';
import { ALWAYS_COLOR } from '@/engine/render/geometry-builder';
import type { Pose } from './monster-figure';

const INK = color('ink');
const animalKeys = [
  'frog',
  'rat',
  'snake',
  'snake-angry',
  'spider',
  'wasp',
  'star-mote',
  'star-orb',
  'star-wing',
  'star-brute',
] as const;
const countryAnimals = ['Fox', 'Cow', 'Donkey', 'Horse'] as const;
type CountryAnimal = (typeof countryAnimals)[number];
const countryKeys = new Set<string>(countryAnimals);
export type InkAnimalKey = (typeof animalKeys)[number] | WildModelKey | CountryAnimal;
const imported = new Set<string>(WILD_MODELS.map((m) => m.key));
export function isInkAnimal(key: string): key is InkAnimalKey {
  return imported.has(key) || animalKeys.some((k) => k === key);
}
const templates = new Map<InkAnimalKey, GLTF>();
const retryAt = new Map<InkAnimalKey, number>();

export function animalTemplate(key: InkAnimalKey): GLTF | undefined {
  const source = templates.get(key);
  if (!source && typeof window !== 'undefined' && performance.now() >= (retryAt.get(key) ?? 0)) {
    retryAt.set(key, Infinity);
    const file = countryKeys.has(key)
      ? `countryside/${key}.glb`
      : imported.has(key)
        ? `wild/${key}.glb`
        : `quaternius/ink-${key}.glb`;
    void new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/${file}`).then(
      (gltf) => templates.set(key, gltf),
      () => retryAt.set(key, performance.now() + 15000),
    );
  }
  return source;
}

export class InkAnimal {
  private readonly restHeight: number;
  private readonly floor: number;
  private readonly moving: string;
  private readonly airborne: boolean;
  private readonly idle: string;
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;
  private lastPoseTime?: number;
  private readonly surfaces: {
    mesh: THREE.Mesh;
    original?: Float32Array;
    flash?: number;
    paint: 'ink' | 'primary' | 'secondary' | 'eye';
    pigment: THREE.BufferAttribute;
  }[] = [];

  constructor(
    private readonly key: InkAnimalKey,
    gltf: Pick<GLTF, 'scene' | 'animations'>,
    material: THREE.Material,
    appearance?: { slots?: Readonly<Record<string, number>>; tint?: { from: number; to: number } },
  ) {
    const model = clone(gltf.scene);
    this.root.name = `ink-${key}`;
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      const divider = countryKeys.has(key) ? '|' : '_';
      this.actions.set(clip.name.slice(clip.name.lastIndexOf(divider) + 1), this.mixer.clipAction(clip));
    }
    this.airborne = this.actions.has('Flying');
    this.idle = this.actions.has('Idle') ? 'Idle' : 'Flying';
    this.moving = ['Run', 'Walk', 'Jump', 'Flying'].find((name) => this.actions.has(name))!;
    this.current = this.actions.get(this.idle)!;
    this.current.play();
    this.mixer.update(0);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model, true);
    this.floor = bounds.min.y;
    this.restHeight = bounds.max.y - bounds.min.y;
    // These imports have an offset root. Centre the rest pose on the collision body.
    if (this.airborne || key === 'star-brute' || imported.has(key) || countryKeys.has(key)) {
      const center = bounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
    }
    model.traverse((mesh) => {
      if (!(mesh instanceof THREE.Mesh)) return;
      const slot = mesh.material.name;
      mesh.geometry = mesh.geometry.clone();
      const count = mesh.geometry.getAttribute('position').count;
      const pigment = new THREE.BufferAttribute(new Float32Array(count).fill(-1), 1);
      mesh.geometry.setAttribute('aColor', pigment);
      mesh.geometry.setAttribute(
        'aSurface',
        new THREE.BufferAttribute(new Float32Array(count).fill(countryKeys.has(key) ? -1 : ALWAYS_COLOR), 1),
      );
      mesh.geometry.setAttribute('aPane', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
      mesh.material = material;
      mesh.frustumCulled = false;
      const paint = ['Yellow', 'Pink', 'LightGreen', 'Material.001', 'Marker'].includes(slot)
        ? 'primary'
        : ['Red', 'LightBlue', 'Orange', 'Teeth'].includes(slot)
          ? 'secondary'
          : slot === 'EyeWhite'
            ? 'eye'
            : 'ink';
      const baked = mesh.geometry.getAttribute('_inkcolor');
      const tint = appearance?.tint,
        solid = appearance?.slots?.[slot];
      const original = baked
        ? Float32Array.from({ length: count }, (_, i) => {
            const value = baked.getX(i);
            return tint && value === tint.from ? tint.to : value;
          })
        : solid !== undefined
          ? new Float32Array(count).fill(solid)
          : undefined;
      if (original) pigment.array.set(original);
      this.surfaces.push({ mesh, paint, pigment, original });
    });
  }

  pose(p: Pose, height: number): void {
    let clip = this.idle;
    let phase = p.t / (this.idle === 'Flying' ? 0.45 : 2.5);
    if (p.dying >= 0) {
      clip = this.actions.has('Death') ? 'Death' : this.idle;
      phase = p.dying;
    } else if (p.hurt > 0 && this.actions.has('Hit')) {
      clip = 'Hit';
      phase = 1 - Math.min(1, p.hurt);
    } else if (p.attack >= 0) {
      clip = this.actions.has('Attack') ? 'Attack' : this.idle;
      phase = p.attack;
    } else if (p.stride > 0.1 || p.air) {
      clip = p.air && this.actions.has('Jump') ? 'Jump' : this.moving;
      phase = clip === 'Flying' ? p.t / 0.45 : p.walk / (2 * Math.PI);
    }
    if (countryKeys.has(this.key)) {
      const gait =
        p.stride > 1.8
          ? 'Gallop'
          : p.stride > 0.1
            ? 'Walk'
            : this.key !== 'Fox' && p.t % 15 < 6
              ? 'Eating'
              : 'Idle';
      const next = this.actions.get(gait)!;
      if (next !== this.current) {
        next.reset().fadeIn(0.28).play();
        this.current?.fadeOut(0.28);
        this.current = next;
      }
      next.timeScale =
        p.stride > 0.1 ? THREE.MathUtils.clamp(p.stride / (gait === 'Gallop' ? 3.5 : 0.95), 0.55, 1.5) : 0.85;
      this.mixer.update(Math.max(0, Math.min(0.2, p.t - (this.lastPoseTime ?? p.t))));
      this.lastPoseTime = p.t;
    } else {
      const action = this.actions.get(clip)!;
      if (action !== this.current) {
        this.current?.stop();
        action.play();
        this.current = action;
      }
      const fraction =
        clip === 'Attack' || clip === 'Death' || clip === 'Hit' ? Math.min(0.99999, phase) : phase % 1;
      action.time = fraction * action.getClip().duration;
      this.mixer.update(0);
    }

    const hover = this.airborne ? height * 0.27 : 0;
    const fit = (height - hover) / this.restHeight;
    const squash = 1 - 0.94 * Math.max(0, p.dying);
    this.root.position.set(p.x, p.y + (hover - this.floor * fit) * squash, p.z);
    this.root.rotation.set(
      0,
      p.yaw + (countryKeys.has(this.key) ? 0 : this.key === 'wasp' ? Math.PI / 2 : Math.PI),
      0.15 * p.hurt,
      'YXZ',
    );
    if (p.attack >= 0 && !this.actions.has('Attack')) this.root.rotateX(-0.45 * Math.sin(Math.PI * p.attack));
    this.root.scale.set(fit, fit * squash, fit);
    this.root.visible = true;
    const a = p.colors[0] ?? color('green');
    for (const surface of this.surfaces) {
      const { paint, pigment, original } = surface;
      if (original) {
        const flash = p.flash ? a : undefined;
        if (surface.flash === flash) continue;
        if (flash === undefined) pigment.array.set(original);
        else pigment.array.fill(flash);
        surface.flash = flash;
        pigment.needsUpdate = true;
        continue;
      }
      let index = INK;
      if (p.flash || paint === 'primary') index = a;
      else if (paint === 'eye') index = color('cream');
      else if (paint === 'secondary') index = p.colors[1] ?? a;
      if (pigment.getX(0) === index) continue;
      pigment.array.fill(index);
      pigment.needsUpdate = true;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    for (const { mesh } of this.surfaces) {
      mesh.geometry.dispose();
      if (mesh instanceof THREE.SkinnedMesh) mesh.skeleton.dispose();
    }
  }
}
