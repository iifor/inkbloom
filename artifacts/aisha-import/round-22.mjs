const task=await taskSpace(11);const page=task.page('p2');
await page.goto('https://aishasound.com/public-libraries',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.body.innerText.includes('Free'),undefined,{timeout:20000});
console.log(await page.evaluate(()=>({text:document.body.innerText.slice(0,7000),inputs:[...document.querySelectorAll('input,button,select')].map(x=>({tag:x.tagName,text:x.innerText,aria:x.getAttribute('aria-label'),placeholder:x.getAttribute('placeholder'),type:x.getAttribute('type')})).filter(x=>x.text||x.aria||x.placeholder).slice(0,30),links:[...document.querySelectorAll('a')].filter(a=>/free/i.test(a.textContent)).map(a=>({text:a.innerText,url:a.href}))})));
