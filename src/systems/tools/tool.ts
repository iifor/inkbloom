// Tools replace fixed classes: the player carries a belt of tools and switches freely.
// To add a tool (weapon, glider, marker...), implement Tool and add it to the belt in the mode.
import type { GameContext, System } from '@/game/types';
import type { HeldItem } from '@/world/net/protocol';
import type { Vec3Like } from '@/engine/physics/world';

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
  /** Local brush feedback: actual surface colour and the reachable point being painted. */
  readonly paintColor?: number;
  readonly paintTarget?: Vec3Like;
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
  dispose?(): void;
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

  /** Movement modes and resting can put the tool away and free both hands. */
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
    const { player } = this.ctx;
    const stowed =
      this.ctx.combat.infected ||
      player.waterMode === 'swimming' ||
      player.gliding ||
      player.flying ||
      player.falling ||
      !!player.resting ||
      player.gettingUp === true;
    if (stowed !== this.stowed) {
      this.stowed = stowed;
      if (stowed) this.active?.onUnequip?.();
      else this.active?.onEquip?.();
    }
    SLOT_ACTIONS.forEach((a, i) => {
      if (this.ctx.input.pressed(a)) this.select(i);
    });
    for (const t of this.tools) t.tick?.(dt);
    if (!this.stowed) this.active?.update(dt);
  }

  dispose(): void {
    for (const tool of this.tools) tool.dispose?.();
  }
}
