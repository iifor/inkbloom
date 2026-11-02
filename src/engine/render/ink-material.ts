// The one material every world mesh uses. It writes a G-buffer the post pass turns into a pen
// drawing on paper: R = light shade, G = colour code, BA = view normal.
//
// Colour code = paletteIndex + 0.9 * saturation. Saturation comes from:
//   aSurface >= 0  per-surface state texture (0 drained, 1 original, 2+n graffiti colour n)
//   aSurface <  0  the derived wilderness drain (nearby cities' progress) times uSceneSat
// Geometry provides aColor (original palette index) and aSurface per vertex.
import * as THREE from 'three';
import { TUNING } from '@/content/tuning';

export const shared = {
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  /** xy = city position, z = progress (0..1), w unused. */
  uCities: { value: Array.from({ length: TUNING.drain.maxCities }, () => new THREE.Vector4()) },
  uCityCount: { value: 0 },
  uDrainInner: { value: TUNING.drain.innerRadius as number },
  uDrainOuter: { value: TUNING.drain.outerRadius as number },
  uSceneSat: { value: 1 },
};

const vert = /* glsl */ `
attribute float aColor;
attribute float aSurface;
uniform sampler2D uState;
uniform int uStateWidth;
uniform vec4 uCities[${TUNING.drain.maxCities}];
uniform int uCityCount;
uniform float uDrainInner;
uniform float uDrainOuter;
uniform float uSceneSat;
varying vec3 vNormalV;
varying float vCode;

float derivedSat(vec3 wp) {
  float drain = 0.0;
  for (int i = 0; i < ${TUNING.drain.maxCities}; i++) {
    if (i >= uCityCount) break;
    vec4 c = uCities[i];
    float d = distance(wp.xz, c.xy);
    float f = 1.0 - smoothstep(uDrainInner, uDrainOuter, d);
    drain = max(drain, (1.0 - c.z) * f);
  }
  return 1.0 - drain;
}

void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
  #ifdef USE_INSTANCING
    transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    objectNormal = mat3(instanceMatrix) * objectNormal;
  #endif
  vec4 world = modelMatrix * vec4(transformed, 1.0);
  float idx = aColor;
  float sat;
  if (aSurface >= 0.0) {
    int s = int(aSurface + 0.5);
    float state = texelFetch(uState, ivec2(s % uStateWidth, s / uStateWidth), 0).r * 255.0;
    int st = int(state + 0.5);
    if (st == 0) sat = 0.0;
    else { sat = 1.0; if (st >= 2) idx = float(st - 2); }
  } else {
    sat = derivedSat(world.xyz) * uSceneSat;
  }
  vCode = idx + 0.9 * clamp(sat, 0.0, 1.0);
  vNormalV = normalize(normalMatrix * objectNormal);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const frag = /* glsl */ `
precision highp float;
uniform vec3 uLightDir;
uniform float uShadeBias;
varying vec3 vNormalV;
varying float vCode;
void main() {
  vec3 n = normalize(vNormalV);
  if (!gl_FrontFacing) n = -n;
  float shade = clamp(dot(n, uLightDir) * 0.5 + 0.5 + uShadeBias, 0.0, 1.0);
  gl_FragColor = vec4(shade, vCode, n.x, n.y);
}`;

/** A 1×1 all-zero state texture for meshes that never use surfaces. */
let emptyState: THREE.DataTexture | null = null;
function empty(): THREE.DataTexture {
  if (!emptyState) {
    emptyState = new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    emptyState.needsUpdate = true;
  }
  return emptyState;
}

export interface InkMaterialOptions {
  state?: SurfaceStateTexture;
  side?: THREE.Side;
  shadeBias?: number;
}

export function makeInkMaterial(opts: InkMaterialOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLightDir: shared.uLightDir,
      uCities: shared.uCities,
      uCityCount: shared.uCityCount,
      uDrainInner: shared.uDrainInner,
      uDrainOuter: shared.uDrainOuter,
      uSceneSat: shared.uSceneSat,
      uState: { value: opts.state?.texture ?? empty() },
      uStateWidth: { value: opts.state?.width ?? 1 },
      uShadeBias: { value: opts.shadeBias ?? 0 },
    },
    vertexShader: vert,
    fragmentShader: frag,
    side: opts.side ?? THREE.FrontSide,
  });
}

/**
 * GPU mirror of a city's surface state bytes. Systems call set() when a patch lands; the
 * texture is re-uploaded once per frame at most.
 */
export class SurfaceStateTexture {
  static readonly WIDTH = 256;
  readonly width = SurfaceStateTexture.WIDTH;
  readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;

  constructor(states: Uint8Array) {
    const rows = Math.max(1, Math.ceil(states.length / this.width));
    this.data = new Uint8Array(this.width * rows);
    this.data.set(states);
    this.texture = new THREE.DataTexture(
      this.data,
      this.width,
      rows,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    this.texture.needsUpdate = true;
  }

  /** The state last uploaded for a surface (lags the save until set() is called). */
  get(surface: number): number {
    return this.data[surface] ?? 0;
  }

  set(surface: number, state: number): void {
    this.data[surface] = state;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
