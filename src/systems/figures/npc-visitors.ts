import * as THREE from 'three';
import type { GameContext } from '@/game/types';
import type { Visitor } from '@/world/npc-attention';

/** Reused by one population; no per-NPC player-list allocation or ray vectors. */
export class NpcVisitors {
  readonly people: Visitor[] = [];
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  constructor(private readonly ctx: GameContext) {}

  update(): void {
    this.people.length = 0;
    if (this.ctx.arena?.inside) return;
    const p = this.ctx.player;
    if (this.ctx.combat.alive && !this.ctx.combat.infected && !p.flying && !p.gliding) {
      this.people.push({
        id: this.ctx.net?.me ?? 0,
        x: p.position.x,
        y: p.position.y,
        z: p.position.z,
        eyeY: p.eye.y,
      });
    }
    this.ctx.net?.npcVisitors?.(this.people);
  }

  canSee(at: THREE.Vector3, visitor: Visitor): boolean {
    this.origin.copy(at).y += 1.45;
    this.direction.set(visitor.x, visitor.eyeY, visitor.z).sub(this.origin);
    const distance = this.direction.length();
    if (distance < 0.1) return true;
    this.direction.multiplyScalar(1 / distance);
    return !this.ctx.scenes.active.physics.raycast(
      this.origin,
      this.direction,
      distance - 0.1,
      (box) => !!box.data.seeThrough,
    );
  }
}
