const task = await taskSpace(10);
const page = task.page('p1');
await page.waitForSelector('loc=role:button[name="在线伙伴 · 定位 / 传送"]', { state: 'visible', timeout: 15000 });
await page.click('loc=role:button[name="在线伙伴 · 定位 / 传送"]', { label: 'Open online friends menu' });
console.log(await page.snapshot());
