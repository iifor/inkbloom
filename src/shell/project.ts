// World points to screen pixels, for labels drawn over the canvas (damage numbers, monster
// health bars, players' names).
import * as THREE from 'three';
import type { InkRenderer } from '@/engine/render/renderer';

const v = new THREE.Vector3();

/** A world point as CSS pixels on the canvas, or null when behind the camera or beyond `maxDist`. */
export function projectToScreen(
  renderer: InkRenderer,
  p: THREE.Vector3,
  maxDist: number,
): { x: number; y: number } | null {
  const cam = renderer.camera;
  if (p.distanceTo(cam.position) > maxDist) return null;
  v.copy(p).project(cam);
  if (v.z > 1 || v.z < -1) return null;
  const el = renderer.renderer.domElement;
  return { x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * el.clientHeight };
}
