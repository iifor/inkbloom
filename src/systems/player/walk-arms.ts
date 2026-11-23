import * as THREE from 'three';
import { characterModel, defaultLook, type Look } from '@/content/characters';
import { makeInkMaterial } from '@/engine/render/ink-material';
import type { InHand } from '@/systems/tools/tool';
import { bracingHand, handsOf, walkingHand } from '@/systems/tools/viewmodels';
import { HandGait, type GaitPlayer } from './hand-gait';
import { CharacterModelSelection } from '@/systems/figures/character-model-selection';
import { CourierViewArms } from './courier-view-arms';

/** Two merged meshes, posed without rebuilding geometry or allocating per frame. */
export class WalkArms {
  private readonly root = new THREE.Group();
  private readonly material = makeInkMaterial({ cloth: true, viewModel: true });
  private readonly left = new THREE.Mesh(undefined, this.material);
  private readonly right = new THREE.Mesh(undefined, this.material);
  private readonly gait = new HandGait();
  private relaxed!: readonly [THREE.BufferGeometry, THREE.BufferGeometry];
  private braced!: readonly [THREE.BufferGeometry, THREE.BufferGeometry];
  private brush!: THREE.BufferGeometry;
  private painting = 0;
  private paintTime = 0;
  private brace = 0;
  private fallTime = 0;
  private look = defaultLook('courier');
  private model: CourierViewArms | null = null;
  private disposed = false;
  private readonly selection = new CharacterModelSelection();

  constructor(private readonly camera: THREE.Camera) {
    this.root.name = 'walking-hands';
    this.root.visible = false;
    this.left.frustumCulled = this.right.frustumCulled = false;
    this.root.add(this.left, this.right);
    camera.add(this.root);
    this.setLook(defaultLook('courier'));
  }

  setLook(look: Look): void {
    this.look = { ...look };
    this.selection.select(look.character, (source) => {
      this.model?.dispose();
      this.model = source ? new CourierViewArms(source, this.material) : null;
      if (this.model) {
        this.model.root.visible = false;
        this.root.add(this.model.root);
      }
    });
    if (this.relaxed) this.disposeHands();
    else {
      this.left.geometry.dispose();
      this.right.geometry.dispose();
    }
    const hands = handsOf(look);
    this.relaxed = [walkingHand(hands, -1), walkingHand(hands, 1)];
    this.braced = [bracingHand(hands, -1), bracingHand(hands, 1)];
    this.brush = walkingHand(hands, 1, look.accent);
    [this.left.geometry, this.right.geometry] = this.relaxed;
  }

  resetFallPose(): void {
    this.brace = 0;
    this.fallTime = 0;
    this.root.visible = false;
  }

  update(dt: number, player: GaitPlayer, held: InHand, alive: boolean, brace = 0): void {
    this.gait.update(dt, player, held.painting);
    this.painting = THREE.MathUtils.damp(this.painting, held.painting ? 1 : 0, 12, dt);
    this.paintTime += dt * (held.painting ? 8 : 0);
    this.brace = THREE.MathUtils.damp(this.brace, brace, brace > this.brace ? 13 : 18, dt);
    this.fallTime = brace > 0 ? this.fallTime + dt : 0;
    this.root.visible =
      alive &&
      !player.flying &&
      !player.gliding &&
      player.waterMode !== 'swimming' &&
      (held.item === null || held.item === 'brush');
    if (!this.root.visible) return;
    const open = brace > 0 || (held.item === null && this.brace > 0.08);
    this.left.geometry = open ? this.braced[0] : this.relaxed[0];
    this.right.geometry = open ? this.braced[1] : held.item === 'brush' ? this.brush : this.relaxed[1];
    const { amount, run, phase } = this.gait;
    // Keep the reference framing when players widen the world camera's FOV.
    const viewScale =
      this.camera instanceof THREE.PerspectiveCamera
        ? Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) / Math.tan(THREE.MathUtils.degToRad(32.5))
        : 1;
    this.material.uniforms.uViewScale!.value = viewScale;
    for (let side = -1; side <= 1; side += 2) {
      const hand = side === -1 ? this.left : this.right;
      hand.scale.setScalar(1.25);
      // Opposite arms travel forward on alternate strides; running raises the bent elbows.
      const swing = Math.sin(phase) * side * amount;
      hand.position.set(
        side * (0.32 - run * 0.025) + swing * 0.018,
        -0.075 + run * 0.025 + swing * (0.012 + run * 0.018),
        -0.48 - swing * (0.045 + run * 0.055),
      );
      hand.rotation.set(
        -0.12 + swing * (0.12 + run * 0.12),
        side * 0.08,
        side * (0.08 + run * 0.12) + swing * 0.07,
      );
      // The hands spread and reach ahead, with a small alternating correction in free fall.
      const reach = this.brace * (open ? 1 : 0);
      const sway = Math.sin(this.fallTime * 7 + side * 1.2) * reach * (player.grounded ? 0.2 : 1);
      hand.position.x += side * reach * 0.095;
      hand.position.y += reach * 0.145 + sway * 0.032;
      hand.position.z -= reach * 0.13 + sway * 0.035;
      hand.rotation.x -= reach * 0.58;
      hand.rotation.y -= side * reach * 0.17;
      hand.rotation.z -= side * reach * 0.39 + sway * 0.13;
    }
    // The working hand reaches towards the surface while the other remains low.
    this.right.position.y += this.painting * (0.07 + Math.sin(this.paintTime) * 0.018);
    this.right.position.z -= this.painting * 0.06;
    this.right.rotation.z += this.painting * Math.sin(this.paintTime) * 0.12;
    const useModel = !!characterModel(this.look.character) && this.model !== null;
    this.left.visible = this.right.visible = !useModel;
    if (this.model) {
      this.model.root.visible = useModel;
      if (useModel) this.model.update(dt, this.look, this.left, this.right, held.item === 'brush', open);
    }
  }

  dispose(): void {
    this.selection.dispose();
    this.disposed = true;
    this.model?.dispose();
    this.root.removeFromParent();
    this.disposeHands();
    this.material.dispose();
  }

  private disposeHands(): void {
    for (const geometry of [...this.relaxed, ...this.braced, this.brush]) geometry.dispose();
  }
}
