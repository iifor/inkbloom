import { writeFileSync } from 'node:fs';
import { createWilderness } from '../src/world/wilderness/generator';
import { createSettlementLinks } from '../src/world/wilderness/settlement-links';
const reports = [];
let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="820" viewBox="0 0 1440 820"><rect width="1440" height="820" fill="#f4f0df"/><style>text{font-family:system-ui,sans-serif;fill:#324837}</style>';
for (const version of [4, 5] as const) {
  const start = performance.now();
  const w = createWilderness(4242, [], version);
  const towns = [];
  for (let gx = -4; gx <= 4; gx++) for (let gz = -4; gz <= 4; gz++) {
    const t = w.entranceInCell(gx, gz);
    if (t) towns.push(t);
  }
  const elapsed = performance.now() - start;
  const linksOf = createSettlementLinks(w);
  const links = new Map(towns.flatMap(t => linksOf(t).map(l => [l.id, l] as const)));
  const nearest = towns.map(a => Math.min(...towns.filter(b => a !== b).map(b => Math.hypot(a.x - b.x, a.z - b.z))));
  reports.push({ version, count: towns.length, generationMs: Math.round(elapsed), minSpacing: Math.min(...nearest), maxNearest: Math.max(...nearest), originNeighbours: towns.filter(t=>Math.abs(t.x)<1500&&Math.abs(t.z)<1500).map(t=>[t.cityId,t.x,t.z]), sample: [w.entranceInCell(2,3),w.entranceInCell(1,1)] });
  const left = version === 4 ? 30 : 740, top = 95, scale = 680 / 8064;
  const px = (x:number) => left + (x + 3968) * scale;
  const py = (z:number) => top + (z + 3968) * scale;
  svg += `<text x="${left}" y="42" font-size="24">${version===4?'Before / regular cells':'After / terrain-guided villages'}</text><text x="${left}" y="73" font-size="17">Seed 4242 · 8 × 8 km · ${towns.length} settlements</text><rect x="${left}" y="${top}" width="680" height="680" fill="#d8e0bc"/>`;
  for(let x=-3968;x<4096;x+=64)for(let z=-3968;z<4096;z+=64){const h=w.rawHeightAt(x,z);const c=h<1?'#a9cbd0':h>32?'#9ead86':h>15?'#bbc69f':'#d8e0bc';svg+=`<rect x="${px(x)}" y="${py(z)}" width="5.5" height="5.5" fill="${c}"/>`;}
  for(const t of towns){svg+=`<rect x="${px(t.ox)}" y="${py(t.oz)}" width="${t.size*scale}" height="${t.size*scale}" rx="3" fill="#8b6240" stroke="#f4e5c1" stroke-width="1.2"/><circle cx="${px(t.x)}" cy="${py(t.z)}" r="2" fill="#fff3da"/>`;}
}
svg+='<text x="30" y="807" font-size="16">Settlement footprint survey (not an in-game screenshot). Green: terrain elevation; brown: village footprint.</text></svg>';
writeFileSync('artifacts/settlement-layout-comparison.svg',svg);
writeFileSync('artifacts/settlement-survey.json',JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports,null,2));
