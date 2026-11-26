const task=await taskSpace(11);const page=task.page('p2');
console.log(await page.evaluate(()=>({text:document.body.innerText.slice(0,4500),rows:[...document.querySelectorAll('tr')].map(r=>({text:r.innerText.trim(),links:[...r.querySelectorAll('a')].map(a=>({text:a.innerText,url:a.href}))})).filter(r=>r.text)})));
