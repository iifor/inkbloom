const task=await taskSpace(11); const page=task.page('p1');
await page.goto('https://aishasound.com/public-libraries/111',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelectorAll('tr').length>2,undefined,{timeout:20000});
console.log(await page.evaluate(()=>({text:document.body.innerText.slice(0,14000),buttons:Array.from(document.querySelectorAll('button')).map(b=>({text:b.innerText,aria:b.getAttribute('aria-label')})).filter(b=>/download|free/i.test(b.text+' '+b.aria))})));
