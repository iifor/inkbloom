import * as THREE from 'three';

/** A triangular sheet stretched between the stump and two points on the ground. */
export function spiderWeb(
  stump: { x: number; z: number },
  foot: THREE.Vector3,
  ground: (x: number, z: number) => number,
) {
  const spread = 0.54;
  const tip = new THREE.Vector3(
    stump.x + (foot.x - stump.x) * 0.24,
    ground(stump.x, stump.z) + (foot.x - stump.x) * 0.53,
    stump.z,
  );
  const edge = [-spread, spread].map(
    (d) => new THREE.Vector3(foot.x + 0.26, ground(foot.x + 0.26, foot.z + d) + 0.03, foot.z + d),
  );
  const hub = tip
    .clone()
    .add(edge[0]!)
    .add(edge[1]!)
    .multiplyScalar(1 / 3);
  const frame = [tip, ...edge],
    spokes: THREE.Vector3[] = [],
    lines: THREE.Vector3[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) spokes.push(frame[i]!.clone().lerp(frame[(i + 1) % 3]!, j / 3));
  for (let i = 0; i < spokes.length; i++) {
    lines.push(hub, spokes[i]!);
    for (const r of [0.3, 0.6, 0.9])
      lines.push(hub.clone().lerp(spokes[i]!, r), hub.clone().lerp(spokes[(i + 1) % spokes.length]!, r));
  }
  const web = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(lines),
    new THREE.LineBasicMaterial({
      color: 0xd5d9c6,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
  );
  return web;
}
