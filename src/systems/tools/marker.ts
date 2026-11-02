// Ink marks: plant up to three in the wilderness (left click, costs generic pigment), pull the
// nearest back with right click. Marks join restored cities on the travel ring (F).
import { TUNING } from '@/content/tuning';
import type { GameContext } from '@/game/types';
import type { Tool, ToolHud } from './tool';

export class Marker implements Tool {
  readonly id = 'marker';
  readonly name = '墨迹标记';

  constructor(private readonly ctx: GameContext) {}

  update(): void {
    const { input, scenes, player, state } = this.ctx;
    if (!this.ctx.combat.alive) return;
    if (input.pressed('use')) {
      if (scenes.active.ref.kind !== 'wild') {
        this.ctx.events.emit('toast', { text: '墨迹标记只能放在野外' });
        return;
      }
      const p = player.position;
      const r = this.ctx.apply({ kind: 'mark', x: p.x, y: p.y, z: p.z });
      this.ctx.events.emit('toast', {
        text: r.ok
          ? `放下了墨迹标记（${state.marks.length}/${TUNING.marks.max}）：在已恢复的城或标记旁按 F 传送`
          : r.reason,
      });
    }
    if (input.pressed('alt')) {
      const p = player.position;
      const near = state.marks
        .map((m) => ({ m, d: Math.hypot(m.x - p.x, m.z - p.z) }))
        .sort((a, b) => a.d - b.d)[0];
      if (!near || near.d > 8 || scenes.active.ref.kind !== 'wild') {
        this.ctx.events.emit('toast', { text: '附近没有墨迹标记' });
        return;
      }
      if (this.ctx.apply({ kind: 'unmark', id: near.m.id }).ok)
        this.ctx.events.emit('toast', { text: '收回了墨迹标记（颜料不退）' });
    }
  }

  hud(): ToolHud {
    const n = this.ctx.state.marks.length;
    return {
      lines: [
        `墨迹标记 ${n} / ${TUNING.marks.max}`,
        `左键放置（${TUNING.marks.cost} 通用颜料）· 右键收回附近的`,
      ],
      progress: null,
      swatch: null,
    };
  }
}
