const task = await taskSpace(10);
const page = task.page('p1');
await page.click('loc=role:button[name="传送到身边"]', { label: 'Teleport beside test friend' });
await page.waitForFunction(() => window.inkbloom.ctx.player.position.x > 1900, undefined, { timeout: 20000 });
console.log(await page.evaluate(() => ({ position: window.inkbloom.ctx.player.position.toArray(),
  flying: window.inkbloom.ctx.player.flying,
  guide: document.querySelector('.hud-friend')?.textContent,
  ground: window.inkbloom.ctx.player.grounded,
  water: window.inkbloom.ctx.player.waterMode,
  friends: window.inkbloom.ctx.net.friends })));
console.log(await page.screenshot({ path: 'C:/Users/Administrator/Desktop/inkbloom/artifacts/friends-qa/arrived.png' }));
console.log(await page.events());
