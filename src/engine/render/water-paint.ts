// Water in the paint pass (paint-shader.ts): the rivers' current, read from a small table
// around the player, the rings a swimmer or a fish leaves, and the surface itself: the sky
// and whatever stands on the far bank mirrored in slow ripples that drift downstream, glints,
// the sun's web of light on the bed in the shallows, and foam along the shore.
import * as THREE from 'three';
import { MAX_COLORS } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { RIVER_LANE, RIVER_X, WATER_LEVEL } from '@/world/wilderness/generator';

/** Ripple rings kept at once: six for the player, the rest for fish. */
export const WAKE_COUNT = 18;
/** The rivers' table: lanes around the player and samples along each. */
export const RIVER_ROWS = 3;
export const RIVER_SAMPLES = 129;
/** A river's current mid-channel, metres a second, and the seconds of one flow phase. */
const FLOW_SPEED = 1.3;
const FLOW_CYCLE = 2;

/** The current's functions: riverFlow and currentRipple. */
export const riverGLSL = /* glsl */ `
/**
 * The river current at p: xy its velocity (metres a second, downstream along +z), z how much
 * of it is river (1 in mid-channel, 0 at the bank and in still water). The rivers' middles
 * and half-widths come from a small table around the player (see setRivers).
 */
vec3 riverFlow(vec2 p) {
  float lane = floor((p.x - uRiverLane.x) / uRiverLane.y + 0.5);
  float row = lane - uRiverGrid.x;
  float u = (p.y - uRiverGrid.y) / uRiverGrid.z;
  if (row < 0.0 || row > ${RIVER_ROWS - 1}.0 || u < 0.0 || u > ${RIVER_SAMPLES - 2}.0) return vec3(0.0);
  float v = (row + 0.5) / ${RIVER_ROWS}.0;
  vec2 a = texture2D(uRivers, vec2((u + 0.5) / ${RIVER_SAMPLES}.0, v)).rg;
  vec2 b = texture2D(uRivers, vec2((u + 1.5) / ${RIVER_SAMPLES}.0, v)).rg;
  float middle = uRiverLane.x + lane * uRiverLane.y + a.x;
  float across = abs(p.x - middle) / a.y;
  float strength = 1.0 - smoothstep(0.55, 1.05, across);
  vec2 dir = normalize(vec2((b.x - a.x) / uRiverGrid.z, 1.0));
  // fastest mid-channel, slowing towards the banks
  return vec3(dir * ${FLOW_SPEED.toFixed(2)} * (1.0 - 0.6 * across * across), strength);
}
/** Ripples stretched along the current. */
float currentRipple(vec2 p, vec3 flow) {
  vec2 dir = normalize(flow.xy + vec2(0.0, 1e-4));
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

/** Raindrop rings on the water at `p` (metres): a few staggered layers of cells, each drop in a
 * cell landing on its own beat and spreading a ring. Returns how much ring is here, 0..1. */
export const rainRingsGLSL = /* glsl */ `
float rainRings(vec2 p, float rain) {
  float ring = 0.0;
  for (int k = 0; k < 3; k++) {
    vec2 q = p * 4.5 + float(k) * vec2(3.7, 1.3);
    vec2 id = floor(q);
    float seed = hash21(id + float(k) * 17.0);
    // only some cells have a drop: more in a downpour
    if (seed > 0.25 + 0.75 * rain) continue;
    vec2 at = id + 0.2 + 0.6 * hash22(id + 4.0);
    float age = fract(uTime * (1.1 + 0.6 * seed) + seed * 7.0);
    float r = length(q - at);
    float edge = abs(r - age * 0.45);
    ring = max(ring, (1.0 - smoothstep(0.0, 0.05 + 0.04 * age, edge)) * (1.0 - age) * (1.0 - age));
  }
  return ring;
}`;

export const waterGLSL = /* glsl */ `
    float waterDepth = ${WATER_LEVEL} - wpos.y;
    bool submerged = uWildWater && waterDepth > 0.0;
    if (indexOf(s.g) == uWater || submerged) {
      // water mirrors the painted sky, more so at a glancing angle; slow ripple bands drift
      // across it and the sun glints off their crests
      vec3 eye = uInvView[3].xyz;
      float t = clamp((eye.y - ${WATER_LEVEL}) / max(0.001, eye.y - wpos.y), 0.0, 1.0);
      vec2 rp = submerged ? mix(eye.xz, wpos.xz, t) : wpos.xz;
      // still water ripples in place; in a river the ripples stretch along the current and are
      // carried downstream: two copies drifting half a cycle apart, each faded out as it
      // starts over (the two-phase flow technique)
      float still = vnoise(vec2(rp.x * 0.35 + uTime * 0.25, rp.y * 1.6)) * 0.6 + vnoise(rp * 2.3 - uTime * 0.4) * 0.4;
      vec3 flow = riverFlow(rp);
      float ph0 = fract(uTime / ${FLOW_CYCLE.toFixed(1)});
      float ph1 = fract(ph0 + 0.5);
      float swap = abs(ph0 - 0.5) * 2.0;
      vec2 drift0 = flow.xy * ph0 * ${FLOW_CYCLE.toFixed(1)};
      vec2 drift1 = flow.xy * ph1 * ${FLOW_CYCLE.toFixed(1)};
      float rip = mix(still, mix(currentRipple(rp - drift0, flow), currentRipple(rp - drift1, flow), swap), flow.z);
      vec3 rdir = reflect(rd, normalize(vec3((rip - 0.5) * 0.12, 1.0, (rip - 0.5) * 0.06)));
      float grazing = 1.0 - clamp(-rd.y, 0.0, 1.0);
      vec3 reflected = skyPaint(rdir);
      // What stands on the bank is mirrored too: follow the reflected ray out over the water
      // in lengthening strides, and where it passes behind something the frame holds above
      // the waterline, paint that. (Only what is on screen can be mirrored; the rest is sky.)
      if (!fish && rdir.y > 0.01) {
        vec3 from = vec3(rp.x, ${WATER_LEVEL}, rp.y);
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
          if (at2.y < ${WATER_LEVEL} + 0.05) continue;
          vec2 rim = min(suv, 1.0 - suv);
          vec3 bank = bankPaint(texture2D(tScene, suv), at2);
          // paler with distance, like everything far off
          bank = mix(bank, horizonOf(rdir), 1.0 - exp(-(d + gone) * 0.0042));
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
        water += vec3(0.95, 0.97, 1.0) * smoothstep(0.7, 0.86, rip) * flow.z * 0.3 * mix(light, vec3(1.0), 0.4);
        float glint = pow(max(0.0, dot(rdir, uSun)), 120.0) * step(0.55, vnoise(rp * 5.0 + uTime * 1.3));
        water += uSunColor * glint * 1.4 * (1.0 - uNight);
        // rain: each drop that lands starts a small ring spreading out and fading, more of them
        // the harder it rains; too fine to see far off
        if (uRainfall > 0.01) {
          float rings = rainRings(rp, uRainfall) * (1.0 - smoothstep(8.0, 28.0, d));
          water = mix(water, vec3(0.9, 0.94, 0.98) * mix(light, vec3(1.0), 0.5), rings * 0.55);
        }
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
        col = mix(col, mix(drainedAt(foam), foam, sat), shore * lace * 0.55 * (1.0 - 0.6 * uNight));
      }
    }
    // a thin bright line where each of the swimmer's arms breaks the surface
    if (uWildWater && figure && d < ${OWN_ARMS.toFixed(1)}) {
      float meniscus = 1.0 - smoothstep(0.002, 0.007, abs(waterDepth));
      col = mix(col, vec3(0.94, 0.97, 1.0) * mix(light, vec3(1.0), 0.5), meniscus * 0.45 * (1.0 - 0.6 * uNight));
    }`;

/** River middles and half-widths around the player, as a texture for the paint pass. */
export class RiverTable {
  private readonly data = new Uint16Array(RIVER_SAMPLES * RIVER_ROWS * 2);
  readonly texture = Object.assign(
    new THREE.DataTexture(this.data, RIVER_SAMPLES, RIVER_ROWS, THREE.RGFormat, THREE.HalfFloatType),
    { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter },
  );

  /**
   * Where the rivers run around the player: `RIVER_ROWS` lanes from `lane`, sampled every
   * `step` metres of z from `z0`; `at(lane, z)` gives a river's middle and half-width.
   */
  set(
    lane: number,
    z0: number,
    step: number,
    at: (lane: number, z: number) => { x: number; half: number },
  ): void {
    const data = this.data;
    const spawnX = TUNING.world.chunkSize / 2 + RIVER_X;
    for (let r = 0; r < RIVER_ROWS; r++)
      for (let k = 0; k < RIVER_SAMPLES; k++) {
        const river = at(lane + r, z0 + k * step);
        // relative to the lane's own line, so half floats keep centimetres
        const i = (r * RIVER_SAMPLES + k) * 2;
        data[i] = THREE.DataUtils.toHalfFloat(river.x - spawnX - (lane + r) * RIVER_LANE);
        data[i + 1] = THREE.DataUtils.toHalfFloat(river.half);
      }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
