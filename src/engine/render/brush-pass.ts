// The brush pass, after the paint pass: softens the painted frame into patches of gouache and
// grades it like a painting (a light smooth Kuwahara filter, faint brush streaks, warm grade,
// vignette, grain). The brushwork itself is painted on the surfaces, in the paint pass; this
// pass only takes the hard computer edge off it, so it is kept small.
import * as THREE from 'three';
import { postVert } from './paint-shader';

/**
 * The brush pass: turns the rendered frame into strokes of paint, then grades it like a
 * painting. A smooth Kuwahara filter looks at six wedges of a circle around each pixel and
 * keeps the colour of the calmest ones, so areas break into rounded patches of paint with soft
 * edges while outlines stay sharp. Then: warm lift and a gentle S-curve, a little more colour, a
 * warm vignette, and fine grain over everything.
 */
export const brushFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uSpread;
uniform float uAspect;
uniform float uTime;
const float PI = 3.14159265;

/** Mean and spread of colour in one wedge of the circle around the pixel: the centre plus
 * two rings of three rays, 15 degrees apart. dir is the wedge's middle direction. */
void wedge(vec2 dir, vec3 centre, out vec3 mean, out float variance) {
  // ±15 degrees, without trigonometry per tap
  const float C = 0.9659258;
  const float S = 0.2588190;
  vec2 rays[3];
  rays[0] = vec2(dir.x * C - dir.y * S, dir.x * S + dir.y * C);
  rays[1] = dir;
  rays[2] = vec2(dir.x * C + dir.y * S, -dir.x * S + dir.y * C);
  vec3 sum = centre;
  vec3 sum2 = centre * centre;
  for (int ring = 1; ring <= 2; ring++)
    for (int ray = 0; ray < 3; ray++) {
      vec3 c = texture2D(tSrc, vUv + rays[ray] * (float(ring) * 1.5 * uSpread) * uTexel).rgb;
      sum += c;
      sum2 += c * c;
    }
  mean = sum / 7.0;
  vec3 v = abs(sum2 / 7.0 - mean * mean);
  variance = v.r + v.g + v.b;
}

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }

void main() {
  vec4 centre = texture2D(tSrc, vUv);
  vec3 col;
  if (centre.a < 0.85) {
    // Resolve thin leaf edges in painted RGB. Blending the G-buffer itself would mix
    // unrelated palette indices and depths. A solid blade needs only a little smoothing.
    vec2 e = uTexel * 1.15;
    vec4 left = texture2D(tSrc, vUv - vec2(e.x, 0.0));
    vec4 right = texture2D(tSrc, vUv + vec2(e.x, 0.0));
    vec4 up = texture2D(tSrc, vUv + vec2(0.0, e.y));
    vec4 down = texture2D(tSrc, vUv - vec2(0.0, e.y));
    vec4 weights = 0.3 + smoothstep(vec4(0.76), vec4(0.98), vec4(left.a, right.a, up.a, down.a));
    vec3 behind = (left.rgb * weights.x + right.rgb * weights.y + up.rgb * weights.z + down.rgb * weights.w) / dot(weights, vec4(1.0));
    col = mix(behind, centre.rgb, 0.90 * clamp(centre.a / 0.75, 0.0, 1.0));
  } else if (centre.a < 0.95) {
    // Fish already carry painted, mip-filtered marks. A broad brush kernel
    // would erase an entire eye or fin ray as the school turns away.
    col = centre.rgb;
  } else {
    vec3 acc = vec3(0.0);
    float total = 0.0;
    for (int k = 0; k < 6; k++) {
      vec3 mean;
      float variance;
      float ang = float(k) * (PI / 3.0);
      wedge(vec2(cos(ang), sin(ang)), centre.rgb, mean, variance);
      float w = 1.0 / (variance * 400.0 + 1e-3);
      w *= w;
      acc += mean * w;
      total += w;
    }
    col = acc / total;
    // brush streaks: fine ridges of paint dragged along the forms (across the local gradient),
    // stronger where the picture has structure, a soft cross-hatch of strokes where it is flat
    vec2 e = uTexel * uSpread * 2.0;
    vec2 grad = vec2(
      lum(texture2D(tSrc, vUv + vec2(e.x, 0.0)).rgb) - lum(texture2D(tSrc, vUv - vec2(e.x, 0.0)).rgb),
      lum(texture2D(tSrc, vUv + vec2(0.0, e.y)).rgb) - lum(texture2D(tSrc, vUv - vec2(0.0, e.y)).rgb));
    float edge = smoothstep(0.01, 0.08, length(grad));
    vec2 pp0 = gl_FragCoord.xy / max(uSpread, 1.0);
    // where it is flat the strokes turn this way and that in patches and cross over each
    // other; one fixed direction over a whole clear sky read as rain on the lens
    float turn = vnoise(pp0 * 0.006 + 31.0) * 6.2832;
    vec2 flat_ = vec2(cos(turn), sin(turn));
    vec2 across = mix(flat_, normalize(grad + 1e-6), edge);
    vec2 along = vec2(-across.y, across.x);
    float streak = vnoise(vec2(dot(pp0, along) * 0.07, dot(pp0, across) * 0.9));
    float hatch = vnoise(vec2(dot(pp0, across) * 0.07, dot(pp0, along) * 0.9) + 57.0);
    streak = mix(0.5 * (streak + hatch), streak, edge);
    col *= 1.0 + (streak - 0.5) * mix(0.015, 0.06, edge);
  }

  // grade like a painting: warm lift, gentle S-curve, a little more colour
  col = clamp(col * vec3(1.03, 1.0, 0.95) + vec3(0.022, 0.016, 0.004), 0.0, 1.0);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
  float l = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(vec3(l), col, 1.1);
  // warm vignette
  vec2 q = vUv - 0.5;
  q.x *= uAspect;
  col *= mix(vec3(0.9, 0.87, 0.84), vec3(1.0), smoothstep(0.95, 0.38, length(q)));
  // fine grain
  vec2 pp = gl_FragCoord.xy;
  col *= 1.0 + (hash(pp + fract(uTime * 7.0) * 113.0) - 0.5) * 0.02;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** The brush pass's material, reading the painted frame `src`; resize sets its texel, spread
 * and aspect. */
export function makeBrushMaterial(src: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: src },
      uTexel: { value: new THREE.Vector2() },
      uSpread: { value: 1 },
      uAspect: { value: 1 },
      uTime: { value: 0 },
    },
    vertexShader: postVert,
    fragmentShader: brushFrag,
    depthTest: false,
    depthWrite: false,
  });
}
