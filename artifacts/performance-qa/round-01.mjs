const task = await taskSpace('InkBloom performance');
const page = task.page('p1');
await page.goto('http://127.0.0.1:5190/?world=performance-20261127&seed=4242');
console.log({ taskSpaceId: task.spaceId, page: page.label });
console.log(await page.snapshot());
