import type * as THREE from 'three';

/** Remove a subtree and free its GPU resources. Call only when nothing else uses them. */
export function disposeTree(root: THREE.Object3D, materials = true): void {
  const resources = new Set<{ dispose(): void }>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) resources.add(mesh.geometry);
    if ((object as THREE.InstancedMesh).isInstancedMesh) resources.add(object as THREE.InstancedMesh);
    if (materials && mesh.material) {
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) resources.add(m);
    }
  });
  root.removeFromParent();
  for (const r of resources) r.dispose();
}
