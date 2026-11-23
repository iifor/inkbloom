const task=await taskSpace(6);
const page=task.page('p1');
console.log(await page.snapshot());
