// "Press E" for anything: doors, gates, later NPCs, chests, workshops. Scenes register
// interactables; this system picks the nearest one in front of the player.
import { TUNING } from '@/content/tuning';
import {
  type GameContext,
  type Interactable,
  type InteractionAction,
  type InteractionApi,
  type System,
  sceneKey,
} from '@/game/types';

export class InteractionSystem implements System, InteractionApi {
  readonly id = 'interaction';
  private readonly items = new Set<Interactable>();
  focused: Interactable | null = null;
  private charging: {
    item: Interactable;
    action: InteractionAction;
    key: 'interact' | 'secondary' | 'talk';
    time: number;
  } | null = null;
  private readonly release: () => void;

  constructor(private readonly ctx: GameContext) {
    this.release = ctx.events.on('player:hurt', () => this.cancel());
  }

  private cancel(): void {
    this.charging?.action.onHold?.(0);
    this.charging = null;
  }

  add(item: Interactable): () => void {
    this.items.add(item);
    return () => {
      this.items.delete(item);
      if (this.charging?.item === item) this.cancel();
      if (this.focused === item) this.focused = null;
    };
  }

  update(dt = 0): void {
    const { player, scenes, input } = this.ctx;
    const here = sceneKey(scenes.active.ref);
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of this.items) {
      if (it.scene !== here) continue;
      const d = it.pos.distanceTo(player.position);
      if (d > (it.holdSeconds ? it.radius : Math.max(it.radius, TUNING.interaction.radius))) continue;
      if (d < bestD && it.label() !== null) {
        bestD = d;
        best = it;
      }
    }
    this.focused = best;
    if (
      this.charging &&
      (this.charging.item !== best ||
        !input.held(this.charging.key) ||
        !this.ctx.combat.alive ||
        this.charging.action.label() === null ||
        this.charging.action.canHold?.() === false)
    )
      this.cancel();
    if (this.charging) {
      const c = this.charging;
      c.time += Math.max(0, Math.min(dt, 0.1));
      c.action.onHold?.(Math.min(1, c.time / c.action.holdSeconds!));
      if (c.time >= c.action.holdSeconds!) {
        this.charging = null;
        c.action.activate();
        c.action.onHold?.(0);
      }
      return;
    }
    const key = input.pressed('interact')
      ? 'interact'
      : input.pressed('secondary')
        ? 'secondary'
        : input.pressed('talk')
          ? 'talk'
          : null;
    const action = key === 'interact' ? best : key === 'secondary' ? best?.alt : best?.talk;
    if (!best || !key || !action || action.label() === null || !this.ctx.combat.alive) return;
    if (!action.holdSeconds) action.activate();
    else if (action.canHold?.() !== false) this.charging = { item: best, action, key, time: 0 };
  }

  dispose(): void {
    this.cancel();
    this.release();
    this.items.clear();
    this.focused = null;
  }
}
