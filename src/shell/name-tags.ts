// Other players' names over their heads: plain DOM over the canvas, shown within 40 m and hidden
// when a wall is in the way. design: docs/game-design.md section 11.6
import * as THREE from 'three';
import type { GameContext } from '@/game/types';
import { PALETTE } from '@/content/palette';
import { projectToScreen } from './project';

/** A palette colour as CSS. */
function rgbOf(index: number): string {
  const c = PALETTE[index]?.rgb ?? [0, 0, 0];
  return `rgb(${c.map((v) => Math.round(v * 255)).join(', ')})`;
}

const MAX_DIST = 40;
// Bright pigments stay readable at night; a player's room id keeps the colour consistent
// for every observer, including players who happen to share the same nickname.
const NAME_COLORS = [
  '#ffd27d', // honey
  '#9ee9d1', // mint
  '#ffaaa2', // coral
  '#9ddcff', // sky
  '#dac0ff', // lilac
  '#f7b8df', // rose
  '#c9e98c', // lime
  '#ffbd87', // apricot
  '#9ee9ef', // turquoise
  '#b8c9ff', // periwinkle
  '#f4e89b', // primrose
  '#e8c9ae', // sand
] as const;

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

  /** Place one player's tag at `head` (a point just above their head) this frame, edged in
   * `team` (a palette colour) in the arena. */
  place(id: number, name: string, head: THREE.Vector3, team: number | null = null): void {
    let el = this.tags.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'name-tag';
      el.style.setProperty('--name-color', NAME_COLORS[Math.abs(id) % NAME_COLORS.length]!);
      this.root.append(el);
      this.tags.set(id, el);
    }
    if (el.textContent !== name) el.textContent = name;
    const edge = team === null ? '' : rgbOf(team);
    if (el.style.borderBottomColor !== edge) el.style.borderBottomColor = edge;
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
