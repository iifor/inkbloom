const task = await taskSpace(2);
const page = task.page('p1');
console.log(await page.evaluate(() => {
  const { game, ctx } = window.inkbloom;
  game.loop.stop();
  return { id: ctx.state.id, seed: ctx.state.seed, game: Object.keys(game), systems: game.loop.systems.map(s => s.id) };
}));
