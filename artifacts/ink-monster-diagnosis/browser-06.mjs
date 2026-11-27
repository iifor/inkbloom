const task = await taskSpace(2);
const page = task.page('p1');
console.log(await page.evaluate(() => ({ ready: !!window.inkbloom, status: document.body.innerText.slice(-600) })));
console.log(await page.snapshot());
