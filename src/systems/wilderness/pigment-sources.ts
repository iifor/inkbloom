// Pigment sources in loaded wilderness chunks: one small mesh each, an "E 采集" interactable,
// and visibility that follows the save (hidden after harvest, back when regrown).
import * as THREE from 'three';
import { PALETTE } from '@/content/palette';
import { PIGMENT_SOURCES } from '@/content/pigment-sources';
import { TUNING } from '@/content/tuning';
import type { GameContext } from '@/game/types';
import { sourceReady } from '@/world/state';
import type { PigmentSource } from '@/world/wilderness/sources';
import { buildSource } from './build-source';

interface Shown {
  readonly src: PigmentSource;
  readonly mesh: THREE.Mesh;
}

export class WildSources {
  private readonly shown = new Map<string, Shown>();
  private checkT = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly material: THREE.Material,
    private readonly root: THREE.Object3D,
  ) {}

  /** Show a chunk's sources. Returns a function that removes them again. */
  add(sources: readonly PigmentSource[]): () => void {
    const releases = sources.map((src) => {
      const mesh = new THREE.Mesh(buildSource(src), this.material);
      mesh.visible = sourceReady(this.ctx.state, src.id);
      this.root.add(mesh);
      this.shown.set(src.id, { src, mesh });
      const off = this.ctx.interactions.add({
        scene: 'wild',
        pos: new THREE.Vector3(src.x, src.y, src.z),
        radius: 3.5,
        label: () => this.label(src),
        activate: () => this.harvest(src),
      });
      return () => {
        off();
        mesh.geometry.dispose();
        mesh.removeFromParent();
        this.shown.delete(src.id);
      };
    });
    return () => releases.forEach((r) => r());
  }

  private label(src: PigmentSource): string {
    const def = PIGMENT_SOURCES[src.kind]!;
    const name = `${PALETTE[src.color]!.name}${def.name}`;
    if (!sourceReady(this.ctx.state, src.id)) {
      const left =
        TUNING.economy.regrowSeconds - (this.ctx.state.clock - this.ctx.state.harvested.get(src.id)!);
      return `${name}：${Math.ceil(left / 60)} 分钟后长回来`;
    }
    return `E 采集${name}（${PALETTE[src.color]!.name}颜料 +${src.amount}，墨 +${src.ink}）`;
  }

  private harvest(src: PigmentSource): void {
    const knew = this.ctx.state.unlocked.includes(src.color);
    const r = this.ctx.apply({ kind: 'harvest', source: src.id });
    if (!r.ok) {
      this.ctx.events.emit('toast', { text: r.reason });
      return;
    }
    const name = PALETTE[src.color]!.name;
    this.ctx.events.emit('toast', { text: `${name}颜料 +${src.amount}　墨 +${src.ink}` });
    if (!knew && this.ctx.state.unlocked.includes(src.color))
      this.ctx.events.emit('toast', { text: `新颜色：${name}！涂鸦时可以用了`, seconds: 4 });
    this.refresh();
  }

  /** Re-check regrowth about once a second. */
  update(dt: number): void {
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 1;
    this.refresh();
  }

  private refresh(): void {
    for (const { src, mesh } of this.shown.values()) mesh.visible = sourceReady(this.ctx.state, src.id);
  }
}
