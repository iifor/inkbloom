// A field stone: a rounded lump, flatter on one side, its surface dented and bulged a little,
// with smooth normals so it reads as weathered stone under the brush rather than a cut gem.
// One shape, scaled and turned per stone by its builder, keeps the meshes small.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function makeBoulder(): THREE.BufferGeometry {
  const g = mergeVertices(
    new THREE.IcosahedronGeometry(1, 1).deleteAttribute('normal').deleteAttribute('uv'),
  );
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // a few broad bulges and dents round it, the underside flattened where it sits
    const bump =
      1 +
      0.13 * Math.sin(v.x * 3.1 + v.y * 1.7) +
      0.09 * Math.sin(v.z * 4.3 - v.x * 2.2) +
      0.05 * Math.sin(v.y * 7.1 + v.z * 5.3);
    v.multiplyScalar(bump);
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** The shared stone: about a unit across, sitting on its flat side at y ≈ -0.4. */
export const BOULDER = makeBoulder();

function makeSlab(): THREE.BufferGeometry {
  const g = mergeVertices(
    new THREE.BoxGeometry(1, 1, 1, 3, 5, 3).deleteAttribute('normal').deleteAttribute('uv'),
  );
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // weathered: the faces dented and bulged, the top worn round and a little narrower, the
    // corners knocked off, so it stands like an old standing stone and not a cut block
    const dent = 0.05 * Math.sin(v.x * 9.1 + v.y * 4.3) + 0.04 * Math.sin(v.z * 7.7 - v.y * 6.1);
    const top = Math.max(0, v.y - 0.15) / 0.35;
    const narrow = 1 - 0.18 * top - 0.12 * top * top;
    const corner = Math.abs(v.x) > 0.45 && Math.abs(v.z) > 0.45 ? 0.88 : 1;
    v.x *= (narrow + dent) * corner;
    v.z *= (narrow - dent) * corner;
    if (v.y > 0.45) v.y -= 0.08 * (Math.abs(v.x) + Math.abs(v.z));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A worn standing stone or block: a unit box (-0.5..0.5) with dented faces and a worn top,
 * scaled to size by its builder. */
export const SLAB = makeSlab();
