// Shader warm-up. A browser compiles a shader program the first time something is drawn with
// it, and that can take a few hundred milliseconds. The wilderness alone never draws some of
// the variants a city or an effect needs (instanced meshes with and without per-instance
// colour, double-sided, and their shadow-pass versions), so the first city entered or the
// first burst of colour would stall on them. Drawing one throwaway frame with a tiny mesh of
// each kind at start-up (behind the start menu) compiles them all up front. The materials are
// kept: three.js frees a program as soon as no material uses it, which would undo the work.
import * as THREE from 'three';
import { SurfaceStateTexture, makeInkMaterial } from './ink-material';
import { enableCharacterPaint } from './character-paint';
import type { InkRenderer } from './renderer';
import type { WorkProgress } from '@/game/loading';

/** A single small triangle with the attributes the ink material reads. */
function triangle(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute([0, 0, 0], 1));
  g.setAttribute('aSurface', new THREE.Float32BufferAttribute([-1, -1, -1], 1));
  g.setAttribute('aPane', new THREE.Float32BufferAttribute(new Float32Array(6), 2));
  g.setAttribute('aCharacterMaterial', new THREE.Float32BufferAttribute([0, 0, 0], 1));
  g.setAttribute('aReedRoot', new THREE.Float32BufferAttribute(new Float32Array(12), 4));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(12), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  return g;
}

/** Kept alive for the life of the page so their programs stay compiled. */
const keep: THREE.Material[] = [];

export async function warmShaders(
  renderer: InkRenderer,
  progress: WorkProgress,
  yieldFrame: () => Promise<void>,
): Promise<void> {
  const group = new THREE.Group();
  const geometry = triangle();
  const byteSkin = geometry.clone();
  byteSkin.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(new Uint8Array(12), 4));
  const materials = keep;
  const skeletons: THREE.Skeleton[] = [];
  const skinned = (material: THREE.Material): void => {
    // Imported rigs use both byte and short joint indices. ANGLE can compile a separate
    // vertex-input pipeline for each, even when the GLSL program is already linked.
    for (const source of [geometry, byteSkin]) {
      const mesh = new THREE.SkinnedMesh(source, material);
      const bone = new THREE.Bone();
      mesh.add(bone);
      const skeleton = new THREE.Skeleton([bone]);
      mesh.bind(skeleton);
      skeletons.push(skeleton);
      group.add(mesh);
    }
  };
  // just in front of the camera, so nothing culls it before it is drawn
  group.position.set(0, 0, -1);
  renderer.camera.add(group);
  // a city's surfaces read their colour state from a small texture of their own; the first
  // such texture also costs a one-off setup, so give it one here
  const state = new SurfaceStateTexture(new Uint8Array(4));
  // A summit flag can be the first cloth in view long after spawn. Compile its distinct
  // fragment shader here too, instead of pausing movement when that summit streams in.
  const cloth = makeInkMaterial({ cloth: true, side: THREE.DoubleSide });
  materials.push(cloth);
  group.add(new THREE.Mesh(geometry, cloth));
  // Imported villagers and animals use skinning even when spawn has no visible actor.
  const character = makeInkMaterial({ cloth: true });
  enableCharacterPaint(character);
  materials.push(character);
  group.add(new THREE.Mesh(geometry, character));
  skinned(character);
  const wind = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  wind.needsUpdate = true;
  const reeds = makeInkMaterial({ wind, reeds: true, side: THREE.DoubleSide });
  materials.push(reeds);
  group.add(new THREE.Mesh(geometry, reeds));
  for (const side of [THREE.FrontSide, THREE.DoubleSide]) {
    const material = makeInkMaterial({ side, state });
    materials.push(material);
    group.add(new THREE.Mesh(geometry, material));
    const instanced = new THREE.InstancedMesh(geometry, material, 1);
    instanced.setMatrixAt(0, new THREE.Matrix4());
    group.add(instanced);
    const coloured = new THREE.InstancedMesh(geometry, material, 1);
    coloured.setMatrixAt(0, new THREE.Matrix4());
    coloured.setColorAt(0, new THREE.Color(0, 0, 0));
    group.add(coloured);
    skinned(material);
  }
  for (const o of group.children) o.frustumCulled = false;
  // the camera hides itself from the shadow pass; let the warm-up show there too
  const shadowed = group.clone();
  renderer.scene.add(shadowed);
  shadowed.position.copy(renderer.camera.position);
  try {
    await renderer.prepareShaders(progress, yieldFrame);
  } finally {
    group.removeFromParent();
    shadowed.removeFromParent();
    for (const o of group.children) if (o instanceof THREE.InstancedMesh) o.dispose();
    for (const o of shadowed.children) if (o instanceof THREE.InstancedMesh) o.dispose();
    for (const skeleton of skeletons) skeleton.dispose();
    byteSkin.dispose();
    geometry.dispose();
  }
}
