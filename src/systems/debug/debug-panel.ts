// F3 panel: frame time, position, chunk, biome, collider count. F2 toggles free flight (in
// the player system). Purely diagnostic; safe to delete from a mode.
import { BIOMES } from '@/content/biomes';
import { TUNING } from '@/content/tuning';
import type { GameContext, System } from '@/game/types';

export class DebugPanel implements System {
  readonly id = 'debug';
  private readonly el: HTMLElement;
  private visible = import.meta.env.DEV;
  private frames = 0;
  private acc = 0;
  private fps = 0;

  constructor(
    private readonly ctx: GameContext,
    parent: HTMLElement,
  ) {
    this.el = document.createElement('pre');
    this.el.className = 'debug-panel';
    parent.append(this.el);
  }

  update(dt: number): void {
    if (this.ctx.input.pressed('debugPanel')) this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
    this.frames++;
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    if (!this.visible) return;
    const p = this.ctx.player.position;
    const size = TUNING.world.chunkSize;
    const scene = this.ctx.scenes.active;
    const biome = scene.ref.kind === 'wild' ? BIOMES[this.ctx.wilderness.biomeAt(p.x, p.z)]!.name : '-';
    this.el.textContent = [
      `${this.fps.toFixed(0)} fps · ${this.ctx.renderer.renderer.info.render.calls} draws · ${(this.ctx.renderer.renderer.info.render.triangles / 1000).toFixed(0)}k tris`,
      `pos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} · yaw ${this.ctx.player.yaw.toFixed(2)}`,
      `chunk ${Math.floor(p.x / size)},${Math.floor(p.z / size)} · ${biome}`,
      `scene ${scene.ref.kind === 'wild' ? 'wild' : scene.ref.id} · colliders ${scene.physics.boxCount}`,
      `${this.ctx.player.flying ? 'FLY (F2)' : 'walk (F2 fly)'} · seed ${this.ctx.state.seed}`,
    ].join('\n');
  }

  dispose(): void {
    this.el.remove();
  }
}
