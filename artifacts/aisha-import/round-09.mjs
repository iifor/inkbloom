const task = await taskSpace(11);
const page = task.page('p1');
await page.click('button[aria-label="Search"]');
await page.waitForFunction(() => document.querySelectorAll('tr').length > 2 || document.body.innerText.includes('No sounds'), undefined, { timeout: 20000 });
console.log({url: await page.url()});
console.log(await page.evaluate(() => Array.from(document.querySelectorAll('tr')).map(r => ({text:r.innerText,links:Array.from(r.querySelectorAll('a')).map(a=>({text:a.innerText,url:a.href}))})).filter(r=>r.text)));
console.log(await page.snapshot());
