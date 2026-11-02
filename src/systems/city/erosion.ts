// Slow erosion: a cleared block next to a drained one loses colour bit by bit, starting at the
// drained side. Runs on the world clock while the player is in the city.
import { TUNING } from '@/content/tuning';
import type { GameContext } from '@/game/types';
import { drainedSides, erodingBlocks, nextToErode, type BlockState } from '@/world/city/blocks';
import type { CityLayout } from '@/world/city/layout';

export interface ErosionHost {
  blocks(): BlockState[];
  surfaceCount(chunk: number): number;
}

export class Erosion {
  /** Fractional surfaces owed per block. */
  private readonly owed = new Map<number, number>();

  constructor(
    private readonly ctx: GameContext,
    private readonly layout: CityLayout,
    private readonly states: Uint8Array,
    private readonly host: ErosionHost,
  ) {}

  update(dt: number): void {
    const blocks = this.host.blocks();
    const eroding = erodingBlocks(blocks);
    for (const c of [...this.owed.keys()]) if (!eroding.includes(c)) this.owed.delete(c);
    for (const c of eroding) {
      let owed =
        (this.owed.get(c) ?? 0) + (this.host.surfaceCount(c) * TUNING.blocks.erosionPerMinute * dt) / 60;
      const from = drainedSides(blocks, c)[0]!;
      while (owed >= 1) {
        const s = nextToErode(this.states, this.layout.surfaces, c, from, this.layout);
        if (s < 0) break;
        this.ctx.apply({ kind: 'drain', city: this.layout.id, surface: s });
        owed -= 1;
      }
      this.owed.set(c, owed);
    }
  }
}
