const task=await taskSpace(11); const page=task.page('p1');
console.log({url:await page.url()});
console.log(await page.evaluate(()=>({text:document.body.innerText.slice(0,2200),rows:Array.from(document.querySelectorAll('tr')).slice(0,25).map(r=>({text:r.innerText.slice(0,450),links:Array.from(r.querySelectorAll('a')).map(a=>({text:a.innerText,url:a.href}))}))})));
