// Rebuild only the licensed in-game excerpts; original downloads stay outside public/ and Git.
// Usage: node scripts/prepare-aisha-audio.mjs C:/path/to/ffmpeg.exe
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ffmpeg = process.argv[2] || 'ffmpeg';
const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'art/audio/aisha/source');
const specs = [
  {
    id: 'A02',
    input: 'countryside-birds-insects.wav',
    output: 'aisha-meadow-birds.ogg',
    start: 10,
    length: 62,
    overlap: 2,
    filter: 'highpass=f=180,lowpass=f=7000',
  },
  {
    id: 'A05',
    input: 'countryside-heavy-wind.wav',
    output: 'aisha-wind.ogg',
    start: 10,
    length: 62,
    overlap: 2,
    filter: 'highpass=f=70,lowpass=f=6000',
  },
  {
    id: 'A06',
    input: 'wind-gust.wav',
    output: 'aisha-glide-wind.ogg',
    start: 0.5,
    length: 6.5,
    overlap: 0.5,
    filter: 'highpass=f=90,lowpass=f=5000',
  },
  {
    id: 'A09',
    input: 'dark-drone.wav',
    output: 'aisha-ink-rumble.ogg',
    start: 3,
    length: 52,
    overlap: 2,
    filter: 'highpass=f=35,lowpass=f=200',
  },
];
const run = (args) => {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr);
  return result.stderr;
};
const manifest = specs.map((s) => {
  const input = resolve(source, s.input);
  // Rotate the seam to a continuous middle section; overlap the original tail and head.
  const chain =
    `[0:a]atrim=start=${s.start}:duration=${s.length},asetpts=PTS-STARTPTS,${s.filter},asplit=3[head][middle][tail];` +
    `[head]atrim=end=${s.overlap},asetpts=PTS-STARTPTS[h];` +
    `[middle]atrim=start=${s.overlap}:end=${s.length - s.overlap},asetpts=PTS-STARTPTS[m];` +
    `[tail]atrim=start=${s.length - s.overlap},asetpts=PTS-STARTPTS[t];` +
    `[t][h]acrossfade=d=${s.overlap}:c1=tri:c2=tri[j];[m][j]concat=n=2:v=0:a=1[loop]`;
  const stats = run([
    '-i',
    input,
    '-filter_complex',
    chain + ';[loop]volumedetect[out]',
    '-map',
    '[out]',
    '-f',
    'null',
    '-',
  ]);
  const mean = Number(stats.match(/mean_volume: (-?[\d.]+) dB/)?.[1]);
  const peak = Number(stats.match(/max_volume: (-?[\d.]+) dB/)?.[1]);
  if (!Number.isFinite(mean) || !Number.isFinite(peak))
    throw new Error(`No level measurements for ${s.input}`);
  const gain = Math.min(-24 - mean, -6 - peak);
  const output = resolve(root, 'public/sounds/ambience', s.output);
  run([
    '-y',
    '-i',
    input,
    '-filter_complex',
    chain + `;[loop]volume=${gain}dB[out]`,
    '-map',
    '[out]',
    '-map_metadata',
    '-1',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-c:a',
    'libvorbis',
    '-q:a',
    '5',
    output,
  ]);
  run(['-v', 'error', '-i', output, '-f', 'null', '-']);
  const record = {
    ...s,
    duration: s.length - s.overlap,
    inputMeanDb: mean,
    inputPeakDb: peak,
    gainDb: gain,
    sourceSha256: createHash('sha256').update(readFileSync(input)).digest('hex'),
    outputSha256: createHash('sha256').update(readFileSync(output)).digest('hex'),
    bytes: readFileSync(output).length,
  };
  console.log(`${s.id}: ${s.output}, ${record.duration}s, ${record.bytes} bytes`);
  return record;
});
writeFileSync(resolve(root, 'art/audio/aisha/processed.json'), JSON.stringify(manifest, null, 2) + '\n');
