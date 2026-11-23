// Ink marks in the wilderness: a tall ink pillar each, with an F prompt to travel onwards.
// Rebuilt whenever a mark is planted or pulled back.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { splatGeometry } from '@/engine/render/soft-shapes';
import type { GameContext, InteractionAction } from '@/game/types';
import { hashString } from '@/world/math/hash';

export class WildMarks {
  private mesh: THREE.Mesh | null = null;
  private release: (() => void)[] = [];
  private readonly off: () => void;

  constructor(
    private readonly ctx: GameContext,
    private readonly material: THREE.Material,
    private readonly root: THREE.Object3D,
  ) {
    this.off = ctx.events.on('patch:applied', ({ patch }) => {
      if (patch.kind === 'mark' || patch.kind === 'unmark') this.rebuild();
    });
    this.rebuild();
  }

  private rebuild(): void {
    this.clear();
    const ctx = this.ctx;
    const marks = ctx.state.marks;
    if (!marks.length) return;
    const g = new GeometryBuilder();
    const m = new THREE.Matrix4();
    for (const k of marks) {
      g.meshSmooth(
        new THREE.CylinderGeometry(0.25, 0.6, 5, 16),
        m.makeTranslation(k.x, k.y + 2.5, k.z),
        color('purple'),
        ALWAYS_COLOR,
      );
      g.meshSmooth(
        splatGeometry(hashString(k.id), 0.05),
        m.makeScale(1.4, 1, 1.4).setPosition(k.x, k.y + 0.03, k.z),
        color('charcoal'),
        ALWAYS_COLOR,
      );
      let travel: InteractionAction | undefined;
      this.release.push(
        ctx.interactions.add({
          scene: 'wild',
          pos: new THREE.Vector3(k.x, k.y, k.z),
          radius: 3,
          label: () => `墨迹标记 ${k.id.slice(1)}`,
          activate: () => {},
          // Saved marks are built before the scene manager is assigned. Resolve the
          // action on first use and keep it for the whole hold-to-travel interaction.
          get alt() {
            return (travel ??= ctx.scenes.travelAction(k.id));
          },
        }),
      );
    }
    this.mesh = new THREE.Mesh(g.build(), this.material);
    this.root.add(this.mesh);
  }

  private clear(): void {
    for (const r of this.release) r();
    this.release = [];
    this.mesh?.geometry.dispose();
    this.mesh?.removeFromParent();
    this.mesh = null;
  }

  dispose(): void {
    this.off();
    this.clear();
  }
}
