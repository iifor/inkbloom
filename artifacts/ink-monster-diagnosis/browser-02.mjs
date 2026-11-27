const task = await taskSpace(2);
const page = task.page('p1');
await page.waitForFunction(() => !!window.inkbloom?.ctx, undefined, { timeout: 30000 });
console.log(await page.evaluate(() => ({ tools: Object.keys(window.inkbloom), game: Object.keys(window.inkbloom.game), pos: window.inkbloom.ctx.player.position.toArray(), scene: window.inkbloom.ctx.scenes.active.ref })));
console.log(await page.snapshot());
