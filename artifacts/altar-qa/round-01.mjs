const task = await taskSpace('InkBloom travel altar QA');
const page = task.page('p1');
await page.goto('http://127.0.0.1:5190/?world=altar-qa-20261123&seed=4242');
console.log({id:task.spaceId});
console.log(await page.snapshot());
