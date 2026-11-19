const task = await taskSpace(17);
const page = task.page('p1');
await page.click('@2');
console.log(await page.evaluate(() => ({keys:Object.keys(window.inkbloom??{}), errors:document.querySelector('.fatal')?.textContent})));
