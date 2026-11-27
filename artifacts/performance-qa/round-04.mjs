const task = await taskSpace(20);
const page = task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride', {width:1280,height:720,deviceScaleFactor:1,mobile:false});
console.log(await page.evaluate(async () => {
  const game = inkbloom.game;
  const wild = game.scenes.wild;
  window.perfParts = {};
  for (const [key, value] of Object.entries(wild)) {
    if (!value || typeof value.update !== 'function') continue;
    const original = value.update.bind(value);
    const record = perfParts[key] = { total:0, max:0, n:0, slow:0 };
    value.update = (...args) => { const start=performance.now(); const out=original(...args); const ms=performance.now()-start; record.total+=ms; record.max=Math.max(record.max,ms); record.n++; if(ms>8)record.slow++; return out; };
  }
  return {info:inkbloom.info(), profile:await inkbloom.profile(4), parts:perfParts};
}));
