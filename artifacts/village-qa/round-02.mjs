const task = await taskSpace(17);
const page = task.page('p1');
await page.click('loc=role:button[name^="开始"]');
console.log(await page.evaluate(() => ({keys:Object.keys(window.inkbloom??{}), errors:document.querySelector('.fatal')?.textContent})));
