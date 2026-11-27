const task = await taskSpace(2);
const page = task.page('p1');
console.log(await page.snapshot());
console.log(await page.evaluate(() => {
  const api = window.inkbloom;
  api.game.loop.stop();
  const p = api.ctx.player.position;
  return { p: p.toArray(), towns: api.ctx.wilderness.entrancesNear(p.x,p.z,1).map(e => ({ ...e, name: api.ctx.cities.nameOf(e) })) };
}));
