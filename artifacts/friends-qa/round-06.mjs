const task = await taskSpace(10);
const page = task.page('p1');
await page.waitForFunction(() => window.inkbloom.ctx.player.grounded, undefined, { timeout: 10000 });
console.log(await page.evaluate(() => ({ position: window.inkbloom.ctx.player.position.toArray(), grounded: window.inkbloom.ctx.player.grounded,
  guide: document.querySelector('.hud-friend')?.textContent })));
console.log(await page.screenshot({ path: 'C:/Users/Administrator/Desktop/inkbloom/artifacts/friends-qa/grounded.png' }));
console.log((await page.events()).filter(e => /exceptionThrown|consoleAPICalled/.test(e.method)).slice(-8));
