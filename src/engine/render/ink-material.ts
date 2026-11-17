// The one material every world mesh uses. It writes a G-buffer the post pass turns into a
// painting: R = light shade (sun facing, darkened where the sun's shadow map says something is
// in the way), G = colour code, BA = view normal. Grass has an upward normal, so it uses
// BA for a grass marker and the fraction of the pixel covered by the leaf.
// Fish store diffuse pigment instead of the view normal: G = green, B = -2 - red, A = blue.
//
// Colour code = paletteIndex + 0.9 * saturation. Saturation comes from:
//   aSurface >= 0  per-surface state texture (0 drained, 1 original, 2+n graffiti colour n)
//   aSurface = -1  the derived wilderness drain (nearby cities' progress) times uSceneSat
//   aSurface = -2  always full colour (pickups, markers: things that must stand out)
// Negative colour codes belong to wilderness soil: -1 is a sandy riverbed, -2 is meadow.
// Geometry provides aColor (original palette index) and aSurface per vertex. An InstancedMesh
// with instance colours overrides the palette index per instance (red channel = index).
import * as THREE from 'three';
import { color, MAX_COLORS } from '@/content/palette';
import { TUNING } from '@/content/tuning';

export const shared = {
  uCanopyBrush: { value: null as THREE.Texture | null },
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
  /** Wind travel in world metres, integrated across changes in the weather. */
  uWindDrift: { value: new THREE.Vector2() },
};

/** Layer for things drawn but never shadow-casting (grass: it would speckle the ground). */
export const NO_SHADOW_LAYER = 2;

export const wildernessDrainGLSL = /* glsl */ `
uniform vec4 uCities[${TUNING.drain.maxCities}];
uniform int uCityCount;
uniform float uDrainInner;
uniform float uDrainOuter;
uniform float uSceneSat;
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
}`;

const vert = /* glsl */ `
attribute float aColor;
attribute float aSurface;
uniform sampler2D uState;
uniform int uStateWidth;
${wildernessDrainGLSL}
uniform mat4 uShadowMatrix;
uniform float uTime;
#ifdef WIND
uniform vec2 uWind;
uniform vec2 uWindDrift;
uniform sampler2D uWindMap;
#ifdef BLADES
attribute float aBladePhase;
#endif
#endif
varying vec3 vNormalV;
varying float vCode;
varying vec4 vShadow;
varying vec2 vCardUv;
varying float vTip;
varying float vGust;
#ifdef TREE
varying vec3 vTreePosition;
varying vec3 vTreeView;
#endif
#ifdef FIELD
uniform vec3 uField;
uniform vec2 uFieldFade;
uniform float uDensity;
varying float vFieldCover;
varying vec2 vPlantMark;
#endif
void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
  #ifdef FISH
    vCardUv = uv;
    #ifdef USE_INSTANCING_COLOR
      // The two instance coefficients carry stroke phase and strength. The
      // displacement grows toward the tail; its slope also turns the normals.
      float tail = clamp((0.21 - position.x) / 0.89, 0.0, 1.0);
      vec2 wave = vec2(cos(2.8 * tail), -sin(2.8 * tail));
      float beat = dot(instanceColor.rg, wave);
      transformed.z += tail * tail * beat;
      float slope = -(2.0 * tail * beat + 2.8 * tail * tail * dot(instanceColor.rg, vec2(wave.y, -wave.x))) / 0.89;
      objectNormal.x -= slope * objectNormal.z;
      // Only the outer part of each pectoral fin extends this far from the midline.
      float paddle = smoothstep(0.098, 0.174, abs(position.z)) * step(0.78, uv.y);
      transformed.y += paddle * 0.15 * instanceColor.g;
    #endif
  #endif
  #ifdef USE_INSTANCING
    #ifdef FIELD
      vec2 offset = instanceMatrix[3].xz - uField.xz;
      float range = length(offset);
      bool hidden = range >= uFieldFade.y;
      #ifdef USE_INSTANCING_COLOR
        hidden = hidden || instanceColor.g >= uDensity;
      #endif
      if (hidden) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      // Only coverage fades at the outer streaming boundary. Size and wind use the rest pose.
      vFieldCover = 1.0 - smoothstep(uFieldFade.x, uFieldFade.y, range);
      vPlantMark = instanceMatrix[3].xz + position.xz + position.y * vec2(0.41, 0.73);
    #endif
    transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    mat3 basis = mat3(instanceMatrix);
    #if defined(TREE) || (defined(FIELD) && !defined(BLADES))
      // Trees and meadow flowers scale independently in height and width.
      objectNormal /= vec3(dot(basis[0], basis[0]), dot(basis[1], basis[1]), dot(basis[2], basis[2]));
    #endif
    objectNormal = basis * objectNormal;
  #endif
  vec4 world = modelMatrix * vec4(transformed, 1.0);
  #ifdef TREE
    vTreePosition = world.xyz;
    vTreeView = (viewMatrix * world).xyz;
  #endif
  #ifdef WATERWEED
    world.xz += vec2(0.075, 0.038) * position.y * position.y * sin(1.25 * uTime + world.x * 0.43 + world.z * 0.35);
  #endif
  #ifdef WIND
    vec2 root = modelMatrix[3].xz;
    float height = max(position.y, 0.0);
    #ifdef USE_INSTANCING
      root = (modelMatrix * instanceMatrix[3]).xz;
      height *= instanceMatrix[1].y;
    #endif
    // Every vertex on a plant feels the same travelling gust at its root.
    vec2 air = texture2D(uWindMap, (root - uWindDrift) / 96.0).rg;
    float gust = smoothstep(0.22, 0.80, air.r);
    float side = 2.0 * air.g - 1.0;
    float seed = 0.5;
    #ifdef USE_INSTANCING_COLOR
      seed = instanceColor.b;
    #endif
    float phase = seed;
    float flex = height;
    #ifdef BLADES
      phase += aBladePhase;
      flex *= uv.y * (0.84 + 0.30 * seed);
    #endif
    float flutter = sin(uTime * (2.4 + 0.9 * seed) + 6.2832 * phase + side);
    float speed = length(uWind);
    vec2 along = uWind / (4.0 + speed);
    vec2 across = vec2(-along.y, along.x);
    world.xz += flex * (along * (0.06 + 0.39 * gust + 0.095 * flutter)
                      + across * (0.25 * side + 0.075 * flutter));
    vGust = gust * speed / (3.0 + speed);
    vTip = clamp(position.y / 0.4, 0.0, 1.0);
  #else
    vTip = 1.0;
    vGust = 0.0;
  #endif
  float idx = aColor;
  #if defined(USE_INSTANCING_COLOR) && !defined(FISH)
    // instanced particles carry their palette index in the red channel
    idx = instanceColor.r;
    #if defined(FIELD) && !defined(BLADES)
      // The petal template supplies a wash in the meadow range, the instance supplies its pigment.
      // The calyx, stalk and pollen carry ordinary palette colours.
      idx = aColor >= ${2 * MAX_COLORS}.0 ? aColor + idx : aColor;
    #endif
  #endif
  float sat;
  if (aSurface >= 0.0) {
    int s = int(aSurface + 0.5);
    float state = texelFetch(uState, ivec2(s % uStateWidth, s / uStateWidth), 0).r * 255.0;
    int st = int(state + 0.5);
    if (st == 0) sat = 0.0;
    else { sat = 1.0; if (st >= 2) idx = float(st - 2); }
  } else if (aSurface < -1.5 || idx >= ${MAX_COLORS}.0) {
    sat = 1.0;
  } else {
    sat = derivedSat(world.xyz) * uSceneSat;
  }
  // Petals carry their pigment above the palette and a wash strength in the fraction.
  vCode = idx < 0.0 || idx >= ${MAX_COLORS}.0 ? idx : idx + 0.9 * clamp(sat, 0.0, 1.0);
  vNormalV = normalize(normalMatrix * objectNormal);
  #ifdef BLADES
    vCardUv = uv;
  #endif
  // pushed out along the normal a little, so surfaces do not shadow themselves
  vec3 wn = normalize(mat3(modelMatrix) * objectNormal);
  vShadow = uShadowMatrix * vec4(world.xyz + wn * 0.12, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const frag = /* glsl */ `
precision highp float;
#ifdef FISH
uniform sampler2D uFishPaint;
#endif
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
#ifdef TREE
uniform sampler2D uCanopyBrush;
varying vec3 vTreePosition;
varying vec3 vTreeView;
#endif

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

#ifdef FIELD
varying float vFieldCover;
varying vec2 vPlantMark;
#endif

void main() {
  #ifdef FIELD
    if (vFieldCover < 1.0) {
      // A mask attached to the plant lets the ground show through at long range.
      // It remains in place while the camera moves and never shortens the blades.
      vec3 h = fract(floor(vPlantMark * 48.0).xyx * vec3(0.1031, 0.1030, 0.0973));
      h += dot(h, h.yzx + 33.33);
      if (fract((h.x + h.y) * h.z) >= vFieldCover) discard;
    }
  #endif
  #ifdef BLADES
    // Feather the outermost pixel of the ribbon. Interior colour and depth stay opaque.
    float halfWidth = 0.5 * clamp((1.0 - vCardUv.y) / 0.17, 0.0, 1.0);
    float edge = halfWidth - abs(vCardUv.x - 0.5);
    float coverage = smoothstep(0.0, max(0.06, 1.25 * fwidth(edge)), edge);
    coverage *= mix(0.35, 1.0, smoothstep(0.0, 0.22, vCardUv.y));
  #endif
  vec3 n = normalize(vNormalV);
  #ifdef TREE
    // Break the outside of the foliage into little overlapping sprays. Where an outer
    // leaf is missing the depth buffer sees the next branch or the real sky behind it.
    float silhouette = abs(dot(n, normalize(vTreeView)));
    if (-vTreeView.z < 40.0 && silhouette < 0.67 && floor(vCode) != ${color('bark')}.0) {
      vec3 p = vTreePosition;
      vec2 uv = vec2(p.x + 0.51 * p.z, p.y - 0.63 * p.z);
      vec2 sprigs = texture2D(uCanopyBrush, uv * 0.64).rg;
      float ink = floor(vCode) == ${color('cedar')}.0 ? sprigs.g : sprigs.r;
      float wash = texture2D(uCanopyBrush, vec2(p.z - 0.45 * p.x, p.y + 0.65 * p.x) * 0.81).b;
      float cut = clamp(0.22 + 0.86 * (0.51 - ink) + 0.72 * (0.51 - wash), 0.0, 0.65);
      if (silhouette < cut * (1.0 - smoothstep(27.0, 40.0, -vTreeView.z))) discard;
    }
  #endif
  #ifndef WIND
    // plants keep their upward normal on both sides; everything else shows its back face dark
    if (!gl_FrontFacing) n = -n;
  #endif
  float shade = clamp(dot(n, uLightDir) * 0.5 + 0.5 + uShadeBias, 0.0, 1.0);
  #ifdef TREE
    if (floor(vCode) == ${color('bark')}.0) {
      // Long broken strokes turn around the taper and follow it into the forks.
      vec2 grainUv = vec2(dot(vTreePosition.xz, vec2(1.4, 1.1)), vTreePosition.y * 0.16);
      shade += (texture2D(uCanopyBrush, grainUv).b - 0.48) * 0.23;
    }
  #endif
  // in the shadow of something: as dark as a face turned away from the sun
  if (uShadowOn > 0.5) shade = mix(min(shade, 0.4), shade, sunlight());
  #ifdef WIND
    // a tuft is dark down among the stems and catches the light at the tips
    shade = clamp(shade * mix(0.62, 1.12, vTip), 0.0, 1.0);
    #ifdef BLADES
      shade *= mix(0.85, 1.00, vCardUv.y) * (0.90 + 0.10 * sin(vCardUv.x * 3.1416));
    #endif
    // a gust turns the blades over and a wave of light runs across the meadow
    shade = clamp(shade + vGust * vTip * 0.18, 0.0, 1.0);
  #endif
  #ifdef FISH
    vec3 pigment = texture2D(uFishPaint, vCardUv).rgb;
    gl_FragColor = vec4(shade, pigment.g, -2.0 - pigment.r, pigment.b);
  #elif defined(BLADES)
    gl_FragColor = vec4(shade, vCode, 2.0, coverage);
  #else
    gl_FragColor = vec4(shade, vCode, n.x, n.y);
  #endif
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
  tree?: boolean;
  fishPaint?: THREE.Texture;
  state?: SurfaceStateTexture;
  side?: THREE.Side;
  shadeBias?: number;
  /** World-space gust strength and lateral wind for grass and flowers. */
  wind?: THREE.Texture;
  waterweed?: boolean;
  /** Shaped grass ribbons with a soft edge instead of a cutout texture. */
  blades?: boolean;
  /** A world-anchored field with a bounded drawing radius and seasonal density. */
  field?: FieldUniforms;
}

/** Shared, live uniforms for a field of plants (the owner updates the values each frame). */
export interface FieldUniforms {
  /** The player's position: the field's middle. */
  readonly uField: { value: THREE.Vector3 };
  /** Distances where the outer coverage fade begins and ends (metres). */
  readonly uFieldFade: { value: THREE.Vector2 };
  /** Share of this plant population visible this season, 0..1. */
  readonly uDensity: { value: number };
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
      ...(opts.wind
        ? { uWind: shared.uWind, uWindDrift: shared.uWindDrift, uWindMap: { value: opts.wind } }
        : {}),
      uCanopyBrush: shared.uCanopyBrush,
      uState: { value: opts.state?.texture ?? empty() },
      uStateWidth: { value: opts.state?.width ?? 1 },
      uShadeBias: { value: opts.shadeBias ?? 0 },
      ...(opts.fishPaint ? { uFishPaint: { value: opts.fishPaint } } : {}),
      ...(opts.field ?? {}),
    },
    vertexShader: vert,
    fragmentShader: frag,
    defines: {
      ...(opts.tree ? { TREE: '' } : {}),
      ...(opts.fishPaint ? { FISH: '' } : {}),
      ...(opts.waterweed ? { WATERWEED: '' } : {}),
      ...(opts.wind ? { WIND: '' } : {}),
      ...(opts.blades ? { BLADES: '' } : {}),
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
