const task = await taskSpace('InkBloom seated and lying multiplayer QA');
console.log({ space: task.spaceId });
const page = task.page('p1');
await page.goto('http://localhost:5190/?server=127.0.0.1:5197');
console.log(await page.snapshot());
