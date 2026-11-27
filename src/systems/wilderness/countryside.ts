import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { color, PALETTE, type ColorKey } from '@/content/palette';
import type { PhysicsWorld } from '@/engine/physics/world';
import type { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { CountryProp, CountrySite } from '@/world/wilderness/countryside';

const paints = [
  'brown',
  'bark',
  'sand',
  'limewash',
  'clayTile',
  'slateTile',
  'rock',
  'stone',
  'cream',
  'charcoal',
  'yellow',
  'orange',
  'green',
  'forest',
  'teal',
  'red',
] as const;
const swatches = paints.map((name) => ({ index: color(name), rgb: PALETTE[color(name)]!.rgb }));
const surfacePaint: Readonly<Record<string, ColorKey>> = {
  Timber: 'bark',
  Canvas: 'cream',
  Oars: 'brown',
  Rock: 'rock',
  Yellow: 'yellow',
  Orange: 'orange',
  Green: 'green',
  DarkGreen2: 'forest',
  Marble: 'stone',
  Statue: 'rock',
};
function pigment(r: number, g: number, b: number) {
  let index = color('stone'),
    best = Infinity;
  for (const p of swatches) {
    const d = (r - p.rgb[0]) ** 2 * 0.28 + (g - p.rgb[1]) ** 2 * 0.55 + (b - p.rgb[2]) ** 2 * 0.17;
    if (d < best) {
      best = d;
      index = p.index;
    }
  }
  return index;
}
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
/** Immutable templates share painted geometry. Scene-specific material is applied on cloning. */
const templates = new Map<CountryProp, Promise<THREE.Group>>();
function template(key: CountryProp) {
  let loaded = templates.get(key);
  if (!loaded) {
    loaded = loader
      .loadAsync(`${import.meta.env.BASE_URL}models/countryside/${key}.glb`)
      .then(({ scene }) => {
        const pixel = new THREE.Color();
        scene.traverse((mesh) => {
          if (!(mesh instanceof THREE.Mesh)) return;
          // The ink shader encodes a palette index, so interpolating two indices would
          // paint unrelated colours between them. Keep one pigment across each atlas face.
          if (mesh.geometry.index && mesh.geometry.hasAttribute('color'))
            mesh.geometry = mesh.geometry.toNonIndexed();
          const geo = mesh.geometry,
            count = geo.getAttribute('position').count;
          const original = mesh.material as THREE.MeshStandardMaterial;
          const colors = geo.getAttribute('color');
          const indices = new Float32Array(count);
          if (colors) {
            for (let i = 0; i < count; i += 3) {
              pixel
                .setRGB(
                  (colors.getX(i) + colors.getX(i + 1) + colors.getX(i + 2)) / 3,
                  (colors.getY(i) + colors.getY(i + 1) + colors.getY(i + 2)) / 3,
                  (colors.getZ(i) + colors.getZ(i + 1) + colors.getZ(i + 2)) / 3,
                )
                .convertLinearToSRGB();
              indices.fill(pigment(pixel.r, pixel.g, pixel.b), i, i + 3);
            }
          } else {
            pixel.copy(original.color).convertLinearToSRGB();
            const fixed = surfacePaint[original.name];
            indices.fill(fixed ? color(fixed) : pigment(pixel.r, pixel.g, pixel.b));
          }
          geo.setAttribute('aColor', new THREE.BufferAttribute(indices, 1));
          geo.setAttribute('aSurface', new THREE.BufferAttribute(new Float32Array(count).fill(-1), 1));
          geo.setAttribute('aPane', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
        });
        const bounds = new THREE.Box3().setFromObject(scene, true);
        const center = bounds.getCenter(new THREE.Vector3()),
          size = bounds.getSize(new THREE.Vector3());
        scene.position.set(-center.x, -bounds.min.y, -center.z);
        const normalized = new THREE.Group();
        normalized.add(scene);
        normalized.scale.setScalar(1 / Math.max(size.x, size.z, 0.0001));
        return normalized;
      })
      .catch((error) => {
        templates.delete(key);
        throw error;
      });
    templates.set(key, loaded);
  }
  return loaded;
}

export class CountrysideProps {
  private readonly plots = new Set<{ x0: number; x1: number; z0: number; z1: number }>();
  cultivated(x: number, z: number): boolean {
    for (const p of this.plots) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return true;
    return false;
  }
  private readonly motion = new Set<{ root: THREE.Group; site: CountrySite; rotor?: THREE.Object3D }>();
  constructor(
    private readonly root: THREE.Group,
    private readonly material: THREE.Material,
    private readonly physics: PhysicsWorld,
  ) {}

  add(
    sites: readonly CountrySite[],
    group: string,
    ground: GeometryBuilder,
    heightAt: (x: number, z: number) => number,
  ): () => void {
    const crops = sites.filter((s) => /_[1-4]$/.test(s.model));
    const rowWidth = crops[0]?.model.startsWith('Wheat') ? 0.2 : 0.43;
    const plot = crops.length
      ? {
          x0: Math.min(...crops.map((s) => s.x)) - rowWidth,
          x1: Math.max(...crops.map((s) => s.x)) + rowWidth,
          z0: Math.min(...crops.map((s) => s.z)) - 0.45,
          z1: Math.max(...crops.map((s) => s.z)) + 0.45,
        }
      : null;
    if (plot) {
      this.plots.add(plot);
      const point = (x: number, z: number, rise: number) => ({ x, y: heightAt(x, z) + rise, z });
      for (const x of new Set(crops.map((s) => s.x))) {
        for (let z = plot.z0; z < plot.z1; z += 0.45) {
          const end = Math.min(z + 0.45, plot.z1);
          for (const side of [-1, 1]) {
            const left = side < 0 ? x - rowWidth : x,
              right = side < 0 ? x : x + rowWidth;
            const low = 0.025,
              high = 0.07;
            ground.quad(
              point(left, end, side < 0 ? low : high),
              point(right, end, side < 0 ? high : low),
              point(right, z, side < 0 ? high : low),
              point(left, z, side < 0 ? low : high),
              { x: side * 0.12, y: 0.99, z: 0 },
              color(side < 0 ? 'brown' : 'bark'),
            );
          }
        }
      }
    }
    const batch = new THREE.Group();
    const active: { root: THREE.Group; site: CountrySite; rotor?: THREE.Object3D }[] = [];
    let released = false;
    if (sites.length) this.root.add(batch);
    for (const site of sites) {
      void template(site.model)
        .then((base) => {
          if (released) return;
          const root = new THREE.Group(),
            model = base.clone(true);
          root.add(model);
          root.name = site.model;
          let rotor: THREE.Object3D | undefined;
          model.traverse((obj) => {
            if (obj instanceof THREE.Mesh) obj.material = this.material;
            if (/_wheel_|_fan_/.test(obj.name)) rotor = obj;
          });
          root.scale.setScalar(site.width);
          root.position.set(site.x, site.y, site.z);
          const boat = site.model.startsWith('sea_');
          if (rotor || boat) {
            const item = { root, site, rotor };
            this.motion.add(item);
            active.push(item);
          }
          if (rotor || boat || ['market', 'Column_Broken', 'Column', 'Statue_Horse'].includes(site.model)) {
            const box = new THREE.Box3().setFromObject(root, true);
            // Boats have thin masts. Only the hull blocks the swimmer.
            if (boat) box.max.y = Math.min(box.max.y, site.y + 0.68);
            this.physics.addBox(group, box.min, box.max, {}, site.yaw);
          }
          root.rotation.y = site.yaw;
          batch.add(root);
        })
        .catch((error) => console.warn('Unable to place countryside model', site.model, error));
    }
    return () => {
      released = true;
      if (plot) this.plots.delete(plot);
      batch.removeFromParent();
      for (const m of active) this.motion.delete(m);
    };
  }
  update(time: number) {
    for (const { root, site, rotor } of this.motion) {
      const phase = time + site.x * 0.21 + site.z * 0.34;
      if (rotor)
        rotor.rotation.z = phase * (site.model === 'watermill' ? 0.38 * (site.wheelDirection ?? 1) : 0.54);
      else {
        root.position.y = site.y + 0.032 * Math.sin(phase * 1.4);
        root.rotation.z = 0.017 * Math.sin(phase * 1.1);
        root.rotation.x = 0.008 * Math.cos(phase * 0.9);
      }
    }
  }
}
