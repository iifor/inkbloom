const task = await taskSpace('InkBloom village liberation QA');
const page = task.page('p1');
await page.goto('http://127.0.0.1:5192/?world=liberation-qa-20261126&seed=4242', {waitUntil:'domcontentloaded'});
console.log({id:task.spaceId});
console.log(await page.snapshot());
