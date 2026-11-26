const task = await taskSpace(11);
const page = task.page('p1');
await page.goto('https://aishasound.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.body.innerText.includes('Professional Sound Effects'), undefined, { timeout: 15000 });
console.log(await page.snapshot());
