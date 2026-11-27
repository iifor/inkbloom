const task = await taskSpace(20);
const page = task.page('p1');
await page.goto('http://127.0.0.1:5190/?world=performance-20261127&seed=4242');
await page.waitForFunction(() => !!window.inkbloom, undefined, { timeout: 60000 });
console.log(await page.snapshot());
console.log(await page.evaluate(() => ({ info: inkbloom.info(), paused: inkbloom.ctx.paused })));
