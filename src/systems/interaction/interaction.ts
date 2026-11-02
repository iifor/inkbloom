// "Press E" for anything: doors, gates, later NPCs, chests, workshops. Scenes register
// interactables; this system picks the nearest one in front of the player.
import { TUNING } from '@/content/tuning';
import {
  type GameContext,
  type Interactable,
  type InteractionApi,
  type System,
  sceneKey,
} from '@/game/types';

export class InteractionSystem implements System, InteractionApi {
  readonly id = 'interaction';
  private readonly items = new Set<Interactable>();
  focused: Interactable | null = null;

  constructor(private readonly ctx: GameContext) {}

  add(item: Interactable): () => void {
    this.items.add(item);
    return () => {
      this.items.delete(item);
      if (this.focused === item) this.focused = null;
    };
  }

  update(): void {
    const { player, scenes, input } = this.ctx;
    const here = sceneKey(scenes.active.ref);
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of this.items) {
      if (it.scene !== here) continue;
      const d = it.pos.distanceTo(player.position);
      if (d > Math.max(it.radius, TUNING.interaction.radius)) continue;
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    this.focused = best;
    if (best && input.pressed('interact')) best.activate();
  }
}
