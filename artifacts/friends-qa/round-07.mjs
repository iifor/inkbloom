const task = await taskSpace(10);
const page = task.page('p1');
await page.keyboard.press('p');
console.log(await page.snapshot());
