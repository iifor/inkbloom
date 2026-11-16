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
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';

const CROWNS = new THREE.Vector3(color('leaf'), color('canopy'), color('cedar'));

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
  /** Wind, metres per second along +x and +z (set from the weather each frame). */
  uWind: { value: new THREE.Vector2(2.4, 1.5) },
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
uniform vec2 uWind;
/** Palette indices of tree crowns, which rock in the wind: broadleaf, wood canopy, cedar. */
uniform vec3 uCrowns;
varying vec3 vNormalV;
varying float vCode;
varying vec4 vShadow;
varying vec2 vCardUv;
varying float vTip;
varying float vGust;
#ifdef FIELD
uniform vec3 uField;
uniform vec4 uFieldFade;
uniform float uBloom;
#endif

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
    #ifdef FIELD
      // a field of plants around the player: each one's size follows its distance from them,
      // so moving the player changes nothing on the CPU. Full size in the middle, thinning to
      // a third at the rim (uFieldFade: reach, rim width), a little shorter right underfoot
      // (between .z and .w metres), gone beyond the reach
      float fd = distance(instanceMatrix[3].xz, uField.xz);
      float rim = 1.0 - smoothstep(uFieldFade.x - uFieldFade.y, uFieldFade.x, fd);
      float grow = step(fd, uFieldFade.x) * (0.35 + 0.65 * rim) * (0.6 + 0.4 * smoothstep(uFieldFade.z, uFieldFade.w, fd));
      float shown = grow;
      #ifdef USE_INSTANCING_COLOR
        // flowers: green says how much of the season's bloom it needs, blue how high its head
        // sits at full size (it sinks with the grass around it)
        shown *= step(instanceColor.g, uBloom);
      #endif
      transformed *= shown;
    #endif
    transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    objectNormal = mat3(instanceMatrix) * objectNormal;
    #if defined(FIELD) && defined(USE_INSTANCING_COLOR)
      transformed.y -= instanceColor.b * (1.0 - grow);
    #endif
  #endif
  vec4 world = modelMatrix * vec4(transformed, 1.0);
  #ifdef WIND
    // plants sway: the higher up the blade, the further; slow waves roll across the field
    // gusts: broad bands of wind rolling across the field, bending the grass further
    vGust = smoothstep(0.55, 1.0, sin(uTime * 0.9 + world.x * 0.045 - world.z * 0.06) * 0.5 + 0.5);
    float sway = sin(uTime * 1.6 + world.x * 0.31 + world.z * 0.23) * 0.6
               + sin(uTime * 0.7 + world.x * 0.05 - world.z * 0.07) * 0.5 + vGust * 0.9;
    // with the wind: about today's look at 3 m/s, storms bend the grass much further
    float ws = length(uWind);
    vec2 wdir = ws > 0.1 ? uWind / ws : vec2(0.85, 0.53);
    world.xz += wdir * sway * 0.16 * clamp(0.3 + ws * 0.23, 0.3, 2.2) * max(position.y, 0.0);
    vTip = clamp(position.y / 0.4, 0.0, 1.0);
  #else
    vTip = 1.0;
    vGust = 0.0;
    // tree crowns lean and rock with the wind; a slow wave across the wood keeps neighbouring
    // trees out of step (trunks stay put)
    if (abs(aColor - uCrowns.x) < 0.5 || abs(aColor - uCrowns.y) < 0.5 || abs(aColor - uCrowns.z) < 0.5) {
      float ws = length(uWind);
      vec2 wdir = ws > 0.1 ? uWind / ws : vec2(0.85, 0.53);
      float rock = sin(uTime * (0.8 + ws * 0.06) + world.x * 0.13 + world.z * 0.09) * 0.6
                 + sin(uTime * 1.9 + world.x * 0.31 - world.z * 0.27) * 0.25;
      world.xz += wdir * (0.012 * ws + (0.03 + 0.022 * ws) * rock);
    }
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
  #ifdef WIND
    // grass and flowers: one tap. Blades sway and overlap many deep, so soft edges would not
    // show, but nine taps per layer of grass would cost more than the whole rest of the scene
    vec2 e1 = min(p.xy, 1.0 - p.xy);
    return mix(1.0, step(p.z - 0.0012, texture2D(uShadowMap, p.xy).r), smoothstep(0.0, 0.08, min(e1.x, e1.y)));
  #endif
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
  /** Instanced plants sized by distance from a moving centre on the GPU; see FieldUniforms. */
  field?: FieldUniforms;
}

/** Shared, live uniforms for a field of plants (the owner updates the values each frame). */
export interface FieldUniforms {
  /** The player's position: the field's middle. */
  readonly uField: { value: THREE.Vector3 };
  /** Reach, rim width, and where underfoot shortening starts and ends (metres). */
  readonly uFieldFade: { value: THREE.Vector4 };
  /** The season's bloom, 0..1: flowers needing more than this are hidden. */
  readonly uBloom: { value: number };
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
      uWind: shared.uWind,
      uCrowns: { value: CROWNS },
      uState: { value: opts.state?.texture ?? empty() },
      uStateWidth: { value: opts.state?.width ?? 1 },
      uShadeBias: { value: opts.shadeBias ?? 0 },
      uCard: { value: opts.card ?? null },
      ...(opts.field ?? {}),
    },
    vertexShader: vert,
    fragmentShader: frag,
    defines: {
      ...(opts.wind ? { WIND: '' } : {}),
      ...(opts.card ? { CARD: '' } : {}),
      ...(opts.field ? { FIELD: '' } : {}),
    },
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
