const task=await taskSpace(11);const page=task.page('p2');
await page.click('text="Sort: Newest First"');
await page.fill('input[placeholder="Search libraries by title..."]','free');
await page.waitForFunction(()=>!document.querySelector('a[aria-label="Seaside Nature And Waves"]'),undefined,{timeout:20000});
console.log(await page.evaluate(()=>({text:document.body.innerText.slice(0,9000),links:[...document.querySelectorAll('a[aria-label]')].map(a=>({text:a.getAttribute('aria-label'),url:a.href}))})));
