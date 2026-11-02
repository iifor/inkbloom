// Debounced autosave: after any accepted patch, on scene changes, and periodically for the
// player's position. Saving never blocks the frame.
import { TUNING } from '@/content/tuning';
import type { GameContext, System } from '@/game/types';
import type { WorldStore } from '@/world/store';

export class SaveSystem implements System {
  readonly id = 'save';
  private dirtyAt: number | null = null;
  private positionT = 10;
  private saving = false;
  private readonly release: (() => void)[] = [];

  constructor(
    private readonly ctx: GameContext,
    private readonly store: WorldStore,
  ) {
    this.release.push(ctx.events.on('patch:applied', () => this.markDirty()));
    this.release.push(ctx.events.on('scene:entered', () => this.markDirty()));
  }

  markDirty(): void {
    this.dirtyAt ??= performance.now();
  }

  update(dt: number): void {
    this.positionT -= dt;
    if (this.positionT <= 0) {
      this.positionT = 10;
      this.markDirty();
    }
    if (this.dirtyAt !== null && performance.now() - this.dirtyAt > TUNING.save.debounceMs) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.dirtyAt = null;
    const { player, scenes, state } = this.ctx;
    state.player = {
      scene: scenes.active.ref,
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      yaw: player.yaw,
    };
    try {
      await this.store.save(state);
    } catch (e) {
      this.ctx.events.emit('toast', { text: `保存失败：${(e as Error).message}`, seconds: 6 });
    } finally {
      this.saving = false;
    }
  }

  dispose(): void {
    for (const r of this.release) r();
  }
}
