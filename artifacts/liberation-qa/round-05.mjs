const task=await taskSpace(18);const page=task.page('p1');
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>!!window.inkbloom,undefined,{timeout:20000});
console.log(await page.snapshot());
