const task=await taskSpace(11);const page=await task.newPage();
await page.goto('https://aishasound.com/?q=rain',{waitUntil:'domcontentloaded'});
await page.waitForSelector('input[name="sound-search"]');
console.log({page:page.label});
console.log(await page.snapshot());
