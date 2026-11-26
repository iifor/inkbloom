const task = await taskSpace(9);
const page = task.page('p1');
await page.click('@1');
await page.waitForFunction(() => window.qa.status().some(a => a.file === 'inkbloom-colour-world.mp3' && a.time > .1), undefined, { timeout: 10000 });
const results = [await page.evaluate(() => ({ mode: 'colour', streams: window.qa.status() }))];
for (const [mode, file] of [['grey', 'inkbloom-grey-world.mp3'], ['winter', 'inkbloom-winter.mp3'], ['night', 'inkbloom-night.mp3'], ['tide', 'inkbloom-ink-tide.mp3']]) {
  await page.evaluate(mode => window.qa.scene(mode), mode);
  await page.waitForFunction(file => window.qa.status().some(a => a.file === file && a.time > .1 && !a.paused && !a.error), file, { timeout: 10000 });
  results.push(await page.evaluate(mode => ({ mode, streams: window.qa.status() }), mode));
}
const count = await page.evaluate(() => {
  const a = window.qa.elements.at(-1);
  a.currentTime = a.duration - 4.5;
  return window.qa.elements.length;
});
await page.waitForFunction(count => window.qa.elements.length > count && window.qa.elements.at(-1).currentTime > .1, count, { timeout: 10000 });
results.push(await page.evaluate(() => ({ mode: 'loop-overlap', streams: window.qa.status() })));
await page.evaluate(() => {
  for (const url of window.qa.tracks) window.qa.synth.stream('/' + url, { loop: false, gain: .55, bus: 'music' }).set(1);
});
await page.waitForFunction(() => ['inkbloom-colour-fields.mp3', 'inkbloom-blue-distance.mp3'].every(file => window.qa.status().some(a => a.file === file && a.time > .1 && !a.error)), undefined, { timeout: 10000 });
results.push(await page.evaluate(() => ({ mode: 'M01-M02', streams: window.qa.status() })));
await page.evaluate(() => { window.qa.failed = window.qa.synth.stream('/sounds/music/nonexistent-qa.mp3', { loop: false, gain: .55, bus: 'music' }); });
await page.waitForFunction(() => window.qa.failed.over, undefined, { timeout: 10000 });
results.push(await page.evaluate(() => ({ mode: 'missing-file', over: window.qa.failed.over, playing: window.qa.failed.playing })));
await page.evaluate(async () => { clearInterval(window.qa.timer); window.qa.music.dispose(); await window.qa.synth.dispose(); });
await page.waitForFunction(() => window.qa.elements.every(a => a.paused && !a.getAttribute('src')), undefined, { timeout: 10000 });
results.push(await page.evaluate(() => ({ mode: 'disposed', active: window.qa.status(), context: window.qa.synth.ctx })));
const fs = await import('node:fs/promises');
await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/music-qa/browser-results.json', JSON.stringify(results, null, 2));
console.log(results);
