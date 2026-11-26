const task=await taskSpace(11);const page=task.page('p2');
await page.click('button[aria-label="Remove filter $0.00–$1.00"]');
await page.fill('input[name="sound-search"]','cricket');
await page.click('button[aria-label="Search"]');
await page.waitForURL('https://aishasound.com/?q=cricket');
await page.waitForFunction(()=>[...document.querySelectorAll('tr')].some(r=>/cricket/i.test(r.innerText)),undefined,{timeout:25000});
console.log(await page.evaluate(()=>[...document.querySelectorAll('tr')].map(r=>({text:r.innerText.trim(),links:[...r.querySelectorAll('a')].map(a=>a.href)})).filter(r=>r.text)));
