// A repeating brush sheet. Red holds broad leaves, green holds cedar sprays, blue holds washes.
// Both sample as linear values so the season and the scene's light supply the colour.
import * as THREE from 'three';

export function makeCanopyBrush(): THREE.CanvasTexture {
  const size = 384;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const sheet = g.createImageData(size, size);
  let state = 0x997fac;
  const rand = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (const channel of [0, 1, 2]) {
    g.fillStyle = 'rgb(116,116,116)';
    g.fillRect(0, 0, size, size);
    // Brush in little families; each spray shares a gesture and a pool of pigment.
    const groups = channel === 1 ? 148 : 98;
    for (let group = 0; group < groups; group++) {
      const x = rand() * size,
        y = rand() * size;
      const direction = (rand() - 0.5) * (channel ? 1.4 : 2.8) + (rand() < 0.5 ? Math.PI : 0);
      const value = 42 + 138 * rand();
      const reach = 18 + 26 * rand();
      for (let j = 0; j < 12; j++) {
        const side = j % 2 ? 1 : -1;
        const t = j / 12;
        const u = (t - 0.5) * reach;
        const v = side * ((channel === 1 ? 0.7 : 3.5) + 4.2 * rand());
        const cx = x + u * Math.cos(direction) - v * Math.sin(direction);
        const cy = y + u * Math.sin(direction) + v * Math.cos(direction);
        const theta = direction + side * (0.3 + 0.65 * (1 - t) + 0.24 * rand());
        const length = (channel === 2 ? 21 : 10) + (1 - t) * 9 + 7 * rand();
        const width = (channel === 2 ? 12 : channel === 1 ? 2.2 : 4.7) * (1 + 0.55 * rand());
        const tone = Math.round(value + 44 * rand() + 18 * t);
        g.fillStyle = `rgb(${tone},${tone},${tone})`;
        // Wrap only the marks that cross a tile boundary.
        const bx = THREE.MathUtils.euclideanModulo(cx, size),
          by = THREE.MathUtils.euclideanModulo(cy, size);
        for (const ox of [0, bx < length ? size : -size]) {
          if (ox && bx >= length && bx <= size - length) continue;
          for (const oy of [0, by < length ? size : -size]) {
            if (oy && by >= length && by <= size - length) continue;
            g.setTransform(
              Math.cos(theta),
              Math.sin(theta),
              -Math.sin(theta),
              Math.cos(theta),
              bx + ox,
              by + oy,
            );
            g.beginPath();
            g.moveTo(0, 0);
            g.bezierCurveTo(0.23 * length, -width, 0.73 * length, -0.65 * width, length, -width * 0.21);
            g.quadraticCurveTo(0.55 * length, width * 0.87, 0, 0);
            g.fill();
          }
        }
      }
    }
    g.resetTransform();
    const data = g.getImageData(0, 0, size, size).data;
    for (let i = 0; i < data.length; i += 4) {
      sheet.data[i + channel] = data[i]!;
      sheet.data[i + 3] = 255;
    }
  }
  g.putImageData(sheet, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
