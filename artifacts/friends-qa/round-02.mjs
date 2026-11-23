const task = await taskSpace(10);
const page = task.page('p1');
await page.click('@1', { label: 'Join local test world' });
await page.waitForFunction(() => !!window.inkbloom, undefined, { timeout: 60000 });
console.log(await page.snapshot());
