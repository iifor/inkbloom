// Accumulates triangles with the attributes the ink material expects (position, normal,
// aColor, aSurface) and produces one merged BufferGeometry. Every static mesh in the game is
// built this way so a whole chunk or city is a single draw call.
import * as THREE from 'three';

/** aSurface value for geometry whose colour follows the scene/derived saturation. */
export const NO_SURFACE = -1;
/** aSurface value for geometry that is always drawn in full colour (pickups, markers). */
export const ALWAYS_COLOR = -2;

export type BoxFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export type PerFace<T> = Partial<Record<BoxFace, T>>;

export class GeometryBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly srf: number[] = [];
  private readonly indices: number[] = [];
  private indexedThrough = 0;

  /** Quads and flat meshes between indexed meshes already arrive in triangle order. */
  private indexLooseVertices(): void {
    for (let i = this.indexedThrough; i < this.vertexCount; i++) this.indices.push(i);
    this.indexedThrough = this.vertexCount;
  }

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
    this.indexLooseVertices();
    const o = this.vertexCount;
    for (const p of [a, b, c, d]) this.vertex(p.x, p.y, p.z, normal.x, normal.y, normal.z, color, surface);
    this.quadIndices(o);
  }

  /** Two triangles (a, b, c) and (a, c, d) over the four vertices from `o`: a quad shares its
   * diagonal's two corners instead of repeating them. */
  private quadIndices(o: number): void {
    this.indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
    this.indexedThrough = this.vertexCount;
  }

  /** Quad with a normal per corner and an optional colour code per corner. */
  quadSmooth(
    a: THREE.Vector3Like,
    b: THREE.Vector3Like,
    c: THREE.Vector3Like,
    d: THREE.Vector3Like,
    normals: readonly [THREE.Vector3Like, THREE.Vector3Like, THREE.Vector3Like, THREE.Vector3Like],
    color: number | readonly [number, number, number, number],
    surface = NO_SURFACE,
  ): void {
    const pts = [a, b, c, d];
    this.indexLooseVertices();
    const o = this.vertexCount;
    for (let k = 0; k < 4; k++) {
      const p = pts[k]!;
      const n = normals[k]!;
      this.vertex(p.x, p.y, p.z, n.x, n.y, n.z, typeof color === 'number' ? color : color[k]!, surface);
    }
    this.quadIndices(o);
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

  /** Append another geometry keeping its own (smooth) normals, transformed, in one colour. */
  meshSmooth(
    geometry: THREE.BufferGeometry,
    matrix: THREE.Matrix4,
    color: number,
    surface = NO_SURFACE,
    colorOffsets?: readonly number[],
  ): void {
    const p = geometry.getAttribute('position');
    const nm = geometry.getAttribute('normal');
    const offset = this.vertexCount;
    if (geometry.index) this.indexLooseVertices();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      n.fromBufferAttribute(nm, i).applyMatrix3(normalMatrix).normalize();
      this.vertex(v.x, v.y, v.z, n.x, n.y, n.z, color + (colorOffsets?.[i] ?? 0), surface);
    }
    if (geometry.index) {
      for (let i = 0; i < geometry.index.count; i++) this.indices.push(offset + geometry.index.getX(i));
      this.indexedThrough = this.vertexCount;
    }
  }

  /** Append everything another builder holds, transformed, keeping its colours and surfaces
   * (a house built in its own frame, turned and set down in a town). */
  append(other: GeometryBuilder, matrix: THREE.Matrix4): void {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3();
    const offset = this.vertexCount;
    if (other.indices.length) this.indexLooseVertices();
    for (let i = 0; i < other.vertexCount; i++) {
      v.fromArray(other.pos, i * 3).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      v.fromArray(other.nor, i * 3)
        .applyMatrix3(normalMatrix)
        .normalize();
      this.nor.push(v.x, v.y, v.z);
      this.col.push(other.col[i]!);
      this.srf.push(other.srf[i]!);
    }
    if (other.indices.length) {
      other.indexLooseVertices();
      for (const k of other.indices) this.indices.push(offset + k);
      this.indexedThrough = this.vertexCount;
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    if (this.indices.length) {
      this.indexLooseVertices();
      g.setIndex(this.indices);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 1));
    g.setAttribute('aSurface', new THREE.Float32BufferAttribute(this.srf, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** A built geometry as plain arrays, to hand from a worker to the main thread. */
export interface GeometryData {
  /** Vertex attributes by name (position, normal, aColor, aSurface). */
  readonly attributes: Readonly<Record<string, { readonly array: Float32Array; readonly itemSize: number }>>;
  readonly index: Uint32Array | Uint16Array | null;
  /** Bounds as the builder found them, so the main thread need not walk every vertex again. */
  readonly sphere: readonly [number, number, number, number];
  readonly box: readonly [number, number, number, number, number, number];
}

/** A geometry's arrays, and the buffers to transfer rather than copy. */
export function geometryData(g: THREE.BufferGeometry): { data: GeometryData; transfer: ArrayBuffer[] } {
  const attributes: Record<string, { array: Float32Array; itemSize: number }> = {};
  const transfer: ArrayBuffer[] = [];
  for (const [name, attr] of Object.entries(g.attributes)) {
    const array = attr.array as Float32Array;
    attributes[name] = { array, itemSize: attr.itemSize };
    transfer.push(array.buffer as ArrayBuffer);
  }
  const index = (g.index?.array as Uint32Array | Uint16Array | undefined) ?? null;
  if (index) transfer.push(index.buffer as ArrayBuffer);
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (!g.boundingBox) g.computeBoundingBox();
  const { center: c, radius } = g.boundingSphere!;
  const { min, max } = g.boundingBox!;
  return {
    data: {
      attributes,
      index,
      sphere: [c.x, c.y, c.z, radius],
      box: [min.x, min.y, min.z, max.x, max.y, max.z],
    },
    transfer,
  };
}

/** The geometry again, from its arrays. */
export function fromGeometryData(d: GeometryData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(d.attributes))
    g.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize));
  if (d.index) g.setIndex(new THREE.BufferAttribute(d.index, 1));
  const [x, y, z, r] = d.sphere;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, y, z), r);
  g.boundingBox = new THREE.Box3(
    new THREE.Vector3(...d.box.slice(0, 3)),
    new THREE.Vector3(...d.box.slice(3)),
  );
  return g;
}
