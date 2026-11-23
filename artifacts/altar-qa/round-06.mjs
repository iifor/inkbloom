const task=await taskSpace(2);const page=task.page('p1');
await page.reload();
console.log(await page.snapshot());
