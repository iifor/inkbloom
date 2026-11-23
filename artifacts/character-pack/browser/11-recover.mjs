const task=await taskSpace(14),page=task.page('p1');
console.log(await page.events());
await page.goto('http://127.0.0.1:5190/?preview=courier&world=character-style-qa&seed=173');
await page.waitForFunction(()=>!!window.inkbloom,undefined,{timeout:60000});
console.log(await page.snapshot());
