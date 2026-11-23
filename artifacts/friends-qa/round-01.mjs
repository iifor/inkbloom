const task = await taskSpace('InkBloom friends travel QA');
const page = task.page('p1');
console.log({ space: task.spaceId });
await page.goto('http://localhost:5190/?server=127.0.0.1:5196');
console.log(await page.snapshot());
