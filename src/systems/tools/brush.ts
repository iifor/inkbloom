// The brush. Restore mode returns a surface to its original colour with generic pigment;
// graffiti mode paints a chosen colour with that colour's pigment. Hold the use button on a
// surface for secondsPerSurface; switching target resets progress.
import { PALETTE } from '@/content/palette';
import { BRUSH_TIERS } from '@/content/brush-tiers';
import { surfaceAt } from '@/engine/physics/world';
import type { GameContext } from '@/game/types';
import { standingMonsters } from '@/world/city/features';
import { stats } from '@/world/progression';
import { ORIGINAL, graffiti, surfaceCost } from '@/world/paint/surfaces';
import type { Tool, ToolHud } from './tool';

export type BrushMode = 'restore' | 'graffiti';

const KIND_NAMES = { wall: '墙面', roof: '屋顶', door: '门', ground: '庭院' } as const;

export class Brush implements Tool {
  readonly id = 'brush';
  readonly name = '笔刷';
  mode: BrushMode = 'restore';
  colorIndex = 0;
  private target: number | null = null;
  private progress = 0;
  private hint = '';
  private stroking = false;
  private readonly hitPoint = { x: 0, y: 0, z: 0 };
  /** A stroke the save rejected; not retried until the target, mode or colour changes. */
  private blocked: { key: string; reason: string } | null = null;

  constructor(private readonly ctx: GameContext) {}

  /** Currently selected graffiti colour (palette index). */
  get color(): number {
    const u = this.ctx.state.unlocked;
    return u[((this.colorIndex % u.length) + u.length) % u.length] ?? 0;
  }

  update(dt: number): void {
    const { input, scenes, player } = this.ctx;
    if (input.pressed('alt')) this.mode = this.mode === 'restore' ? 'graffiti' : 'restore';
    const wheel = input.takeWheel();
    if (input.pressed('nextColor') || wheel > 0) this.colorIndex++;
    if (input.pressed('prevColor') || wheel < 0) this.colorIndex--;

    const scene = scenes.active;
    if (scene.ref.kind !== 'city') {
      this.target = null;
      this.progress = 0;
      this.hint = '野外的颜色会随附近城市一起恢复';
      this.setStroking(false);
      return;
    }
    const cityId = scene.ref.id;
    const layout = this.ctx.cities.byId(cityId);
    const tier = BRUSH_TIERS[this.ctx.state.inventory.brushTier] ?? BRUSH_TIERS[0];
    const hit = scene.physics.raycast(player.eye, player.forward, tier.range);
    const surface = hit ? surfaceAt(hit) : null;
    if (surface === null || !layout) {
      this.target = null;
      this.progress = 0;
      this.hint = '';
      this.setStroking(false);
      return;
    }
    const info = layout.surfaces[surface]!;
    const current = this.ctx.state.cities.get(cityId)?.states[surface] ?? 0;
    const want = this.mode === 'restore' ? ORIGINAL : graffiti(this.color);
    const cost = surfaceCost(info);
    this.hint = `${KIND_NAMES[info.kind]} · 需要 ${cost} ${this.mode === 'restore' ? '通用颜料' : PALETTE[this.color]!.name + '颜料'}`;
    if (current === want) {
      this.hint = `${KIND_NAMES[info.kind]} · 已完成`;
      this.target = null;
      this.progress = 0;
      return;
    }
    // Check what applyPatch would check before the player spends a second on the stroke.
    const saved = this.ctx.state.cities.get(cityId);
    const guards = saved ? standingMonsters(layout, saved.defeated, info.chunk).length : 0;
    if (guards) {
      this.hint = `这个街区还有 ${guards} 只墨怪，先赶走它们（按 2 换武器）`;
      this.target = null;
      this.progress = 0;
      return;
    }
    const inv = this.ctx.state.inventory;
    const have = this.mode === 'restore' ? inv.generic : (inv.colored[this.color] ?? 0);
    const key = `${cityId}:${surface}:${want}`;
    const reason =
      have < cost
        ? `颜料不足（需要 ${cost}，剩 ${have}）`
        : this.blocked?.key === key
          ? this.blocked.reason
          : null;
    if (reason) {
      this.hint = `${KIND_NAMES[info.kind]} · ${reason}`;
      this.target = null;
      this.progress = 0;
      return;
    }
    if (surface !== this.target) {
      this.target = surface;
      this.progress = 0;
    }
    if (!input.held('use')) {
      this.progress = Math.max(0, this.progress - dt * 2);
      this.setStroking(false);
      return;
    }
    this.setStroking(true);
    if (hit) Object.assign(this.hitPoint, { x: hit.point.x, y: hit.point.y, z: hit.point.z });
    this.progress += (dt * stats(this.ctx.state.growth).skill) / 100 / tier.secondsPerSurface;
    if (this.progress < 1) return;
    this.progress = 0;
    const r =
      this.mode === 'restore'
        ? this.ctx.apply({ kind: 'restore', city: cityId, surface })
        : this.ctx.apply({ kind: 'paint', city: cityId, surface, color: this.color });
    if (!r.ok) {
      this.blocked = { key, reason: r.reason };
      this.ctx.events.emit('toast', { text: r.reason });
      return;
    }
    const shown = this.mode === 'restore' ? info.color : this.color;
    this.ctx.events.emit('paint:bloom', { at: { ...this.hitPoint }, color: shown });
  }

  private setStroking(on: boolean): void {
    if (on === this.stroking) return;
    this.stroking = on;
    this.ctx.events.emit('brush:stroke', { stroking: on });
  }

  hud(): ToolHud {
    const inv = this.ctx.state.inventory;
    const modeLine =
      this.mode === 'restore'
        ? `修复 · 通用颜料 ${inv.generic}`
        : `涂鸦 · ${PALETTE[this.color]!.name} ${inv.colored[this.color] ?? 0}（Q/R 或滚轮换色）`;
    return {
      lines: [modeLine, '右键切换修复 / 涂鸦', this.hint].filter(Boolean),
      progress: this.target !== null && this.progress > 0 ? this.progress : null,
      swatch: this.mode === 'graffiti' ? this.color : null,
    };
  }

  onUnequip(): void {
    this.setStroking(false);
    this.target = null;
    this.progress = 0;
  }
}
