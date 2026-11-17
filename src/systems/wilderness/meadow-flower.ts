import * as THREE from 'three';
import { color, MAX_COLORS } from '@/content/palette';
import { GeometryBuilder, NO_SURFACE } from '@/engine/render/geometry-builder';

// One indexed flower for the whole instanced field. The five petals overlap only
// at the throat, so each rounded blade reads separately even looking straight down.
// `segments` rounds each petal: a flower sea, thousands at once, makes do with fewer.
export function meadowFlower(segments = 12): THREE.BufferGeometry {
  const b = new GeometryBuilder();
  const pose = new THREE.Matrix4();
  const headX = 0.025;
  const headY = 0.99;
  const petal = new THREE.CircleGeometry(1, segments);
  const positions = petal.getAttribute('position');
  const wash: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const t = (1 + positions.getX(i)) * 0.5;
    const side = positions.getY(i);
    const width = 0.032 * (0.52 + 0.75 * t);
    // Raised edges, a dipped midrib and broader outer half, like a violet petal.
    const curl = 0.08 * t - 0.036 * t * t + 0.035 * side * side;
    positions.setXYZ(i, 0.073 * t, curl - (i === 0 ? 0.018 : 0), -side * width);
    wash.push(0.12 + 0.7 * t + 0.12 * side * side - (i === 0 ? 0.14 : 0));
  }
  petal.computeVertexNormals();
  // The upper pair stands tall, the side pair opens out, the broad lower lip hangs forward.
  for (const [yaw, length, width, lift, overlap] of [
    [0.92, 0.99, 1.12, 1.85, 0],
    [2.2, 1.03, 1.1, 1.67, 0.004],
    [-0.16, 0.89, 0.92, 0.85, 0.008],
    [3.43, 0.91, 0.96, 0.95, 0.011],
    [-1.58, 1.02, 1.18, 0.55, 0.016],
  ] as const) {
    pose.makeRotationY(yaw).scale(new THREE.Vector3(length, lift, width));
    pose.setPosition(headX, headY + overlap, 0);
    b.meshSmooth(petal, pose, 2 * MAX_COLORS, NO_SURFACE, wash);
  }
  petal.dispose();

  const stalk = new THREE.CylinderGeometry(0.003, 0.004, 1, 3, 1, true);
  pose.makeRotationZ(-0.025).setPosition(0.0125, 0.49, 0);
  b.meshSmooth(stalk, pose, color('sprout'));
  stalk.dispose();
  const calyx = new THREE.ConeGeometry(0.016, 0.038, 5, 1, true);
  pose.makeRotationZ(Math.PI).setPosition(headX, headY - 0.013, 0);
  b.meshSmooth(calyx, pose, color('green'));
  calyx.dispose();
  const dome = new THREE.SphereGeometry(1, 6, 2);
  pose.makeScale(0.012, 0.018, 0.009).setPosition(headX, headY + 0.026, 0);
  b.meshSmooth(dome, pose, color('yellow'));
  dome.dispose();
  return b.build();
}
