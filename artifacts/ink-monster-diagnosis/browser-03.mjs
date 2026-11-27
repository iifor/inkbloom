const task = await taskSpace(2);
const page = task.page('p1');
console.log(await page.snapshot());
console.log(await page.evaluate(() => ({ hidden: document.hidden, ready: document.readyState, dev: typeof window.inkbloom })));
