const task = await taskSpace('Inkbloom complete waterwheel QA');
const page = task.page('p1');
await page.goto('http://127.0.0.1:5190/?world=waterwheel-qa-20261119&seed=4242');
console.log({space:task.spaceId});
console.log(await page.snapshot());
