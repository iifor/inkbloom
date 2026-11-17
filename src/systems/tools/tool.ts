// Tools replace fixed classes: the player carries a belt of tools and switches freely.
// To add a tool (weapon, glider, marker...), implement Tool and add it to the belt in the mode.
import type { GameContext, System } from '@/game/types';
import type { HeldItem } from '@/world/net/protocol';

export interface ToolHud {
  /** Short lines shown under the slot bar. */
  readonly lines: readonly string[];
  /** 0..1 progress of the current action, or null for none. */
  readonly progress: number | null;
  /** Palette index to show as the active swatch, or null. */
  readonly swatch: number | null;
}

/** What the player has in hand, as other players see it (systems/net sends it on). */
export interface InHand {
  readonly item: HeldItem | null;
  /** Sighting down a gun. */
  readonly aiming: boolean;
  /** Working a surface with the brush. */
  readonly painting: boolean;
}

const EMPTY: InHand = { item: null, aiming: false, painting: false };

export interface Tool {
  readonly id: string;
  readonly name: string;
  /** Runs every frame while the tool is held. */
  update(dt: number): void;
  /** Runs every frame for every tool, held or not (projectiles, cooldowns). */
  tick?(dt: number): void;
  hud(): ToolHud;
  onEquip?(): void;
  onUnequip?(): void;
  /** What it shows in hand; absent for a tool that shows nothing (the ink marker). */
  inHand?(): InHand;
}

const SLOT_ACTIONS = ['slot1', 'slot2', 'slot3', 'slot4'] as const;

export class ToolBelt implements System {
  readonly id = 'tools';
  index = 0;
  private stowed = false;

  constructor(
    private readonly ctx: GameContext,
    readonly tools: Tool[],
  ) {
    this.tools[0]?.onEquip?.();
  }

  get active(): Tool | undefined {
    return this.tools[this.index];
  }

  /** What is in hand: nothing while swimming (the tool is put away). */
  inHand(): InHand {
    return (!this.stowed && this.active?.inHand?.()) || EMPTY;
  }

  select(i: number): void {
    if (i === this.index || !this.tools[i]) return;
    if (!this.stowed) this.active?.onUnequip?.();
    this.index = i;
    if (!this.stowed) this.active?.onEquip?.();
    if (this.active) this.ctx.events.emit('equip', { key: this.active.id });
  }

  update(dt: number): void {
    const swim = this.ctx.player.waterMode === 'swimming';
    if (swim !== this.stowed) {
      this.stowed = swim;
      if (swim) this.active?.onUnequip?.();
      else this.active?.onEquip?.();
    }
    SLOT_ACTIONS.forEach((a, i) => {
      if (this.ctx.input.pressed(a)) this.select(i);
    });
    for (const t of this.tools) t.tick?.(dt);
    if (!this.stowed) this.active?.update(dt);
  }
}
