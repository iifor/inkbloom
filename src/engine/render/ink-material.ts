// The one material every world mesh uses. It writes a G-buffer the post pass turns into a
// painting: R = light shade (sun facing, darkened where the sun's shadow map says something is
// in the way), G = colour code, BA = view normal. Grass has an upward normal, so it uses
// BA for a grass marker and the fraction of the pixel covered by the leaf.
// Fish store diffuse pigment instead of the view normal: G = green, B = -2 - red, A = blue.
// A window pane (aPane, see GeometryBuilder.pane) stores where on the pane the pixel is in
// place of its normal: B = 8 + across, A = the room behind it + up.
// A footpath's quads carry how far each point is from the path's middle (aPane -3, edge): the
// earth is cut away raggedly toward the edge, leaving the grass under it.
// The meadow's painted plants (PLANTS: grass tufts and wildflowers from the plant atlas, see
// painted-textures.ts) are cards that turn to face the eye, cut out by the painting.
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
import { PLANT_COLUMNS } from './painted-textures';

/** Cleansed ink wells the drain shader knows about at once (the nearest). */
export const MAX_WELLS = 4;

export const shared = {
  uCanopyBrush: { value: null as THREE.Texture | null },
  /** The meadow's painted plants (painted-textures.ts): grass tufts and wildflowers. */
  uPlants: { value: null as THREE.Texture | null },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  /** xy = town centre, z = progress (0..1), w = half the town's side. */
  uCities: { value: Array.from({ length: TUNING.drain.maxCities }, () => new THREE.Vector4()) },
  uCityCount: { value: 0 },
  uInkAreas: { value: Array.from({length: 12}, () => new THREE.Vector2()) },
  uInkAreaCount: { value: 0 },
  /** Cleansed ink wells near by (x, z, radius of the colour round it): the land there keeps its
   * colour however grey the town (see world/wilderness/ink-wells.ts). */
  uWells: { value: Array.from({ length: MAX_WELLS }, () => new THREE.Vector4()) },
  uWellCount: { value: 0 },
  uDrainInner: { value: TUNING.drain.innerRadius as number },
  uDrainOuter: { value: TUNING.drain.outerRadius as number },
  uSceneSat: { value: 1 },
  /** The arena (xy centre, z radius, w 1 when there is one): always in full colour, so a fight
   * is never in the grey. */
  uArena: { value: new THREE.Vector4() },
  /** Sun shadow map around the player; see InkRenderer. */
  uShadowMap: { value: null as THREE.Texture | null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowTexel: { value: 1 / 2048 },
  uShadowOn: { value: 0 },
  /** 1 when depth runs the other way (near 1, far 0) for precision far off; see InkRenderer. */
  uReversedDepth: { value: 0 },
  /** Seconds, for wind. */
  uTime: { value: 0 },
  /** Wind, metres per second along +x and +z (set from the weather each frame). */
  uWind: { value: new THREE.Vector2(2.4, 1.5) },
  /** Wind travel in world metres, integrated across changes in the weather. */
  uWindDrift: { value: new THREE.Vector2() },
  /** Local resting body footprint: xyz = feet origin, w = pose blend. */
  uRestArea: { value: new THREE.Vector4() },
  uRestDirection: { value: new THREE.Vector2(0, 1) },
};

/** Layer for things drawn but never shadow-casting (grass: it would speckle the ground). */
export const NO_SHADOW_LAYER = 2;

export const wildernessDrainGLSL = /* glsl */ `
uniform vec4 uCities[${TUNING.drain.maxCities}];
uniform int uCityCount;
uniform vec4 uWells[${MAX_WELLS}];
uniform int uWellCount;
uniform float uDrainInner;
uniform float uDrainOuter;
uniform float uSceneSat;
uniform vec4 uArena;
float derivedSat(vec3 wp) {
  float drain = 0.0;
  for (int i = 0; i < ${TUNING.drain.maxCities}; i++) {
    if (i >= uCityCount) break;
    vec4 c = uCities[i];
    // measured from the town's wall: inside it the drain is the town's own
    float d = length(max(abs(wp.xz - c.xy) - c.w, 0.0));
    float f = 1.0 - smoothstep(uDrainInner, uDrainOuter, d);
    drain = max(drain, (1.0 - c.z) * f);
  }
  // round a cleansed ink well the colour has come back (drain.ts saturationAt does the same)
  for (int i = 0; i < ${MAX_WELLS}; i++) {
    if (i >= uWellCount) break;
    vec4 wl = uWells[i];
    drain *= smoothstep(wl.z * 0.55, wl.z, length(wp.xz - wl.xy));
  }
  if (uArena.w > 0.0) drain *= smoothstep(uArena.z - 4.0, uArena.z + 2.0, length(wp.xz - uArena.xy));
  return 1.0 - drain;
}`;

const vert = /* glsl */ `
attribute float aColor;
attribute float aSurface;
attribute vec2 aPane;
uniform sampler2D uState;
uniform int uStateWidth;
${wildernessDrainGLSL}
uniform mat4 uShadowMatrix;
uniform float uTime;
#include <skinning_pars_vertex>
#ifdef WIND
uniform vec2 uWind;
uniform vec2 uWindDrift;
uniform sampler2D uWindMap;
#ifdef REEDS
attribute vec4 aReedRoot;
#endif
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
varying vec2 vPane;
varying vec2 vGroundAt;
#ifdef TREE
varying vec3 vTreePosition;
varying vec3 vTreeView;
#endif
#ifdef CLOTH
varying vec3 vCloth;
varying float vClothDepth;
#endif
#ifdef CHARACTER_PAINT
attribute float aCharacterMaterial;
varying float vCharacterMaterial;
varying vec3 vPaintNormal;
#endif
#ifdef VIEW_MODEL
uniform float uViewScale;
#endif
#ifdef PLANTS
varying float vPlantCell;
#endif
#ifdef FIELD
uniform vec3 uField;
uniform vec4 uRestArea;
uniform vec2 uRestDirection;
uniform vec2 uFieldFade;
uniform float uDensity;
#ifdef SEA
uniform vec4 uBloom;
#endif
varying float vFieldCover;
varying vec2 vPlantMark;
#endif
void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
  #ifdef CHARACTER_PAINT
    vCharacterMaterial = aCharacterMaterial;
    vPaintNormal = normal;
  #endif
  // rigged models (imported characters) bend with their bones; three defines USE_SKINNING for
  // a SkinnedMesh and binds the bone texture itself
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  #if defined(WIND) && defined(BLADES) && defined(USE_INSTANCING_COLOR)
    // Fixed at the planting site: adjacent tufts open differently even in still air.
    float habit = fract(3.13 * instanceColor.b + 4.37 * aBladePhase);
    transformed.y *= 0.79 + 0.40 * habit;
    transformed.xz *= 1.0 + uv.y * uv.y * (0.24 - 0.43 * habit);
  #endif
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
        #ifdef SEA
          // a flower sea: green carries its kind and the flower's place in its bloom
          float sea = floor(instanceColor.g);
          float bloom = sea < 0.5 ? uBloom.x : sea < 1.5 ? uBloom.y : sea < 2.5 ? uBloom.z : uBloom.w;
          hidden = hidden || fract(instanceColor.g) / 0.9 >= bloom;
        #else
          hidden = hidden || instanceColor.g >= uDensity;
        #endif
      #endif
      if (hidden) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      // Only coverage fades at the outer streaming boundary. Size and wind use the rest pose.
      vFieldCover = 1.0 - smoothstep(uFieldFade.x, uFieldFade.y, range);
      vPlantMark = instanceMatrix[3].xz + position.xz + position.y * vec2(0.41, 0.73);
    #endif
    #ifdef PLANTS
      // A painted plant is a square card standing on its root, as tall as its instance says,
      // turned about the root to face the eye. Which of the row's pictures it is comes from
      // its wind seed, so it never changes.
      vec3 foot = instanceMatrix[3].xyz;
      vec2 toEye = cameraPosition.xz - (modelMatrix * vec4(foot, 1.0)).xz;
      vec2 facing = normalize(vec2(toEye.y, -toEye.x) + 1e-5);
      float tall = instanceMatrix[1].y;
      transformed = foot + vec3(facing.x * position.x, position.y, facing.y * position.x) * tall;
      vCardUv = uv;
      vPlantCell = floor(fract(instanceColor.b * 7.31) * ${PLANT_COLUMNS}.0);
    #else
    transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    mat3 basis = mat3(instanceMatrix);
    #if defined(TREE) || (defined(FIELD) && !defined(BLADES))
      // Trees and meadow flowers scale independently in height and width.
      objectNormal /= vec3(dot(basis[0], basis[0]), dot(basis[1], basis[1]), dot(basis[2], basis[2]));
    #endif
    objectNormal = basis * objectNormal;
    #endif
  #endif
  vec4 world = modelMatrix * vec4(transformed, 1.0);
  #ifdef TREE
    vTreePosition = world.xyz;
    vTreeView = (viewMatrix * world).xyz;
  #endif
  #ifdef CLOTH
    vClothDepth = -(viewMatrix * world).z;
    // where on its part this point is, in metres, turning with the part: the strokes are
    // painted on the cloth and move with it rather than sliding over it
    #ifdef USE_INSTANCING
      vCloth = mat3(instanceMatrix) * position;
    #else
      vCloth = position;
    #endif
  #endif
  #ifdef WATERWEED
    float current = 1.12 * uTime + world.x * 0.42 + world.z * 0.32 - 2.65 * position.y;
    world.xz += position.y * position.y * vec2(0.11 * sin(current), 0.057 * sin(0.79 * current + position.x * 2.2));
  #endif
  #ifdef WIND
    vec2 root = modelMatrix[3].xz;
    float height = max(position.y, 0.0);
    float seed = 0.5;
    #ifdef REEDS
      root = aReedRoot.xz;
      height = max(world.y - aReedRoot.y, 0.0);
      seed = aReedRoot.w;
    #elif defined(USE_INSTANCING)
      root = (modelMatrix * instanceMatrix[3]).xz;
      height *= instanceMatrix[1].y;
    #endif
    // Every vertex on a plant feels the same travelling gust at its root.
    vec2 air = texture2D(uWindMap, (root - uWindDrift) / 96.0).rg;
    float gust = smoothstep(0.22, 0.80, air.r);
    float side = 2.0 * air.g - 1.0;
    #ifdef USE_INSTANCING_COLOR
      seed = instanceColor.b;
    #endif
    float phase = seed;
    float flex = height;
    #ifdef BLADES
      phase += aBladePhase;
      flex *= uv.y * (0.84 + 0.30 * seed);
    #elif defined(REEDS)
      flex *= 0.53 * smoothstep(0.0, 1.6, height);
    #endif
    float flutter = sin(uTime * (2.4 + 0.9 * seed) + 6.2832 * phase + side);
    float speed = length(uWind);
    vec2 along = uWind / (4.0 + speed);
    vec2 across = vec2(-along.y, along.x);
    world.xz += flex * (along * (0.06 + 0.39 * gust + 0.095 * flutter)
                      + across * (0.25 * side + 0.075 * flutter));
    vGust = gust * speed / (3.0 + speed);
    #ifdef REEDS
      vTip = smoothstep(0.0, 1.2, height);
    #elif defined(PLANTS)
      vTip = uv.y;
    #else
      vTip = clamp(position.y / 0.4, 0.0, 1.0);
    #endif
  #else
    vTip = 1.0;
    vGust = 0.0;
  #endif
  #if defined(FIELD) && defined(USE_INSTANCING)
    // Compress the small capsule under a resting body, including the feet and supporting
    // hands. Roots stay planted; blades recover gradually with the standing-up blend.
    vec3 plantRoot = (modelMatrix * instanceMatrix[3]).xyz;
    vec2 fromBody = plantRoot.xz - uRestArea.xz;
    float alongBody = clamp(dot(fromBody, uRestDirection), -0.85, 0.75);
    float bodyDistance = length(fromBody - uRestDirection * alongBody);
    float press = uRestArea.w * (1.0 - smoothstep(0.40, 0.72, bodyDistance));
    press *= 1.0 - smoothstep(0.35, 0.65, abs(plantRoot.y - uRestArea.y));
    world.y = mix(world.y, plantRoot.y + (world.y - plantRoot.y) * 0.025, press);
  #endif
  float idx = aColor;
  #if defined(USE_INSTANCING_COLOR) && !defined(FISH)
    // instanced particles carry their palette index in the red channel
    idx = instanceColor.r;
    #if defined(FIELD) && !defined(BLADES) && !defined(PLANTS)
      // The petal template supplies a wash in the meadow range, the instance supplies its pigment.
      // The calyx, stalk and pollen carry ordinary palette colours.
      idx = aColor >= ${2 * MAX_COLORS}.0 ? aColor + idx : aColor;
    #endif
  #endif
  float sat;
  if (aSurface >= 0.0) {
    int s = int(aSurface + 0.5);
    vec2 state = texelFetch(uState, ivec2(s % uStateWidth, s / uStateWidth), 0).rg;
    int st = int(state.r * 255.0 + 0.5);
    sat = state.g;
    if (st >= 2) idx = float(st - 2);
  } else if (aSurface < -1.5 || idx >= ${MAX_COLORS}.0) {
    sat = 1.0;
  } else {
    sat = derivedSat(world.xyz) * uSceneSat;
  }
  // Petals carry their pigment above the palette and a wash strength in the fraction.
  vCode = idx < 0.0 || idx >= ${MAX_COLORS}.0 ? idx : idx + 0.9 * clamp(sat, 0.0, 1.0);
  vNormalV = normalize(normalMatrix * objectNormal);
  vPane = aPane;
  vGroundAt = world.xz;
  #ifdef BLADES
    vCardUv = uv;
  #endif
  // pushed out along the normal a little, so surfaces do not shadow themselves
  vec3 wn = normalize(mat3(modelMatrix) * objectNormal);
  vShadow = uShadowMatrix * vec4(world.xyz + wn * 0.12, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
  #ifdef VIEW_MODEL
    gl_Position.xy *= uViewScale;
  #endif
}`;

const frag = /* glsl */ `
precision highp float;
#ifdef FISH
uniform sampler2D uFishPaint;
#endif
uniform vec3 uLightDir;
uniform float uShadeBias;
uniform sampler2D uShadowMap;
uniform float uReversedDepth;
uniform vec3 uYardGrid;
uniform float uShadowTexel;
uniform float uShadowOn;
varying vec3 vNormalV;
varying float vCode;
varying vec4 vShadow;
varying vec2 vCardUv;
varying float vTip;
varying float vGust;
varying vec2 vPane;
varying vec2 vGroundAt;
#if defined(TREE) || defined(CLOTH)
uniform sampler2D uCanopyBrush;
#endif
#ifdef TREE
varying vec3 vTreePosition;
varying vec3 vTreeView;
#endif
#ifdef CLOTH
varying vec3 vCloth;
varying float vClothDepth;
#endif
#ifdef CHARACTER_PAINT
uniform sampler2D uCharacterPaint;
uniform float uCharacterPaintReady;
varying float vCharacterMaterial;
varying vec3 vPaintNormal;
float materialGrain(vec2 at, float slot) {
  // Mirror within the tile, with an inset to prevent neighbouring atlas bleed.
  vec2 repeatAt = 1.0 - abs(fract(at * 0.5) * 2.0 - 1.0);
  vec2 tile = vec2(mod(slot, 2.0), slot < 1.5 ? 1.0 : 0.0);
  vec2 uv = (tile + mix(vec2(0.015), vec2(0.985), repeatAt)) * 0.5;
  vec3 pigment = texture2D(uCharacterPaint, uv).rgb;
  float mean = slot < 0.5 ? 0.855 : slot < 1.5 ? 0.623 : slot < 2.5 ? 0.785 : 0.490;
  return clamp(dot(pigment, vec3(0.3, 0.59, 0.11)) - mean, -0.2, 0.2);
}
#endif
#ifdef PLANTS
uniform sampler2D uPlants;
varying float vPlantCell;
#endif

/**
 * 1 in sunlight, 0 in shadow, fading out at the map's edge. Eight taps on a ring turned by a
 * per-pixel random angle: the edge comes out soft and slightly grainy, like a brushed shadow,
 * instead of in square steps.
 */
/** The shadow map's depth at uv, the usual way round (0 near the sun, 1 far). */
float shadowAt(vec2 uv) {
  float d = texture2D(uShadowMap, uv).r;
  return uReversedDepth > 0.5 ? 1.0 - d : d;
}
float sunlight() {
  vec3 p = vShadow.xyz / vShadow.w;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  #ifdef WIND
    // grass and flowers: one tap. Blades sway and overlap many deep, so soft edges would not
    // show, but nine taps per layer of grass would cost more than the whole rest of the scene
    vec2 e1 = min(p.xy, 1.0 - p.xy);
    return mix(1.0, step(p.z - 0.0012, shadowAt(p.xy)), smoothstep(0.0, 0.08, min(e1.x, e1.y)));
  #endif
  float turn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
  #ifdef CLOTH
    // Animated figures need stable cel shadows at both viewing distances.
    // Random per-pixel taps make a hat shadow look like stubble on the face.
    turn = 0.35;
  #endif
  float sum = step(p.z - 0.0008, shadowAt(p.xy));
  for (int i = 0; i < 8; i++) {
    float a = turn + float(i) * 0.7854;
    float r = (i < 4 ? 1.4 : 2.8) * uShadowTexel;
    sum += step(p.z - 0.0008, shadowAt(p.xy + vec2(cos(a), sin(a)) * r));
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
  if (vPane.x < -2.5) {
    // A path's edge, broken up as a brush leaves it: broad tongues of earth and grass, and a
    // finer raggedness along them. Nothing is cut from the middle half of the path.
    vec2 q = vGroundAt * 1.9;
    vec2 qi = floor(q), qf = fract(q);
    qf = qf * qf * (3.0 - 2.0 * qf);
    #define PATH_HASH(p) fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)
    float broad = mix(mix(PATH_HASH(qi), PATH_HASH(qi + vec2(1.0, 0.0)), qf.x),
                      mix(PATH_HASH(qi + vec2(0.0, 1.0)), PATH_HASH(qi + vec2(1.0, 1.0)), qf.x), qf.y);
    float fine = PATH_HASH(floor(vGroundAt * 14.0));
    if (vPane.y > 0.5 + 0.42 * broad + 0.08 * fine) discard;
    if (vPane.x < -4.5) {
      // Resolve the yard edge within each cell in world space, across both triangles.
      float sides = floor(-vPane.x - 3.5);
      vec2 cell = fract((vGroundAt - uYardGrid.xy) / uYardGrid.z);
      float edge = 1.0;
      if (mod(sides, 2.0) >= 1.0) edge = min(edge, cell.x);
      if (mod(floor(sides / 2.0), 2.0) >= 1.0) edge = min(edge, 1.0 - cell.x);
      if (mod(floor(sides / 4.0), 2.0) >= 1.0) edge = min(edge, cell.y);
      if (mod(floor(sides / 8.0), 2.0) >= 1.0) edge = min(edge, 1.0 - cell.y);
      if (edge * uYardGrid.z < 0.13 + 0.86 * broad + 0.11 * fine) discard;
    }
  }
  #ifdef PLANTS
    // the painting: red how light, green how much it covers, blue what it is
    vec4 plant = texture2D(uPlants, vec2(
      (vPlantCell + clamp(vCardUv.x, 0.01, 0.99)) / ${PLANT_COLUMNS}.0,
      (float(PLANT_ROW) + 1.0 - clamp(vCardUv.y, 0.01, 0.99)) * 0.5));
    if (plant.g < 0.5) discard;
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
      // the leaf clusters face whoever is looking, so the crown's outline is cut into whole
      // leaves from every side (it shifts a little as one walks round the tree, not as one turns)
      vec2 toEye = cameraPosition.xz - p.xz;
      vec2 uv = vec2(dot(p.xz, normalize(vec2(toEye.y, -toEye.x))), p.y);
      vec2 sprigs = texture2D(uCanopyBrush, uv * 0.55).rg;
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
  #ifdef CLOTH
    // Cloth is painted like the rest of the world: long soft strokes down the folds, and
    // light that breaks unevenly across them. Skin stays almost smooth.
    vec2 foldUv = vec2(vCloth.x + 0.6 * vCloth.z, vCloth.y * 0.35) * 3.2;
    vec2 dabUv = vec2(vCloth.z - 0.45 * vCloth.x, vCloth.y + 0.55 * vCloth.x) * 4.1;
    float folds = texture2D(uCanopyBrush, foldUv).b - 0.48;
    float dabs = texture2D(uCanopyBrush, dabUv * 0.7 + 0.37).b - 0.46;
    float code = floor(vCode);
    bool skin = code == ${color('skinLight')}.0 || code == ${color('skinWarm')}.0 || code == ${color('skinDeep')}.0;
    shade += (folds * 0.09 + dabs * 0.04) * (skin ? 0.3 : 1.0);
    #ifdef CHARACTER_PAINT
      float slot = floor(vCharacterMaterial + 0.5);
      vec3 weights = pow(abs(normalize(vPaintNormal)), vec3(4.0));
      weights /= max(0.001, weights.x + weights.y + weights.z);
      // Rest-space triplanar coordinates deform with the skinned mesh, avoiding
      // texture swimming and the stretched seams of generated box UVs.
      vec3 at = vCloth * (slot < 0.5 ? 2.8 : slot < 1.5 ? 2.0 : 1.6);
      float grain = slot > 3.5 ? 0.0 : materialGrain(at.zy, slot) * weights.x
                  + materialGrain(at.xz, slot) * weights.y
                  + materialGrain(at.xy, slot) * weights.z;
      float strength = slot < 0.5 ? 0.28 : slot < 1.5 ? 0.20 : slot < 2.5 ? 0.07 : 0.24;
      shade += grain * strength * uCharacterPaintReady;
    #endif
  #endif
  // In the shadow of something: as dark as a face turned away from the sun. The paint pass
  // draws a firm edge where the shade crosses a narrow band just above one half (see its
  // light); a shadow's soft edge is spread over that band, so the whole of it shows as a
  // smooth penumbra instead of the shadow map's steps.
  if (uShadowOn > 0.5) {
    float sun = sunlight();
    if (sun < 1.0) shade = min(shade, 0.47 + 0.14 * sun);
  }
  #ifdef WIND
    // a tuft is dark down among the stems and catches the light at the tips
    shade = clamp(shade * mix(0.62, 1.12, vTip), 0.0, 1.0);
    #ifdef BLADES
      shade *= mix(0.90, 1.00, vCardUv.y) * (0.96 + 0.04 * sin(vCardUv.x * 3.1416));
    #endif
    // a gust turns the blades over and a wave of light runs across the meadow
    shade = clamp(shade + vGust * vTip * 0.18, 0.0, 1.0);
  #endif
  #ifdef PLANTS
    float code = vCode;
    #if PLANT_ROW == 1
      // a wildflower: its instance's pigment washed into the petals (thin where the painting
      // is pale, see the paint pass's petals), a yellow centre, the rest stem and leaf
      float colour = fract(vCode);
      if (plant.b > 0.75) code = ${color('yellow')}.0 + colour;
      else if (plant.b > 0.25) code = ${2 * MAX_COLORS}.0 + floor(vCode) + clamp((plant.r - 0.5) * 1.2, 0.06, 0.55);
      else {
        code = ${color('sprout')}.0 + colour;
        shade *= mix(0.8, 1.06, plant.r);
      }
      gl_FragColor = vec4(shade, code, n.x, n.y);
    #else
      // a tuft of grass: the painting's lights and darks over the blade's own shading, and
      // its cut edge feathered like a blade's
      shade = clamp(shade * mix(0.72, 1.0, plant.r), 0.0, 1.0);
      gl_FragColor = vec4(shade, code, 2.0, smoothstep(0.5, 0.85, plant.g));
    #endif
  #elif defined(FISH)
    vec3 pigment = texture2D(uFishPaint, vCardUv).rgb;
    gl_FragColor = vec4(shade, pigment.g, -2.0 - pigment.r, pigment.b);
  #elif defined(BLADES)
    gl_FragColor = vec4(shade, vCode, 2.0, coverage);
  #elif defined(CLOTH)
    // the normal's x lifted out of range marks a figure for the paint pass (renderer.ts),
    // which keeps building treatments (painted walls, paving) off people
    gl_FragColor = vec4(shade, vCode, n.x + 4.0, n.y);
  #else
    gl_FragColor = vPane.x > 0.5 ? vec4(shade, vCode, 7.0 + vPane.x, vPane.y) : vec4(shade, vCode, n.x, n.y);
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
  yardGrid?: THREE.Vector3;
  side?: THREE.Side;
  shadeBias?: number;
  /** World-space gust strength and lateral wind for grass and flowers. */
  wind?: THREE.Texture;
  /** Merged reed stems carry individual world-space wind roots. */
  reeds?: boolean;
  waterweed?: boolean;
  /** Shaped grass ribbons with a soft edge instead of a cutout texture. */
  blades?: boolean;
  /** A world-anchored field with a bounded drawing radius and seasonal density. */
  field?: FieldUniforms;
  /** Instanced figures in cloth (player characters): brush strokes painted on each part. */
  cloth?: boolean;
  /** Fixed first-person framing without stretching mesh proportions or normals. */
  viewModel?: boolean;
  /** Painted plants from the plant atlas, as cards that face the eye: a row of the atlas. */
  plants?: 'tufts' | 'flowers';
}

/** Shared, live uniforms for a field of plants (the owner updates the values each frame). */
export interface FieldUniforms {
  /** The player's position: the field's middle. */
  readonly uField: { value: THREE.Vector3 };
  /** Distances where the outer coverage fade begins and ends (metres). */
  readonly uFieldFade: { value: THREE.Vector2 };
  /** Share of this plant population visible this season, 0..1. */
  readonly uDensity: { value: number };
  /** A flower sea's field instead: how far each kind is in bloom (see grass.ts). */
  readonly uBloom?: { value: THREE.Vector4 };
}

export function makeInkMaterial(opts: InkMaterialOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLightDir: shared.uLightDir,
      uRestArea: shared.uRestArea,
      uRestDirection: shared.uRestDirection,
      uCities: shared.uCities,
      uCityCount: shared.uCityCount,
      uWells: shared.uWells,
      uWellCount: shared.uWellCount,
      uDrainInner: shared.uDrainInner,
      uDrainOuter: shared.uDrainOuter,
      uSceneSat: shared.uSceneSat,
      uArena: shared.uArena,
      uShadowMap: shared.uShadowMap,
      uReversedDepth: shared.uReversedDepth,
      uYardGrid: { value: opts.yardGrid ?? new THREE.Vector3(0, 0, 1) },
      uShadowMatrix: shared.uShadowMatrix,
      uShadowTexel: shared.uShadowTexel,
      uShadowOn: shared.uShadowOn,
      uTime: shared.uTime,
      ...(opts.wind
        ? { uWind: shared.uWind, uWindDrift: shared.uWindDrift, uWindMap: { value: opts.wind } }
        : {}),
      uCanopyBrush: shared.uCanopyBrush,
      ...(opts.plants ? { uPlants: shared.uPlants } : {}),
      uState: { value: opts.state?.texture ?? empty() },
      uStateWidth: { value: opts.state?.width ?? 1 },
      uShadeBias: { value: opts.shadeBias ?? 0 },
      ...(opts.viewModel ? { uViewScale: { value: 1 } } : {}),
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
      ...(opts.reeds ? { REEDS: '' } : {}),
      ...(opts.blades ? { BLADES: '' } : {}),
      ...(opts.field ? { FIELD: '' } : {}),
      ...(opts.field?.uBloom ? { SEA: '' } : {}),
      ...(opts.cloth ? { CLOTH: '' } : {}),
      ...(opts.viewModel ? { VIEW_MODEL: '' } : {}),
      ...(opts.plants ? { PLANTS: '', PLANT_ROW: opts.plants === 'tufts' ? 0 : 1 } : {}),
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
  private static readonly FADE_SECONDS = 1.8;
  readonly width = SurfaceStateTexture.WIDTH;
  readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly fading = new Map<number, number>();

  constructor(states: Uint8Array) {
    const rows = Math.max(1, Math.ceil(states.length / this.width));
    this.data = new Uint8Array(this.width * rows * 2);
    states.forEach((state, i) => {
      this.data[2 * i] = state;
      this.data[2 * i + 1] = state ? 255 : 0;
    });
    this.texture = new THREE.DataTexture(
      this.data,
      this.width,
      rows,
      THREE.RGFormat,
      THREE.UnsignedByteType,
    );
    this.texture.needsUpdate = true;
  }

  /** The state last uploaded for a surface (lags the save until set() is called). */
  get(surface: number): number {
    return this.data[2 * surface] ?? 0;
  }

  set(surface: number, state: number, fadeDelay?: number): void {
    this.data[2 * surface] = state;
    if (fadeDelay !== undefined && state !== 0) {
      this.fading.set(surface, -fadeDelay);
      this.data[2 * surface + 1] = 0;
    } else {
      this.fading.delete(surface);
      this.data[2 * surface + 1] = state ? 255 : 0;
    }
    this.texture.needsUpdate = true;
  }

  update(dt: number): void {
    for (const [surface, elapsed] of this.fading) {
      const age = elapsed + dt;
      const t = THREE.MathUtils.smoothstep(age, 0, SurfaceStateTexture.FADE_SECONDS);
      const value = Math.round(t * 255);
      if (value !== this.data[2 * surface + 1]) {
        this.data[2 * surface + 1] = value;
        this.texture.needsUpdate = true;
      }
      if (t === 1) this.fading.delete(surface);
      else this.fading.set(surface, age);
    }
  }

  dispose(): void {
    this.texture.dispose();
  }
}
