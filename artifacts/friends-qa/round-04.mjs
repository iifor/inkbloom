const task = await taskSpace(10);
const page = task.page('p1');
console.log(await page.snapshot());
await page.click('loc=role:button[name="在线伙伴 · 定位 / 传送"]', { label: 'Open refreshed friends menu' });
await page.click('loc=role:button[name="定位伙伴"]', { label: 'Track distant test friend' });
console.log(await page.evaluate(() => ({ guide: document.querySelector('.hud-friend')?.textContent,
  position: window.inkbloom.ctx.player.position.toArray() })));
console.log(await page.screenshot({ path: 'C:/Users/Administrator/Desktop/inkbloom/artifacts/friends-qa/menu.png' }));
