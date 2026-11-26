const task=await taskSpace(11);const page=task.page('p2');
await page.click('button[aria-label="Sort results: Price ↑"]');
await page.click('button[aria-label="Close filters"]');
await page.click('button[aria-label="Search"]');
await page.waitForFunction(()=>!document.body.innerText.includes('Loading sounds...')&&document.querySelectorAll('tr').length>1,undefined,{timeout:25000});
console.log(await page.evaluate(()=>[...document.querySelectorAll('tr')].map(r=>({text:r.innerText.trim(),links:[...r.querySelectorAll('a')].map(a=>({text:a.innerText,url:a.href}))})).filter(r=>r.text)));
