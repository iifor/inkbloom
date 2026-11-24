import * as THREE from 'three';
import { characterModel, type Look } from '@/content/characters';
import { TUNING } from '@/content/tuning';
import { WEAPONS } from '@/content/weapons';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { CourierViewArms } from '@/systems/player/courier-view-arms';
import { SwimArms } from '@/systems/player/swim-arms';
import { WalkArms } from '@/systems/player/walk-arms';
import { handsOf, viewModel } from '@/systems/tools/viewmodels';
import { CharacterModelSelection } from './character-model-selection';

export class FirstPersonPreview {
  // Independent from the gameplay camera's children and gameplay tool state.
  readonly root = new THREE.PerspectiveCamera();
  private readonly walk = new WalkArms(this.root);
  private readonly swim = new SwimArms(this.root);
  private readonly swimVelocity = new THREE.Vector3(0, 0, -2.6);
  private readonly material = makeInkMaterial({ cloth: true });
  private readonly weapons = new Map<'rifle' | 'katana', THREE.Mesh>();
  private look: Look;
  private arms: CourierViewArms | null = null;
  private disposed = false;
  private readonly selection = new CharacterModelSelection();

  constructor(look: Look) {
    this.look = look;
    this.root.name = 'first-person-motion-preview';
    this.setLook(look);
  }

  setLook(look: Look): void {
    this.look = look;
    this.selection.select(look.character, (source) => {
      this.arms?.dispose();
      this.arms = source ? new CourierViewArms(source, this.material) : null;
      if (this.arms) {
        this.arms.root.visible = false;
        this.root.add(this.arms.root);
      }
      this.buildWeapons();
    });
    this.walk.setLook(look);
    this.swim.setLook(look);
    this.buildWeapons();
  }

  private buildWeapons(): void {
    const hands = this.arms && characterModel(this.look.character) ? null : handsOf(this.look);
    for (const key of ['rifle', 'katana'] as const) {
      const def = WEAPONS.find((weapon) => weapon.key === key)!;
      const previous = this.weapons.get(key);
      if (previous) {
        previous.geometry.dispose();
        previous.geometry = viewModel(def, hands);
      } else {
        const mesh = new THREE.Mesh(viewModel(def, hands), this.material);
        mesh.visible = false;
        mesh.frustumCulled = false;
        this.root.add(mesh);
        this.weapons.set(key, mesh);
      }
    }
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    motion: {
      stride: number;
      lift: number;
      air: boolean;
      glide: boolean;
      swim: boolean;
      held: 'brush' | 'katana' | 'rifle' | null;
      phase: number;
    },
  ): void {
    const { stride, lift, air, glide, swim, held, phase } = motion;
    this.root.position.copy(camera.position);
    this.root.quaternion.copy(camera.quaternion);
    // WalkArms uses this camera's FOV to frame the hands. A portrait picker has less
    // horizontal room than gameplay, so fit the same grip across the narrower canvas.
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    this.root.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfHeight * Math.min(1, camera.aspect / 1.5)));
    const drift = Math.sin(phase * Math.PI);
    this.walk.update(
      dt,
      {
        grounded: !air,
        flying: false,
        gliding: false,
        dashing: false,
        speed: TUNING.player.walkSpeed * stride,
        waterMode: swim ? 'swimming' : 'dry',
      },
      { item: held, painting: held === 'brush', aiming: held === 'rifle' },
      true,
      glide ? 0.85 : air ? 0.34 : 0,
    );
    this.swim.update(dt, Number(swim), this.swimVelocity, 0);
    // Small view motion sells stationary jump and glide previews without moving the player.
    this.root.position.y += swim ? this.swim.head.lift : lift * 0.16;
    if (swim) {
      this.root.rotateX(this.swim.head.nod);
      this.root.rotateZ(this.swim.head.roll);
    }
    const model = characterModel(this.look.character) ? this.arms : null;
    if (this.arms) this.arms.root.visible = false;
    for (const [key, mesh] of this.weapons) {
      mesh.visible = key === held && !swim;
      if (!mesh.visible) continue;
      if (key === 'katana') {
        const arc = phase < 1 ? drift : 0;
        mesh.position.set(0.27 - 0.1 * arc, -0.28 + 0.16 * arc, -0.48 - 0.14 * arc);
        mesh.rotation.set(0.55 + 1.05 * arc * Math.cos(phase * Math.PI), 0.18, -0.04);
        if (model) mesh.position.x -= 0.15;
      } else {
        const kick = Math.max(0, 1 - phase * 3);
        mesh.position.set(0.22, -0.22, -0.42 + kick * 0.05);
        mesh.rotation.set(kick * 0.13, 0, 0);
        if (model) mesh.position.x -= 0.1;
      }
      if (model) {
        model.root.visible = true;
        model.holdWeapon(this.look, mesh, key);
      }
    }
  }

  dispose(): void {
    this.selection.dispose();
    this.disposed = true;
    this.root.removeFromParent();
    this.walk.dispose();
    this.swim.dispose();
    this.arms?.dispose();
    for (const mesh of this.weapons.values()) mesh.geometry.dispose();
    this.material.dispose();
  }
}
