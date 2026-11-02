// Accumulates triangles with the attributes the ink material expects (position, normal,
// aColor, aSurface) and produces one merged BufferGeometry. Every static mesh in the game is
// built this way so a whole chunk or city is a single draw call.
import * as THREE from 'three';

/** aSurface value for geometry whose colour follows the scene/derived saturation. */
export const NO_SURFACE = -1;

export type BoxFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export type PerFace<T> = Partial<Record<BoxFace, T>>;

export class GeometryBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly srf: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  private vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    color: number,
    surface: number,
  ): void {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.col.push(color);
    this.srf.push(surface);
  }

  /** Quad from four corners in counter-clockwise order seen from the normal side. */
  quad(
    a: THREE.Vector3Like,
    b: THREE.Vector3Like,
    c: THREE.Vector3Like,
    d: THREE.Vector3Like,
    normal: THREE.Vector3Like,
    color: number,
    surface = NO_SURFACE,
  ): void {
    for (const p of [a, b, c, a, c, d])
      this.vertex(p.x, p.y, p.z, normal.x, normal.y, normal.z, color, surface);
  }

  /** Axis-aligned box. Faces missing from `colors` are skipped. */
  box(
    min: THREE.Vector3Like,
    max: THREE.Vector3Like,
    colors: PerFace<number>,
    surfaces: PerFace<number> = {},
  ): void {
    const [x0, y0, z0] = [min.x, min.y, min.z];
    const [x1, y1, z1] = [max.x, max.y, max.z];
    const v = (x: number, y: number, z: number): THREE.Vector3Like => ({ x, y, z });
    const face = (
      f: BoxFace,
      a: THREE.Vector3Like,
      b: THREE.Vector3Like,
      c: THREE.Vector3Like,
      d: THREE.Vector3Like,
      n: THREE.Vector3Like,
    ): void => {
      const color = colors[f];
      if (color !== undefined) this.quad(a, b, c, d, n, color, surfaces[f] ?? NO_SURFACE);
    };
    face('px', v(x1, y0, z1), v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(1, 0, 0));
    face('nx', v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0), v(-1, 0, 0));
    face('py', v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0), v(x0, y1, z0), v(0, 1, 0));
    face('ny', v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1), v(0, -1, 0));
    face('pz', v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), v(0, 0, 1));
    face('nz', v(x1, y0, z0), v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), v(0, 0, -1));
  }

  /** Append another geometry (flat-shaded), transformed, in one colour. */
  mesh(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number, surface = NO_SURFACE): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.getAttribute('position');
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i).applyMatrix4(matrix);
      b.fromBufferAttribute(p, i + 1).applyMatrix4(matrix);
      c.fromBufferAttribute(p, i + 2).applyMatrix4(matrix);
      n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
      for (const v of [a, b, c]) this.vertex(v.x, v.y, v.z, n.x, n.y, n.z, color, surface);
    }
    if (g !== geometry) g.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 1));
    g.setAttribute('aSurface', new THREE.Float32BufferAttribute(this.srf, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
