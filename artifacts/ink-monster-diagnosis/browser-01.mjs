const task = await taskSpace('感染墨怪与昼夜回归');
const page = task.page('p1');
console.log({ taskSpaceId: task.spaceId });
await page.goto('http://127.0.0.1:5192/?world=infection-fix-1127&seed=173');
console.log(await page.snapshot());
