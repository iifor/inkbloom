import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  characterModel,
  characterModelPath,
  HAIR_COLORS,
  SKIN_TONES,
  type Look,
  type CharacterKey,
} from '@/content/characters';
import { PALETTE, color, type ColorKey } from '@/content/palette';
import { buildProps } from './player-props';
import { posePlayer, type PlayerPose } from './player-pose';
import { alignGrips, heldIn } from './player-hold';
import type { Rig } from './player-rig';
import { characterMaterial, enableCharacterPaint } from '@/engine/render/character-paint';

const FIXED: Record<string, ColorKey> = {
  coat: 'limewash',
  trousers: 'charcoal',
  boots: 'bark',
  bootTrim: 'charcoal',
  bag: 'brown',
  eye: 'ink',
  paper: 'cream',
  button: 'yellow',
};
const templates = new Map<CharacterKey, THREE.Group>();
const pending = new Map<CharacterKey, Promise<THREE.Group>>();
const paletteSlots = new Map<string, number>(PALETTE.map((p, i) => [p.key, i]));
export const COURIER_PALM_OFFSET = 0.15;

/** One download shared by selection previews, the world lineup and remote players. */
export function loadCourier(character: CharacterKey = 'courier'): Promise<THREE.Group> {
  const file = characterModelPath(character);
  if (!file) return Promise.reject(new Error(`No imported model for ${character}`));
  let request = pending.get(character);
  if (!request) {
    request = new GLTFLoader()
      .loadAsync(`${import.meta.env.BASE_URL}${file}`)
      .then((gltf) => {
        templates.set(character, gltf.scene);
        return gltf.scene;
      })
      .catch((error) => {
        pending.delete(character);
        throw error;
      });
    pending.set(character, request);
  }
  return request;
}

const MAP = {
  hips: 'pelvis',
  torso: 'spine_01',
  head: 'Head',
  armL: 'upperarm_l',
  armR: 'upperarm_r',
  foreL: 'lowerarm_l',
  foreR: 'lowerarm_r',
  legL: 'thigh_l',
  legR: 'thigh_r',
  shinL: 'calf_l',
  shinR: 'calf_r',
  footL: 'foot_l',
  footR: 'foot_r',
} as const;
type Joint = keyof typeof MAP;

/** Source proportions with the same pose/IK contract as the other game characters. */
export function courierRig(model: THREE.Object3D): Rig {
  model.updateMatrixWorld(true);
  const at = (name: string): THREE.Vector3 => {
    const bone = model.getObjectByName(name);
    if (!bone) throw new Error(`Courier is missing bone ${name}`);
    return bone.getWorldPosition(new THREE.Vector3());
  };
  const root = new THREE.Object3D();
  const joint = (name: string, parent: THREE.Object3D): THREE.Object3D => {
    const node = new THREE.Object3D();
    parent.add(node);
    root.updateMatrixWorld(true);
    node.position.copy(parent.worldToLocal(at(name)));
    return node;
  };
  const hips = joint('pelvis', root);
  const torso = joint('spine_01', hips);
  const head = joint('Head', torso);
  const armL = joint('upperarm_l', torso),
    armR = joint('upperarm_r', torso);
  const foreL = joint('lowerarm_l', armL),
    foreR = joint('lowerarm_r', armR);
  const upper = at('upperarm_l').distanceTo(at('lowerarm_l'));
  const lower = at('lowerarm_l').distanceTo(at('hand_l'));
  // KayKit supplies a grip marker inside its authored hand. Use it instead of
  // the longer Quaternius palm offset so short hands stay on the tool handle.
  const gripOffset = model.getObjectByName('grip_r')
    ? at('grip_r').sub(at('hand_r'))
    : new THREE.Vector3(-0.032, -COURIER_PALM_OFFSET, 0);
  foreL.position.set(0, -upper, 0);
  foreR.position.set(0, -upper, 0);
  const palmL = new THREE.Object3D(),
    palmR = new THREE.Object3D();
  foreL.add(palmL);
  foreR.add(palmR);
  palmL.position.copy(gripOffset);
  palmL.position.x *= -1;
  palmL.position.y -= lower;
  palmR.position.copy(gripOffset);
  palmR.position.y -= lower;
  const legL = joint('thigh_l', hips),
    legR = joint('thigh_r', hips);
  const shinL = joint('calf_l', legL),
    shinR = joint('calf_r', legR);
  const footL = joint('foot_l', shinL),
    footR = joint('foot_r', shinR);
  const props = buildProps(torso);
  // The support hand sits under the receiver, within this character's shorter forearm reach.
  for (const item of ['rifle', 'sniper', 'launcher'] as const) props[item].off!.set(-0.015, 0.035, -0.17);
  return {
    root,
    hips,
    torso,
    head,
    armL,
    armR,
    foreL,
    foreR,
    palmL,
    palmR,
    legL,
    legR,
    shinL,
    shinR,
    footL,
    footR,
    hipsY: hips.position.y,
    trails: [],
    parts: [],
    props,
    armLengths: [upper, lower],
    gripOffset,
  };
}

/** Rest-world orientations retain the author's bone axes while game poses use down-facing limbs. */
export class CourierActor {
  readonly model: THREE.Object3D;
  readonly rig: Rig;
  private readonly joints: {
    bone: THREE.Object3D;
    source: THREE.Object3D;
    rest: THREE.Quaternion;
    wrist: boolean;
  }[] = [];
  private readonly paints: { mesh: THREE.Mesh; slot: string }[] = [];
  private readonly fingers: {
    bone: THREE.Object3D;
    rest: THREE.Quaternion;
    axis: THREE.Vector3;
    side: string;
    curl: number;
  }[] = [];
  private readonly material: THREE.ShaderMaterial;
  private readonly q = new THREE.Quaternion();
  private readonly parentQ = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly wristOffset = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly parentScale = new THREE.Vector3();
  private readonly curlQ = new THREE.Quaternion();
  private lookKey = '';
  private lastT = -Infinity;
  private readonly lastAt = new THREE.Vector3();
  private lastHeld: ReturnType<typeof heldIn> = null;
  private fingerGrip = 0;
  private readonly brushSocket?: THREE.Object3D;
  private readonly previous = new Map<
    THREE.Object3D,
    {
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
      scale: THREE.Vector3;
    }
  >();

  constructor(source: THREE.Object3D, material: THREE.ShaderMaterial) {
    this.model = clone(source);
    this.brushSocket = this.model.getObjectByName('grip_r');
    this.rig = courierRig(this.model);
    this.material = material.clone();
    // Keep the live world uniforms shared; only the per-character ink threshold is private.
    this.material.uniforms = { ...material.uniforms, uCourierInkTo: { value: -1e6 } };
    enableCharacterPaint(this.material);
    this.material.vertexShader = `uniform float uCourierInkTo;\n${material.vertexShader}`.replace(
      'float idx = aColor;',
      `float idx = world.y < uCourierInkTo ? ${color('ink')}.0 : aColor;`,
    );
    for (const [key, name] of Object.entries(MAP)) {
      const bone = this.model.getObjectByName(name)!;
      this.joints.push({
        bone,
        source: this.rig[key as Joint],
        rest: bone.getWorldQuaternion(new THREE.Quaternion()),
        wrist: false,
      });
    }
    for (const side of ['L', 'R'] as const) {
      const bone = this.model.getObjectByName(`hand_${side.toLowerCase()}`)!;
      this.joints.push({
        bone,
        source: this.rig[`palm${side}`],
        rest: bone.getWorldQuaternion(new THREE.Quaternion()),
        wrist: true,
      });
    }
    for (const side of ['l', 'r'])
      for (const finger of ['index', 'middle', 'ring', 'pinky', 'thumb', 'digits'])
        for (let segment = 1; segment <= 3; segment++) {
          const bone = this.model.getObjectByName(`${finger}_0${segment}_${side}`);
          if (!bone) continue; // The modular character has two thumb joints.
          const axis = (
            finger === 'thumb' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, 0, side === 'l' ? 1 : -1)
          ).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
          this.fingers.push({
            bone,
            axis,
            rest: bone.quaternion.clone(),
            side,
            curl: finger === 'thumb' ? 0.75 : segment === 1 ? 0.95 : segment === 2 ? 1.25 : 0.8,
          });
        }
    this.model.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (Array.isArray(obj.material)) throw new Error('Courier primitives must have one paint slot each');
      const slot = obj.material.name;
      obj.geometry = obj.geometry.clone();
      const n = obj.geometry.getAttribute('position').count;
      const pigments = slot === 'ResidentPigments' ? obj.geometry.getAttribute('_inkcolor') : undefined;
      obj.geometry.setAttribute(
        'aColor',
        pigments ?? new THREE.Float32BufferAttribute(new Float32Array(n), 1),
      );
      const surface = new Float32Array(n);
      if (pigments) {
        for (let i = 0; i < n; i++) {
          const index = pigments.getX(i);
          surface[i] = characterMaterial(
            index === color('brown') || index === color('bark') ? 'brown' : '',
            index,
          );
        }
      } else surface.fill(characterMaterial(slot, -1));
      obj.geometry.setAttribute('aCharacterMaterial', new THREE.Float32BufferAttribute(surface, 1));
      obj.geometry.setAttribute(
        'aSurface',
        new THREE.Float32BufferAttribute(new Float32Array(n).fill(-2), 1),
      );
      obj.geometry.setAttribute('aPane', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      obj.material = this.material;
      obj.frustumCulled = false;
      this.paints.push({ mesh: obj, slot });
    });
    this.model.name = 'QuaterniusCourier';
  }

  /** Keep first-person triangles by their skin weights without changing the shared model. */
  retainTriangles(
    boneNames: readonly string[],
    keepWeight: (weight: number) => boolean,
    descendants = false,
  ): void {
    const bones = new Set<THREE.Object3D>();
    for (const name of boneNames) {
      const bone = this.model.getObjectByName(name);
      if (descendants) bone?.traverse((node) => bones.add(node));
      else if (bone) bones.add(bone);
    }
    this.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!(object instanceof THREE.SkinnedMesh)) {
        object.visible = false;
        return;
      }
      const geometry = object.geometry;
      const joints = geometry.getAttribute('skinIndex');
      const weights = geometry.getAttribute('skinWeight');
      const matching = object.skeleton.bones.map((bone) => bones.has(bone));
      const keep = (vertex: number): boolean => {
        let weight = 0;
        for (let component = 0; component < 4; component++)
          if (matching[joints.getComponent(vertex, component)])
            weight += weights.getComponent(vertex, component);
        return keepWeight(weight);
      };
      const indices: number[] = [];
      const index = geometry.index;
      const count = index?.count ?? joints.count;
      for (let i = 0; i < count; i += 3) {
        const a = index ? index.getX(i) : i;
        const b = index ? index.getX(i + 1) : i + 1;
        const c = index ? index.getX(i + 2) : i + 2;
        if (keep(a) && keep(b) && keep(c)) indices.push(a, b, c);
      }
      geometry.setIndex(indices);
      object.visible = indices.length > 0;
    });
  }

  pose(look: Look, pose: PlayerPose): void {
    const dt = pose.t - this.lastT;
    const continuous =
      !pose.rest &&
      // Flight already blends the seated pose against the unfolding vehicle.
      !(pose.flight && pose.flight.blend > 0) &&
      dt > 0 &&
      dt <= 0.25 &&
      this.model.visible &&
      this.lastAt.distanceToSquared(this.position.set(pose.x, pose.y, pose.z)) < 4;
    const held = heldIn(pose);
    this.fingerGrip = continuous
      ? THREE.MathUtils.lerp(this.fingerGrip, held ? 1 : 0, 1 - Math.exp(-25 * dt))
      : held
        ? 1
        : 0;
    // Save the displayed hand before computing the new target; new tools rise from that hand.
    const previousGrip = continuous ? this.rig.palmR.getWorldPosition(new THREE.Vector3()) : null;
    posePlayer(this.rig, pose);
    if (continuous) {
      const blend = 1 - Math.exp(-22 * dt);
      for (const key of Object.keys(MAP) as Joint[]) {
        const node = this.rig[key],
          previous = this.previous.get(node)!;
        node.position.lerpVectors(previous.position, node.position, blend);
        node.quaternion.slerp(previous.quaternion, 1 - blend);
        node.scale.lerpVectors(previous.scale, node.scale, blend);
      }
      for (const side of ['L', 'R'] as const) {
        if (held && (side === 'R' || this.rig.props[held].off)) continue;
        const palm = this.rig[`palm${side}`],
          previous = this.previous.get(palm)!;
        palm.quaternion.slerp(previous.quaternion, 1 - blend);
        palm.position.copy(this.rig.gripOffset!);
        if (side === 'L') palm.position.x *= -1;
        palm.position.applyQuaternion(palm.quaternion);
        palm.position.y -= this.rig.armLengths![1];
      }
      if (held) {
        const prop = this.rig.props[held].node;
        const previous = held === this.lastHeld ? this.previous.get(prop) : null;
        if (previous) {
          prop.position.lerpVectors(previous.position, prop.position, blend);
          prop.quaternion.slerp(previous.quaternion, 1 - blend);
        } else if (previousGrip) {
          this.rig.root.updateMatrixWorld(true);
          prop.position.lerpVectors(this.rig.torso.worldToLocal(previousGrip), prop.position, blend);
        }
        // Solve after blending: the palms must remain on the moving prop throughout the blend.
        alignGrips(this.rig, held);
      }
    }
    for (const node of [
      ...Object.keys(MAP).map((k) => this.rig[k as Joint]),
      this.rig.palmL,
      this.rig.palmR,
      ...(held ? [this.rig.props[held].node] : []),
    ]) {
      let previous = this.previous.get(node);
      if (!previous) {
        previous = {
          position: new THREE.Vector3(),
          quaternion: new THREE.Quaternion(),
          scale: new THREE.Vector3(),
        };
        this.previous.set(node, previous);
      }
      previous.position.copy(node.position);
      previous.quaternion.copy(node.quaternion);
      previous.scale.copy(node.scale);
    }
    this.lastT = pose.t;
    this.lastAt.set(pose.x, pose.y, pose.z);
    this.lastHeld = held;
    const relaxed = pose.rest
      ? 0.18 - 0.14 * pose.rest.sitting
      : pose.swim
        ? 0.28
        : pose.glide
          ? 0.04
          : 0.18 + Math.min(1, pose.stride) * 0.25;
    this.applyRig(
      look,
      THREE.MathUtils.lerp(relaxed, 1, held ? this.fingerGrip : 0),
      THREE.MathUtils.lerp(relaxed, 1, held && this.rig.props[held].off ? this.fingerGrip : 0),
    );
    // Breathing scales the torso non-uniformly. Anchor the carried shaft to the
    // final skinned socket after blending and scaling the arms.
    if (held === 'brush' && this.brushSocket) {
      const brush = this.rig.props.brush.node;
      brush.position.copy(brush.parent!.worldToLocal(this.brushSocket.getWorldPosition(this.position)));
      if (
        look.character.startsWith('cube/') ||
        look.character === 'platformer/Character' ||
        look.character === 'cyber/Character'
      ) {
        // Their closed fists hold the shaft across the palm. Following the forearm's
        // pitch alone sends the bristles back through the cheek on the upward stroke.
        const paint = pose.paint ?? 0;
        brush.rotation.set(0.88 - paint * (0.4 + 0.1 * Math.cos(pose.t * 3.8)) + 0.3 * pose.pitch, -0.12, 0);
      }
      brush.updateMatrixWorld(true);
    }
    this.material.uniforms.uCourierInkTo!.value =
      pose.dying >= 0 ? pose.y + Math.min(1, pose.dying / 0.6) * 1.9 : -1e6;
  }

  /** Apply an already posed rig, also used by the camera's cropped first-person arms. */
  applyRig(look: Look, rightGrip: number, leftGrip: number): void {
    this.rig.root.updateWorldMatrix(true, true);
    this.model.visible = true;
    // The model's parent is the scene group. Bone positions below are world positions, including
    // the game's root squash; the model itself stays identity to avoid applying motion twice.
    for (const j of this.joints) {
      j.source.getWorldPosition(this.position);
      j.source.getWorldQuaternion(this.q);
      if (j.wrist) {
        this.wristOffset.copy(this.rig.gripOffset!);
        if (j.source === this.rig.palmL) this.wristOffset.x *= -1;
        this.position.sub(this.wristOffset.applyQuaternion(this.q));
      }
      this.q.multiply(j.rest);
      j.bone.parent!.updateWorldMatrix(true, false);
      j.bone.position.copy(j.bone.parent!.worldToLocal(this.position));
      j.bone.parent!.getWorldQuaternion(this.parentQ).invert();
      j.bone.quaternion.copy(this.parentQ.multiply(this.q));
      j.source.getWorldScale(this.scale);
      j.bone.parent!.getWorldScale(this.parentScale);
      j.bone.scale.copy(this.scale.divide(this.parentScale));
      j.bone.updateMatrixWorld(true);
    }
    for (const f of this.fingers) {
      const amount = f.side === 'r' ? rightGrip : leftGrip;
      f.bone.quaternion.copy(f.rest).multiply(this.curlQ.setFromAxisAngle(f.axis, f.curl * amount));
    }
    const key = `${look.skin}/${look.hair}/${look.accent}`;
    if (key !== this.lookKey) {
      this.lookKey = key;
      for (const { mesh, slot } of this.paints) {
        if (slot === 'ResidentPigments') continue;
        const pigment =
          slot === 'skin'
            ? color(SKIN_TONES[look.skin] ?? SKIN_TONES[0])
            : slot === 'hair'
              ? color(HAIR_COLORS[look.hair] ?? HAIR_COLORS[0])
              : slot === 'accent'
                ? look.accent
                : FIXED[slot]
                  ? color(FIXED[slot])
                  : (paletteSlots.get(slot) ?? color('cream'));
        const attr = mesh.geometry.getAttribute('aColor') as THREE.BufferAttribute;
        (attr.array as Float32Array).fill(pigment);
        attr.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    this.model.removeFromParent();
    for (const { mesh } of this.paints) mesh.geometry.dispose();
    const skeletons = new Set<THREE.Skeleton>();
    this.model.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton);
    });
    for (const skeleton of skeletons) skeleton.dispose();
    this.material.dispose();
  }
}

/** A frame pool: each visible courier owns its skeleton and colours, even in multiplayer. */
export class CourierFigures {
  private readonly pools = new Map<CharacterKey, { actors: CourierActor[]; used: number }>();
  private readonly requested = new Set<CharacterKey>();
  constructor(
    private readonly parent: THREE.Object3D,
    private readonly material: THREE.Material,
    private readonly hideHead = false,
  ) {}
  begin(): void {
    for (const pool of this.pools.values()) pool.used = 0;
  }
  draw(look: Look, pose: PlayerPose): Rig | null {
    if (!characterModel(look.character) || !(this.material instanceof THREE.ShaderMaterial)) return null;
    if (!this.requested.has(look.character) && typeof window !== 'undefined') {
      this.requested.add(look.character);
      void loadCourier(look.character).catch((error) =>
        console.warn('角色模型未加载，使用备用外观。', error),
      );
    }
    const template = templates.get(look.character);
    if (!template) return null;
    let pool = this.pools.get(look.character);
    if (!pool) {
      pool = { actors: [], used: 0 };
      this.pools.set(look.character, pool);
    }
    let actor = pool.actors[pool.used++];
    if (!actor) {
      actor = new CourierActor(template, this.material);
      if (this.hideHead) actor.retainTriangles(['Head', 'neck_01'], (weight) => weight < 0.25);
      this.parent.add(actor.model);
      pool.actors.push(actor);
    }
    actor.pose(look, pose);
    return actor.rig;
  }
  end(): void {
    for (const pool of this.pools.values())
      for (let i = pool.used; i < pool.actors.length; i++) pool.actors[i]!.model.visible = false;
  }
  dispose(): void {
    for (const pool of this.pools.values()) for (const actor of pool.actors) actor.dispose();
    this.pools.clear();
  }
}
