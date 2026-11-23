import type * as THREE from 'three';
import type { GameContext } from '@/game/types';
import { doorFront } from '@/world/city/features';
import { type CityLayout, groundAt } from '@/world/city/layout';
import {
  KayKitVillager,
  loadVillager,
  VILLAGER_MODELS,
  VILLAGER_ROLES,
} from '@/systems/figures/kaykit-villager';

export class Residents {
  private readonly villagers: KayKitVillager[] = [];
  private disposed = false;

  constructor(
    private readonly ctx: GameContext,
    layout: CityLayout,
    root: THREE.Object3D,
  ) {
    if (typeof window === 'undefined') return;
    layout.residents.forEach((resident, i) => {
      const building = layout.buildings[resident.building];
      if (!building) return;
      const variant = VILLAGER_MODELS[(i + (layout.seed >>> 0)) % VILLAGER_MODELS.length]!;
      void loadVillager(variant)
        .then((source) => {
          if (this.disposed) return;
          const at = doorFront(building, 1.9);
          // Stand beside the door, leaving the doorway open.
          at.x += Math.cos(building.angle) * 0.95;
          at.z -= Math.sin(building.angle) * 0.95;
          const actor = new KayKitVillager(source, i * 0.37);
          actor.root.position.set(at.x, groundAt(layout, at.x, at.z), at.z);
          actor.root.rotation.y = building.angle;
          actor.root.userData.resident = resident.name;
          actor.root.userData.variant = variant;
          actor.root.userData.profession = VILLAGER_ROLES[variant].profession;
          root.add(actor.root);
          this.villagers.push(actor);
        })
        .catch((error) => console.warn('村民模型加载失败', error));
    });
  }

  update(dt: number): void {
    for (const actor of this.villagers) {
      const distance = actor.root.position.distanceToSquared(this.ctx.player.position);
      actor.root.visible = distance < 100 * 100;
      if (actor.root.visible) actor.update(dt, distance < 3.5 * 3.5);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const actor of this.villagers) actor.dispose();
    this.villagers.length = 0;
  }
}
