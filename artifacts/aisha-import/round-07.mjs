const task = await taskSpace(11);
const page = task.page('p1');
await page.fill('input[name="sound-search"]', 'rain');
await page.click('button[aria-label="Open filters"]');
console.log(await page.snapshot());
