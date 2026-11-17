// Ink stains on a city's roads. Walk over one to soak it up (a `collect` patch). All stains are
// one instanced mesh; a collected stain is hidden by scaling its instance to zero.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import type { GameContext } from '@/game/types';
import { type CityLayout, groundAt } from '@/world/city/layout';

/** A stain lies on the slope under it, just over the street's paving. */
function stainPose(
  l: CityLayout,
  s: { x: number; z: number },
): { at: THREE.Vector3; tilt: THREE.Quaternion } {
  const g = (x: number, z: number): number => groundAt(l, x, z);
  const normal = new THREE.Vector3(
    g(s.x - 1, s.z) - g(s.x + 1, s.z),
    2,
    g(s.x, s.z - 1) - g(s.x, s.z + 1),
  ).normalize();
  return {
    at: new THREE.Vector3(s.x, g(s.x, s.z) + 0.14, s.z),
    tilt: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal),
  };
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class InkStains {
  private readonly mesh: THREE.InstancedMesh;
  private readonly release: () => void;

  constructor(
    private readonly ctx: GameContext,
    private readonly layout: CityLayout,
    private readonly collected: Uint8Array,
    material: THREE.Material,
    root: THREE.Object3D,
  ) {
    const g = new GeometryBuilder();
    g.mesh(new THREE.CylinderGeometry(1, 1, 0.04, 9), new THREE.Matrix4(), color('charcoal'), ALWAYS_COLOR);
    this.mesh = new THREE.InstancedMesh(g.build(), material, layout.stains.length);
    const m = new THREE.Matrix4();
    layout.stains.forEach((s, i) => {
      const { at, tilt } = stainPose(layout, s);
      m.compose(
        at,
        tilt.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.x)),
        new THREE.Vector3(s.size, 1, s.size * 0.8),
      );
      this.mesh.setMatrixAt(i, collected[i] ? HIDDEN : m);
    });
    this.mesh.frustumCulled = false;
    root.add(this.mesh);
    this.release = ctx.events.on('patch:applied', ({ patch }) => {
      if (patch.kind !== 'collect' || patch.city !== layout.id) return;
      this.mesh.setMatrixAt(patch.stain, HIDDEN);
      this.mesh.instanceMatrix.needsUpdate = true;
    });
  }

  isCollected(i: number): boolean {
    return this.collected[i] === 1;
  }

  remaining(chunk?: number): number {
    let n = 0;
    this.layout.stains.forEach((s, i) => {
      if (!this.collected[i] && (chunk === undefined || s.chunk === chunk)) n++;
    });
    return n;
  }

  update(): void {
    const p = this.ctx.player.position;
    if (p.y - groundAt(this.layout, p.x, p.z) > 2.5) return;
    const r = TUNING.economy.stainPickupRadius;
    this.layout.stains.forEach((s, i) => {
      if (this.collected[i]) return;
      if (Math.abs(s.x - p.x) > r + s.size || Math.abs(s.z - p.z) > r + s.size) return;
      if (Math.hypot(s.x - p.x, s.z - p.z) > r + s.size * 0.5) return;
      // the ink count on the HUD ticks up: no message
      this.ctx.apply({ kind: 'collect', city: this.layout.id, stain: i });
    });
  }

  dispose(): void {
    this.release();
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}
