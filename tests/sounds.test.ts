import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BEDS, SOUNDS, TRACKS } from '@/content/sounds';

const PUBLIC = join(__dirname, '..', 'public');

describe('recorded sounds', () => {
  it('every listed recording is in public/', () => {
    for (const [key, urls] of Object.entries(SOUNDS)) {
      expect(urls.length, key).toBeGreaterThan(0);
      for (const url of urls) expect(existsSync(join(PUBLIC, url)), url).toBe(true);
    }
  });

  it('every ambience bed and music track is in public/', () => {
    for (const url of [...Object.values(BEDS), ...TRACKS])
      expect(existsSync(join(PUBLIC, url)), url).toBe(true);
  });

  it('every recording shipped is used, so no dead weight goes out', () => {
    const used = new Set<string>([...Object.values(SOUNDS).flat(), ...Object.values(BEDS), ...TRACKS]);
    for (const dir of ['kenney', 'ambience', 'music'])
      for (const file of readdirSync(join(PUBLIC, 'sounds', dir)))
        expect(used.has(`sounds/${dir}/${file}`), file).toBe(true);
  });
});
