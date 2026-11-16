// The picture on a grass card: dozens of thin curved stalks, a few of them carrying seed
// heads, painted once at start-up onto a canvas (no image files). Red holds light and dark
// (stalks dark at the root, pale at the tip, seed heads palest); alpha cuts the card out.
// Colour comes from the palette per clump, so one picture serves every season and biome.
import * as THREE from 'three';

const SIZE = 256;

/** A small deterministic random sequence, so every run paints the same card. */
function sequence(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function makeGrassCard(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d')!;
  const rand = sequence(0x6b1d);
  g.clearRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 70; i++) {
    const x0 = SIZE * (0.06 + 0.88 * rand());
    // most stalks are short; a few stand up tall
    const tall = rand() < 0.25;
    const h = SIZE * (tall ? 0.7 + 0.28 * rand() : 0.3 + 0.35 * rand());
    const lean = (rand() - 0.5) * SIZE * 0.35;
    const w = SIZE * (0.008 + 0.01 * rand());
    const top = { x: x0 + lean, y: SIZE - h };
    const bend = { x: x0 + lean * 0.2, y: SIZE - h * 0.55 };
    const shade = g.createLinearGradient(0, SIZE, 0, top.y);
    const base = 40 + 30 * rand();
    shade.addColorStop(0, `rgb(${base},${base},${base})`);
    shade.addColorStop(1, `rgb(${200 + 40 * rand()},0,0)`);
    g.fillStyle = shade;
    // a tapering blade: wide at the root, a point at the tip
    g.beginPath();
    g.moveTo(x0 - w, SIZE);
    g.quadraticCurveTo(bend.x - w * 0.6, bend.y, top.x, top.y);
    g.quadraticCurveTo(bend.x + w * 0.6, bend.y, x0 + w, SIZE);
    g.closePath();
    g.fill();
    if (tall && rand() < 0.7) {
      // a seed head: a pale feathery oval at the tip
      g.fillStyle = `rgb(${235 + 20 * rand()},0,0)`;
      g.beginPath();
      g.ellipse(
        top.x,
        top.y + SIZE * 0.035,
        SIZE * 0.012,
        SIZE * 0.045,
        Math.atan2(lean, h) * 0.8,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A clump: three cards crossed like an asterisk, each a quad `width` wide and `height` tall
 * standing on the ground, with the attributes the ink material expects plus uv. Normals point
 * up so a clump shades like the meadow it grows from.
 */
export function makeCardClump(width = 1, height = 0.8): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const dx = (Math.cos(a) * width) / 2;
    const dz = (Math.sin(a) * width) / 2;
    const corners: [number, number, number, number, number][] = [
      [-dx, 0, -dz, 0, 0],
      [dx, 0, dz, 1, 0],
      [dx, height, dz, 1, 1],
      [-dx, height, -dz, 0, 1],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [x, y, z, u, v] = corners[i]!;
      pos.push(x, y, z);
      nor.push(0, 1, 0);
      uv.push(u, v);
    }
  }
  const n = pos.length / 3;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(new Array<number>(n).fill(0), 1));
  // -1: colour follows the land around cities, like the ground
  geo.setAttribute('aSurface', new THREE.Float32BufferAttribute(new Array<number>(n).fill(-1), 1));
  return geo;
}
