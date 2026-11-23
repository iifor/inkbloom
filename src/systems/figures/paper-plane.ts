import * as THREE from 'three';
import { color, type ColorKey } from '@/content/palette';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import type { PlayerPose } from './player-pose';

type Point = readonly [number, number, number];

/** Folded sheet, with coloured reverse faces; no transparent cards or per-frame geometry. */
export function paperPlaneGeometry(): THREE.BufferGeometry {
  const g = new GeometryBuilder();
  const face = (points: readonly Point[], paint: ColorKey, back: ColorKey = 'sand'): void => {
    const vertices = points.map((p) => new THREE.Vector3(...p));
    const normal = new THREE.Vector3()
      .subVectors(vertices[1]!, vertices[0]!)
      .cross(new THREE.Vector3().subVectors(vertices[2]!, vertices[0]!));
    if (normal.y < 0) vertices.reverse();
    const a = vertices[0]!;
    for (let i = 1; i < vertices.length - 1; i++) {
      const b = vertices[i]!;
      const c = vertices[i + 1]!;
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      g.quad(a, b, c, c, n, color(paint), ALWAYS_COLOR);
      g.quad(c, b, a, a, n.clone().negate(), color(back), ALWAYS_COLOR);
    }
  };
  const nose: Point = [0, 0.62, -2.9];
  for (const side of [-1, 1]) {
    // Broad delta wing, folded leading edge and raised central spine.
    const tip: Point = [side * 2.65, 0.58, 1.18];
    const shoulder: Point = [side * 0.23, 0.48, 0.95];
    face([nose, tip, shoulder], 'cream');
    face([nose, [side * 2.35, 0.69, 0.97], tip], 'limewash', 'cream');
    face([nose, shoulder, [0, 0.84, 1.3]], 'cream', 'limewash');
    // Thin folded trailing hem: a visible paper edge, not a thick foam wing.
    face([tip, [side * 2.62, 0.54, 1.21], [side * 0.23, 0.44, 0.99], shoulder], 'sand');
    // A restrained blue stripe follows the wing, with a red diamond seal.
    face(
      [
        [side * 1.53, 0.562, 0.53],
        [side * 1.7, 0.568, 0.56],
        [side * 0.62, 0.574, -1.46],
        [side * 0.57, 0.575, -1.43],
      ],
      'teal',
      'teal',
    );
    face(
      [
        [side * 1.65, 0.57, 0.38],
        [side * 1.82, 0.576, 0.62],
        [side * 1.65, 0.571, 0.8],
        [side * 1.48, 0.566, 0.58],
      ],
      'red',
      'red',
    );
  }
  // One central keel; duplicating this in both mirrored halves causes depth fighting.
  face([nose, [0, 0.13, 0.95], [0, 0.84, 1.3]], 'sand', 'limewash');
  // A folded saddle supports the hips above the wings, leaving the deck ahead clear for boots.
  const left: Point = [-0.19, 1.19, -0.26];
  const right: Point = [0.19, 1.19, -0.26];
  const backLeft: Point = [-0.16, 1.19, 0.10];
  const backRight: Point = [0.16, 1.19, 0.10];
  face([left, right, backRight, backLeft], 'sand');
  const baseLeft: Point = [-0.26, 0.52, -0.29];
  const baseRight: Point = [0.26, 0.52, -0.29];
  const baseBackLeft: Point = [-0.22, 0.52, 0.22];
  const baseBackRight: Point = [0.22, 0.52, 0.22];
  face([left, baseLeft, baseBackLeft, backLeft], 'limewash');
  face([right, baseRight, baseBackRight, backRight], 'limewash');
  face([left, right, baseRight, baseLeft], 'cream');
  face([backLeft, backRight, baseBackRight, baseBackLeft], 'cream');
  const geometry = g.build();
  // Put the folded deck below the pilot's boots instead of cutting across them.
  geometry.translate(0, -0.24, 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** A whole flight vehicle is one instanced draw, shared across the scene's players. */
export class PaperPlanes {
  private mesh: THREE.InstancedMesh | null = null;
  private readonly at = new THREE.Object3D();
  private used = 0;

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly material: THREE.Material,
  ) {}

  begin(): void {
    this.used = 0;
  }

  draw(p: PlayerPose): void {
    const f = p.flight;
    if (!f || f.blend <= 0 || p.dying >= 0) return;
    if (!this.mesh || this.used >= this.mesh.instanceMatrix.count) {
      const old = this.mesh;
      this.mesh = new THREE.InstancedMesh(
        old?.geometry ?? paperPlaneGeometry(),
        this.material,
        (old?.instanceMatrix.count ?? 4) * 2,
      );
      this.mesh.name = 'paper-plane-vehicles';
      this.mesh.frustumCulled = false;
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (old) {
        this.mesh.instanceMatrix.array.set(old.instanceMatrix.array);
        old.removeFromParent();
        old.dispose();
      }
      this.parent.add(this.mesh);
    }
    const unfold = f.blend * f.blend * (3 - 2 * f.blend);
    this.at.position.set(p.x, p.y, p.z);
    this.at.rotation.set(f.pitch * f.blend, p.yaw, f.bank * f.blend, 'YXZ');
    this.at.scale.set(unfold, unfold, unfold);
    this.at.updateMatrix();
    this.mesh.setMatrixAt(this.used++, this.at.matrix);
  }

  end(): void {
    if (!this.mesh) return;
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh?.removeFromParent();
    this.mesh?.geometry.dispose();
    this.mesh?.dispose();
  }
}
