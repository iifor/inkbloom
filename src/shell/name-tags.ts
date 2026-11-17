// Other players' names over their heads: plain DOM over the canvas, shown within 40 m and hidden
// when a wall is in the way. design: docs/game-design.md section 11.6
import * as THREE from 'three';
import type { GameContext } from '@/game/types';
import { projectToScreen } from './project';

const MAX_DIST = 40;

export class NameTags {
  private readonly root: HTMLElement;
  private readonly tags = new Map<number, HTMLElement>();
  private readonly dir = new THREE.Vector3();

  constructor(
    private readonly ctx: GameContext,
    parent: HTMLElement,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'name-tags';
    parent.append(this.root);
  }

  /** Place one player's tag at `head` (a point just above their head) this frame. */
  place(id: number, name: string, head: THREE.Vector3): void {
    let el = this.tags.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'name-tag';
      this.root.append(el);
      this.tags.set(id, el);
    }
    if (el.textContent !== name) el.textContent = name;
    const s = projectToScreen(this.ctx.renderer, head, MAX_DIST);
    const eye = this.ctx.renderer.camera.position;
    const dist = head.distanceTo(eye);
    // a wall between us hides the name
    const wall = s
      ? this.ctx.scenes.active.physics.raycast(eye, this.dir.subVectors(head, eye).normalize(), dist)
      : null;
    const shown = s !== null && (wall === null || wall.dist > dist - 0.5);
    el.style.opacity = shown ? String(Math.min(1, (MAX_DIST - dist) / 8)) : '0';
    if (shown) el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
  }

  remove(id: number): void {
    this.tags.get(id)?.remove();
    this.tags.delete(id);
  }

  dispose(): void {
    this.root.remove();
  }
}
