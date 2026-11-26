// Run with AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in the environment.
// Credentials remain in this build-time process; only MP3 files enter the game.
import { mkdir, writeFile, rename, rm, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const key = process.env.AZURE_SPEECH_KEY;
const region = process.env.AZURE_SPEECH_REGION;
if (!key || !region || !/^[a-z0-9-]+$/.test(region)) {
  console.error('Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION before generating NPC voices.');
  process.exit(1);
}
const output = fileURLToPath(new URL('../public/sounds/voices/', import.meta.url));
const { lines, voices } = JSON.parse(
  (await readFile(new URL('../src/content/npc-voices.json', import.meta.url), 'utf8')).replace(/^\uFEFF/, ''),
);
await mkdir(output, { recursive: true });
for (const [index, profile] of voices.entries()) {
  const voice = profile.name;
  for (const { id, text, style: requestedStyle } of lines) {
    const style = profile.styles[requestedStyle];
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-CN"><voice name="${voice}"><mstts:express-as style="${style}" styledegree="1.15"><prosody rate="-5%">${text}</prosody></mstts:express-as></voice></speak>`;
    const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'InkbloomVoiceBuild',
      },
      body: ssml,
    });
    if (!response.ok) throw new Error(`Azure Speech failed (${response.status}) for ${voice}/${id}`);
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.length < 100) throw new Error(`Empty audio for ${voice}/${id}`);
    const target = path.join(output, `${index}-${id}.mp3`);
    const temp = target + '.tmp';
    try {
      await writeFile(temp, audio);
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true });
    }
    console.log(`Generated ${index}-${id}.mp3 (${audio.length} bytes)`);
  }
}
