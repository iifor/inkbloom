import * as THREE from 'three';
import type { Look } from '@/content/characters';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { PlayerFigures, type PlayerPose } from '@/systems/figures/player-figure';

/** The local player's world-space body for the seated and supine first-person views. */
export class RestBody {
  private readonly root = new THREE.Group();
  private readonly material = makeInkMaterial({ cloth: true });
  private readonly figures = new PlayerFigures(this.root, this.material, true);
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.root.name = 'resting-player';
    scene.add(this.root);
  }

  draw(
    dt: number,
    look: Look,
    position: THREE.Vector3,
    yaw: number,
    rest: NonNullable<PlayerPose['rest']>,
  ): void {
    this.time += dt;
    this.root.visible = true;
    this.figures.begin();
    this.figures.draw(look, {
      x: position.x,
      y: position.y,
      z: position.z,
      yaw,
      pitch: 0,
      walk: 0,
      stride: 0,
      air: false,
      glide: false,
      hurt: 0,
      dying: -1,
      t: this.time,
      rest,
    });
    this.figures.end();
  }

  hide(): void {
    if (!this.root.visible) return;
    this.root.visible = false;
    this.figures.begin();
    this.figures.end();
  }

  dispose(): void {
    this.root.removeFromParent();
    this.figures.dispose();
    this.material.dispose();
  }
}
