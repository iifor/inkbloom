const task = await taskSpace('InkBloom sound library research');
const page = task.page('p1');
await page.goto('https://aishasound.com/public-libraries/');
console.log({ taskSpaceId: task.spaceId });
console.log(await page.snapshot({ scope: 'full_page' }));
