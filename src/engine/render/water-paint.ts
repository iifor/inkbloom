// Water in the paint pass (paint-shader.ts): the rivers' current, read from a small table
// around the player, the rings a swimmer or a fish leaves, and the surface itself: the sky
// and whatever stands on the far bank mirrored in slow ripples that drift downstream, glints,
// the sun's web of light on the bed in the shallows, and foam along the shore.
import * as THREE from 'three';
import { MAX_COLORS } from '@/content/palette';
import { CURRENT_STEP } from '@/world/wilderness/water-current';
import { WATER_LEVEL } from '@/world/wilderness/water-level';

/** Ripple rings kept at once: six for the player, the rest for fish. */
export const WAKE_COUNT = 18;
export const RIVER_SAMPLES = 129;
const FLOW_CYCLE = 2;

/** The current's functions: riverFlow and currentRipple. */
export const riverGLSL = /* glsl */ `
/** The surface velocity in xy, and the blend between still and flowing ripples in z. */
vec3 riverFlow(vec2 p) {
  vec2 cell = (p - uRiverGrid.xy) / uRiverGrid.z;
  vec2 edge = min(cell, vec2(uRiverGrid.w - 1.0) - cell);
  float margin = min(edge.x, edge.y);
  if (!uWildWater || margin <= 0.0) return vec3(0.0);
  vec2 velocity = texture2D(uRivers, (cell + 0.5) / uRiverGrid.w).rg * smoothstep(0.0, 8.0, margin);
  return vec3(velocity, smoothstep(0.025, 0.8, length(velocity)));
}
/** Ripples stretched along the current. */
float currentRipple(vec2 p, vec3 flow) {
  vec2 dir = flow.xy / max(1e-4, length(flow.xy));
  vec2 q = vec2(dot(p, vec2(dir.y, -dir.x)), dot(p, dir));
  return vnoise(vec2(q.x * 1.6, q.y * 0.35)) * 0.6 + vnoise(q * 2.3) * 0.4;
}`;

/** What the water throws back and what the sun throws through it: bankPaint, a quick painting
 * of something seen in the water's mirror, and sunWeb, the web of light on a shallow bed. */
export const mirrorGLSL = /* glsl */ `
/** The colour of what the G-buffer holds at one pixel, painted quickly (its pigment in the
 * season's colour, in sun or in shade): enough for a reflection broken up by ripples. */
vec3 bankPaint(vec4 g, vec3 at) {
  float code = g.g < 0.0 ? float(uGrass) : g.g;
  if (code >= ${MAX_COLORS}.0) code = mod(floor(code), ${MAX_COLORS}.0) + 0.9;
  vec3 pigment = seasonal(paletteColor(code), seasonKindOf(code), at.xz);
  float inSun = smoothstep(0.0, 0.15, g.r * 2.0 - 1.0);
  vec3 c = pigment * mix(uShade * vec3(0.8, 0.8, 0.95), uSunColor, inSun);
  return mix(drainedAt(c), c, g.g < 0.0 ? derivedSat(at) * uSceneSat : satOf(code));
}
/** The sun's light gathered by the ripples into a moving web on what lies under shallow water:
 * two webs sliding across each other, brightest where their threads cross. */
float sunWeb(vec2 p) {
  vec2 a = p * 3.1 + vec2(uTime * 0.21, uTime * 0.13);
  vec2 b = p * 2.3 + vec2(-uTime * 0.17, uTime * 0.23) + 9.3;
  float wa = 1.0 - smoothstep(0.0, 0.07, abs(vnoise(a + (vnoise(b * 0.7) - 0.5) * 0.8) - 0.5));
  float wb = 1.0 - smoothstep(0.0, 0.07, abs(vnoise(b) - 0.5));
  return max(wa, wb) * 0.6 + wa * wb * 0.9;
}`;

export const wakeGLSL = /* glsl */ `
vec3 wakeLight(vec2 surface, float surfaceDist) {
  float rings = 0.0;
  float troughs = 0.0;
  for (int i=0; i<${WAKE_COUNT}; i++) {
    vec4 wake = uWakes[i];
    float age = uTime - wake.z;
    if (wake.w <= 0.0 || age < 0.0 || age > 2.4) continue;
    vec2 delta = surface - wake.xy - vec2(.04,.12) * age;
    delta.x *= 1.08;
    float radius = age * mix(1.15, 1.95, wake.w);
    if (dot(delta,delta) > (radius+.5)*(radius+.5)) continue;
    float distort = sin(3.4*delta.x+1.5*delta.y) * cos(2.6*delta.y+float(i));
    float crest = length(delta) - radius + .067 * distort;
    float width = .06 + .047*age + min(.19, surfaceDist * .002);
    vec2 band = vec2(crest,crest+.32)/width;
    float ring = exp(-band.x*band.x) + .45 * exp(-band.y*band.y);
    float fade = wake.w * smoothstep(.0,.14,age) * (1.0-smoothstep(.22,2.4,age));
    float fragments = mix(.32,1.0,smoothstep(-.65,.55,distort));
    rings += fade * ring * fragments;
    float lee = (crest-.13)/width;
    troughs += fade * exp(-lee*lee) * fragments;
  }
  return vec3(.45,.58,.5) * min(1.0,rings) - vec3(.12,.16,.15) * min(1.0,troughs);
}`;

/** The water's surface, inlined into the paint pass's main(): it works on that pass's locals
 * (s, wpos, rd, col, light, lit, sat, fish) and changes col. */
/** Metres from the eye within which a figure is the swimmer's own arms (see swim-arms.ts). */
export const OWN_ARMS = 1.2;

/** Overlapping circular wave packets, as in Unity's RainRipples. Their radial slopes perturb
 * the reflection normal; a separate crest mask keeps the rings visible under overcast skies. */
export const rainRingsGLSL = /* glsl */ `
vec3 rainRings(vec2 p, vec2 current, float density) {
  const float cellSize = 0.9;
  const float waveNumber = 46.0;
  const float windowRate = 3.14159265 / 0.34;
  vec2 cell = floor(p / cellSize);
  vec2 drift = current * (0.12 / max(1.0, length(current) * 0.5));
  vec2 slope = vec2(0.0);
  float crests = 0.0;
  // The maximum radius plus drift is smaller than one cell. Include neighbors so rings
  // cross cell boundaries instead of getting cut off.
  for (int z = -1; z <= 1; z++) {
    for (int x = -1; x <= 1; x++) {
      vec2 id = cell + vec2(float(x), float(z));
      vec2 seed = hash22(id);
      float period = mix(1.3, 2.1, seed.x);
      float phase = uTime / period + seed.y;
      float age = fract(phase) * period;
      if (age >= 1.1) continue;
      vec2 event = id + floor(phase) * vec2(1.73, 2.41);
      float drop = 1.0 - smoothstep(density - 0.1, density, hash21(event + 7.8));
      if (drop <= 0.0) continue;
      vec2 center = (id + mix(vec2(0.1), vec2(0.9), hash22(event + 4.0))) * cellSize;
      vec2 delta = p - center - drift * age;
      float r = length(delta);
      float edge = r - age * mix(0.32, 0.5, seed.y);
      if (edge < -0.27 || edge > 0.07) continue;
      float windowPhase = (edge + 0.27) * windowRate;
      float window = sin(windowPhase);
      float carrier = edge * waveNumber;
      float fade = drop * smoothstep(0.01, 0.14, age) * (1.0 - smoothstep(0.38, 1.1, age));
      // Differentiate the windowed sine along the radius to get the surface slope.
      float waveSlope = cos(carrier) * window * window + (2.0 * windowRate / waveNumber) * sin(carrier) * window * cos(windowPhase);
      slope -= (delta / max(r, 0.03)) * waveSlope * fade;
      crests += max(0.0, sin(carrier)) * window * window * fade;
    }
  }
  return vec3(clamp(slope, -1.0, 1.0), min(1.0, crests));
}`;

export const waterGLSL = /* glsl */ `
    float waterDepth = ${WATER_LEVEL} - wpos.y;
    bool submerged = uWildWater && waterDepth > 0.0;
    if (indexOf(s.g) == uWater || submerged) {
      // water mirrors the painted sky, more so at a glancing angle; slow ripple bands drift
      // across it and the sun glints off their crests
      vec3 eye = uInvView[3].xyz;
      float surfaceY = submerged ? ${WATER_LEVEL} : wpos.y;
      float t = clamp((eye.y - ${WATER_LEVEL}) / max(0.001, eye.y - wpos.y), 0.0, 1.0);
      vec2 rp = submerged ? mix(eye.xz, wpos.xz, t) : wpos.xz;
      // still water ripples in place; in a river the ripples stretch along the current and are
      // carried downstream: two copies drifting half a cycle apart, each faded out as it
      // starts over (the two-phase flow technique)
      float still = vnoise(vec2(rp.x * 0.35 + uTime * 0.06, rp.y * 1.6)) * 0.6 + vnoise(rp * 2.3 - uTime * 0.09) * 0.4;
      vec3 flow = riverFlow(rp);
      float rapids = smoothstep(0.55, 2.35, length(flow.xy));
      float ph0 = fract(uTime / ${FLOW_CYCLE.toFixed(1)});
      float ph1 = fract(ph0 + 0.5);
      float swap = abs(ph0 - 0.5) * 2.0;
      vec2 drift0 = flow.xy * ph0 * ${FLOW_CYCLE.toFixed(1)};
      vec2 drift1 = flow.xy * ph1 * ${FLOW_CYCLE.toFixed(1)};
      float rip = mix(still, mix(currentRipple(rp - drift0, flow), currentRipple(rp - drift1, flow), swap), flow.z);
      vec3 rainRipples = vec3(0.0);
      if (uRainfall > 0.01 && eye.y > surfaceY && !fish) {
        float range = 1.0 - smoothstep(9.0, 30.0, length(vec3(rp - eye.xz, surfaceY - eye.y)));
        if (range > 0.0) {
          float strength = smoothstep(0.01, 0.28, uRainfall) * range;
          rainRipples = rainRings(rp, flow.xy * flow.z, mix(0.25, 0.98, uRainfall)) * strength;
        }
      }
      vec2 surfaceSlope = (rip - 0.5) * vec2(0.12, 0.06) + rainRipples.xy * 0.14;
      vec3 rdir = reflect(rd, normalize(vec3(surfaceSlope.x, 1.0, surfaceSlope.y)));
      float grazing = 1.0 - clamp(-rd.y, 0.0, 1.0);
      vec3 reflected = skyPaint(rdir);
      // What stands on the bank is mirrored too: follow the reflected ray out over the water
      // in lengthening strides, and where it passes behind something the frame holds above
      // the waterline, paint that. (Only what is on screen can be mirrored; the rest is sky.)
      if (!fish && rdir.y > 0.01) {
        vec3 from = vec3(rp.x, surfaceY, rp.y);
        float stride = 0.5;
        float gone = 0.0;
        for (int k = 0; k < 14; k++) {
          gone += stride;
          stride *= 1.5;
          vec4 clip = uViewProj * vec4(from + rdir * gone, 1.0);
          if (clip.w <= 0.0) break;
          vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
          if (suv.x <= 0.0 || suv.x >= 1.0 || suv.y <= 0.0 || suv.y >= 1.0) break;
          float raw2 = texture2D(tDepth, suv).x;
          if (uReversedDepth > 0.5 ? raw2 <= 0.0 : raw2 >= 0.99999) continue;
          float d2 = linDepth(raw2);
          if (d2 > clip.w - 0.05 || d2 < clip.w - (1.5 + 0.6 * gone)) continue;
          vec4 c2 = uInvProj * vec4(suv * 2.0 - 1.0, -1.0, 1.0);
          vec3 ray2 = c2.xyz / c2.w;
          vec3 at2 = (uInvView * vec4(ray2 * (d2 / -ray2.z), 1.0)).xyz;
          if (at2.y < surfaceY + 0.05) continue;
          vec2 rim = min(suv, 1.0 - suv);
          vec3 bank = bankPaint(texture2D(tScene, suv), at2);
          // paler with distance, like everything far off
          bank = mix(bank, horizonOf(rdir), 1.0 - exp(-(d + gone) * 0.00065));
          reflected = mix(reflected, bank, smoothstep(0.0, 0.06, min(rim.x, rim.y)) * 0.85);
          break;
        }
      }
      vec3 water;
      float opacity;
      if (fish) {
        // Looking down, the reflection belongs to the lake surface, independent
        // of the fish's orientation. Below the surface only the water tint remains.
        float surface = smoothstep(-0.02, 0.06, eye.y - ${WATER_LEVEL});
        vec3 tint = paletteColor(float(uWater)) * mix(uShade, uSunColor, 0.62);
        water = mix(tint, reflected, surface * (0.12 + 0.60 * grazing * grazing));
        opacity = mix(0.16, 0.37, smoothstep(0.2, 1.4, waterDepth)) + surface * grazing * 0.16;
      } else {
        float fres = 0.2 + 0.7 * pow(grazing, 4.0);
        water = mix(paletteColor(float(uWater)) * light, reflected, fres);
        water += vec3(0.92, 0.96, 1.0) * smoothstep(0.76, 0.8, rip) * 0.22 * lit * (1.0 - uNight);
        // where a river runs fast, its ripples break into streaks of white
        water += vec3(0.95, 0.97, 1.0) * smoothstep(0.7, 0.86, rip) * rapids * 0.3 * mix(light, vec3(1.0), 0.4);
        float glint = pow(max(0.0, dot(rdir, uSun)), 120.0) * step(0.55, vnoise(rp * 5.0 + uTime * 1.3));
        water += uSunColor * glint * 1.4 * (1.0 - uNight);
        float rippleShade = clamp(dot(rainRipples.xy, vec2(0.09, -0.07)), -0.1, 0.1);
        water *= 1.0 + rippleShade;
        water = mix(water, vec3(0.82, 0.9, 0.98) * mix(light, vec3(1.0), 0.45), rainRipples.z * 0.42);
        opacity = submerged ? smoothstep(0.0, 0.22, waterDepth) * mix(0.38, 0.8, smoothstep(0.2, 3.0, waterDepth)) : 1.0;
        // seen at a glancing angle even shallow water is a mirror: the bed shows only when
        // one looks down into it
        // (only partly: a river seen from its bank is nearly all at a glancing angle, and a
        // full mirror there shows the pale horizon and nothing of the water's own colour)
        if (submerged) opacity = max(opacity, smoothstep(0.0, 0.12, waterDepth) * pow(grazing, 5.0) * 0.5);
        // the swimmer's own arms lie only just under the surface, yet should read as under it
        if (figure && d < ${OWN_ARMS.toFixed(1)}) opacity = max(opacity, 0.4 * smoothstep(0.0, 0.015, waterDepth));
      }
      // the sun's web of light on the bed, where the water is shallow enough to see it
      if (submerged && !fish) {
        float shallow = smoothstep(0.03, 0.25, waterDepth) * (1.0 - smoothstep(0.7, 2.2, waterDepth));
        // (a close thing: from across the river the web is finer than a brush could draw)
        shallow *= 1.0 - smoothstep(7.0, 24.0, d);
        col += col * uSunColor * sunWeb(wpos.xz) * shallow * lit * 0.3 * (1.0 - uNight) * (1.0 - uOvercast);
      }
      if (submerged && (!fish || eye.y > ${WATER_LEVEL})) water += wakeLight(rp, distance(rp, eye.xz)) * mix(0.4, 1.0, lit);
      col = mix(col, mix(drainedAt(water), water, sat), opacity);
      // broken lines of foam along the shore, where the water thins out over the bank
      if (submerged && !fish) {
        float shore = 1.0 - smoothstep(0.03, 0.32, waterDepth);
        vec2 sway = vec2(uTime * 0.18, uTime * 0.31);
        float laced = mix(vnoise((rp - drift0) * 1.6 + sway), vnoise((rp - drift1) * 1.6 + sway), swap);
        float lace = smoothstep(0.5, 0.78, mix(vnoise(rp * 1.6 + sway), laced, flow.z));
        vec3 foam = vec3(0.95, 0.97, 0.98) * mix(light, vec3(1.0), 0.4);
        col = mix(col, mix(drainedAt(foam), foam, sat), shore * lace * rapids * 0.55 * (1.0 - 0.6 * uNight));
      }
    }
    // a thin bright line where each of the swimmer's arms breaks the surface
    if (uWildWater && figure && d < ${OWN_ARMS.toFixed(1)}) {
      float meniscus = 1.0 - smoothstep(0.002, 0.007, abs(waterDepth));
      col = mix(col, vec3(0.94, 0.97, 1.0) * mix(light, vec3(1.0), 0.5), meniscus * 0.45 * (1.0 - 0.6 * uNight));
    }`;

/** The surface velocity field around the player, as a texture for the paint pass. */
export class RiverTable {
  private readonly data = new Uint16Array(RIVER_SAMPLES * RIVER_SAMPLES * 2);
  readonly texture = Object.assign(
    new THREE.DataTexture(this.data, RIVER_SAMPLES, RIVER_SAMPLES, THREE.RGFormat, THREE.HalfFloatType),
    { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter },
  );

  set(x0: number, z0: number, at: (x: number, z: number) => { x: number; z: number }): void {
    for (let row = 0; row < RIVER_SAMPLES; row++)
      for (let column = 0; column < RIVER_SAMPLES; column++) {
        const v = at(x0 + column * CURRENT_STEP, z0 + row * CURRENT_STEP);
        const i = (row * RIVER_SAMPLES + column) * 2;
        this.data[i] = THREE.DataUtils.toHalfFloat(v.x);
        this.data[i + 1] = THREE.DataUtils.toHalfFloat(v.z);
      }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
