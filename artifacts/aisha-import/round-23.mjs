const task=await taskSpace(11);const page=task.page('p2');
await page.click('text="Offers: All offers"');
console.log(await page.snapshot());
