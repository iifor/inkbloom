// The one material every world mesh uses. It writes a G-buffer the post pass turns into a
// painting: R = light shade (sun facing, darkened where the sun's shadow map says something is
// in the way), G = colour code, BA = view normal.
//
// Colour code = paletteIndex + 0.9 * saturation. Saturation comes from:
//   aSurface >= 0  per-surface state texture (0 drained, 1 original, 2+n graffiti colour n)
//   aSurface = -1  the derived wilderness drain (nearby cities' progress) times uSceneSat
//   aSurface = -2  always full colour (pickups, markers: things that must stand out)
// Geometry provides aColor (original palette index) and aSurface per vertex. An InstancedMesh
// with instance colours overrides the palette index per instance (red channel = index).
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
  /** Sun shadow map around the player; see InkRenderer. */
  uShadowMap: { value: null as THREE.Texture | null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowTexel: { value: 1 / 2048 },
  uShadowOn: { value: 0 },
  /** Seconds, for wind. */
  uTime: { value: 0 },
};

/** Layer for things drawn but never shadow-casting (grass: it would speckle the ground). */
export const NO_SHADOW_LAYER = 2;

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
uniform mat4 uShadowMatrix;
uniform float uTime;
varying vec3 vNormalV;
varying float vCode;
varying vec4 vShadow;
varying vec2 vCardUv;
varying float vTip;
varying float vGust;

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
  #ifdef WIND
    // plants sway: the higher up the blade, the further; slow waves roll across the field
    // gusts: broad bands of wind rolling across the field, bending the grass further
    vGust = smoothstep(0.55, 1.0, sin(uTime * 0.9 + world.x * 0.045 - world.z * 0.06) * 0.5 + 0.5);
    float sway = sin(uTime * 1.6 + world.x * 0.31 + world.z * 0.23) * 0.6
               + sin(uTime * 0.7 + world.x * 0.05 - world.z * 0.07) * 0.5 + vGust * 0.9;
    world.xz += vec2(0.8, 0.5) * sway * 0.16 * max(position.y, 0.0);
    vTip = clamp(position.y / 0.4, 0.0, 1.0);
  #else
    vTip = 1.0;
    vGust = 0.0;
  #endif
  float idx = aColor;
  #ifdef USE_INSTANCING_COLOR
    // instanced particles carry their palette index in the red channel
    idx = instanceColor.r;
  #endif
  float sat;
  if (aSurface >= 0.0) {
    int s = int(aSurface + 0.5);
    float state = texelFetch(uState, ivec2(s % uStateWidth, s / uStateWidth), 0).r * 255.0;
    int st = int(state + 0.5);
    if (st == 0) sat = 0.0;
    else { sat = 1.0; if (st >= 2) idx = float(st - 2); }
  } else if (aSurface < -1.5) {
    sat = 1.0;
  } else {
    sat = derivedSat(world.xyz) * uSceneSat;
  }
  vCode = idx + 0.9 * clamp(sat, 0.0, 1.0);
  vNormalV = normalize(normalMatrix * objectNormal);
  #ifdef CARD
    vCardUv = uv;
  #endif
  // pushed out along the normal a little, so surfaces do not shadow themselves
  vec3 wn = normalize(mat3(modelMatrix) * objectNormal);
  vShadow = uShadowMatrix * vec4(world.xyz + wn * 0.12, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const frag = /* glsl */ `
precision highp float;
uniform vec3 uLightDir;
uniform float uShadeBias;
uniform sampler2D uShadowMap;
uniform float uShadowTexel;
uniform float uShadowOn;
varying vec3 vNormalV;
varying float vCode;
varying vec4 vShadow;
varying vec2 vCardUv;
varying float vTip;
varying float vGust;

/**
 * 1 in sunlight, 0 in shadow, fading out at the map's edge. Eight taps on a ring turned by a
 * per-pixel random angle: the edge comes out soft and slightly grainy, like a brushed shadow,
 * instead of in square steps.
 */
float sunlight() {
  vec3 p = vShadow.xyz / vShadow.w;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  float turn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
  float sum = step(p.z - 0.0008, texture2D(uShadowMap, p.xy).r);
  for (int i = 0; i < 8; i++) {
    float a = turn + float(i) * 0.7854;
    float r = (i < 4 ? 1.4 : 2.8) * uShadowTexel;
    sum += step(p.z - 0.0008, texture2D(uShadowMap, p.xy + vec2(cos(a), sin(a)) * r).r);
  }
  vec2 e = min(p.xy, 1.0 - p.xy);
  return mix(1.0, sum / 9.0, smoothstep(0.0, 0.08, min(e.x, e.y)));
}

#ifdef CARD
uniform sampler2D uCard;
#endif

void main() {
  #ifdef CARD
    // a card of painted stalks: cut out where the picture is empty
    vec4 card = texture2D(uCard, vCardUv);
    if (card.a < 0.45) discard;
  #endif
  vec3 n = normalize(vNormalV);
  #ifndef WIND
    // plants keep their upward normal on both sides; everything else shows its back face dark
    if (!gl_FrontFacing) n = -n;
  #endif
  float shade = clamp(dot(n, uLightDir) * 0.5 + 0.5 + uShadeBias, 0.0, 1.0);
  // in the shadow of something: as dark as a face turned away from the sun
  if (uShadowOn > 0.5) shade = mix(min(shade, 0.4), shade, sunlight());
  #ifdef WIND
    // a tuft is dark down among the stems and catches the light at the tips
    shade = clamp(shade * mix(0.62, 1.12, vTip), 0.0, 1.0);
    #ifdef CARD
      // the card's own light and dark: dark stems below, pale seed heads above
      shade = clamp(shade * mix(0.55, 1.18, card.r), 0.0, 1.0);
    #endif
    // a gust turns the blades over and a wave of light runs across the meadow
    shade = clamp(shade + vGust * vTip * 0.18, 0.0, 1.0);
  #endif
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
  /** Sway in the wind by local height (grass, flowers). */
  wind?: boolean;
  /** Alpha-tested card picture (grass stalks): red = light and dark, alpha = cut-out. Needs uv. */
  card?: THREE.Texture;
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
      uShadowMap: shared.uShadowMap,
      uShadowMatrix: shared.uShadowMatrix,
      uShadowTexel: shared.uShadowTexel,
      uShadowOn: shared.uShadowOn,
      uTime: shared.uTime,
      uState: { value: opts.state?.texture ?? empty() },
      uStateWidth: { value: opts.state?.width ?? 1 },
      uShadeBias: { value: opts.shadeBias ?? 0 },
      uCard: { value: opts.card ?? null },
    },
    vertexShader: vert,
    fragmentShader: frag,
    defines: { ...(opts.wind ? { WIND: '' } : {}), ...(opts.card ? { CARD: '' } : {}) },
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
