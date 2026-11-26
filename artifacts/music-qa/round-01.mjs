const task = await taskSpace('InkBloom music validation');
const page = task.page('p1');
await page.goto('http://127.0.0.1:5192/artifacts/music-qa/page.html');
console.log({ taskSpaceId: task.spaceId });
console.log(await page.snapshot());
