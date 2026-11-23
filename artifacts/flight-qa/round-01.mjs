const task = await taskSpace('InkBloom paper plane flight QA');
const page = task.page('p1');
await page.goto('http://127.0.0.1:5190/?world=flight-qa-20261123&seed=4242');
console.log({spaceId: task.spaceId});
console.log(await page.snapshot());
