import * as THREE from 'three';
import { color } from '@/content/palette';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { RigBuilder, unitGeometry } from './figure';

/** The carried brush points along -Z, with its grip at the origin. */
export function buildBrush(builder: RigBuilder, node: THREE.Object3D): void {
  const shaft = builder.limb(node, 0, 0, 0.1, 0.42, 0.016, 'wood');
  shaft.joint.rotation.x = Math.PI / 2;
  builder.blob(node, 0, 0, -0.33, 0.024, 0.024, 0.03, 'metal');
  builder.blob(node, 0, 0, -0.42, 0.036, 0.034, 0.085, 'bristle');
}

const wood = color('brown');
const metal = color('charcoal');

export function brushPaint(slot: string, accent: number): number {
  return slot === 'wood' ? wood : slot === 'metal' ? metal : accent;
}

/** Bake the world-space prop into a mesh for the first-person material. */
export function appendBrush(geometry: GeometryBuilder, accent: number, transform: THREE.Matrix4): void {
  const builder = new RigBuilder();
  const root = new THREE.Object3D();
  buildBrush(builder, root);
  root.updateMatrixWorld(true);
  const matrix = new THREE.Matrix4();
  for (const part of builder.parts) {
    const source = unitGeometry(part.shape);
    geometry.meshSmooth(
      source,
      matrix.multiplyMatrices(transform, part.node.matrixWorld),
      brushPaint(part.paint, accent),
      ALWAYS_COLOR,
    );
    source.dispose();
  }
}
