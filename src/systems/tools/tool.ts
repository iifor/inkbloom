// Tools replace fixed classes: the player carries a belt of tools and switches freely.
// To add a tool (weapon, glider, marker...), implement Tool and add it to the belt in the mode.
import type { GameContext, System } from '@/game/types';

export interface ToolHud {
  /** Short lines shown under the slot bar. */
  readonly lines: readonly string[];
  /** 0..1 progress of the current action, or null for none. */
  readonly progress: number | null;
  /** Palette index to show as the active swatch, or null. */
  readonly swatch: number | null;
}

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

  select(i: number): void {
    if (i === this.index || !this.tools[i]) return;
    if (!this.stowed) this.active?.onUnequip?.();
    this.index = i;
    if (!this.stowed) this.active?.onEquip?.();
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
