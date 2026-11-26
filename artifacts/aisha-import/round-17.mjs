const task=await taskSpace(11);const page=task.page('p2');
await page.click('button[aria-label="Filters, 1 active"]');
console.log(await page.snapshot());
