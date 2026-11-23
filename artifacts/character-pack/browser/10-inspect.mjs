const task=await taskSpace(14), page=task.page('p1');
console.log(await page.evaluate(()=>({ready:!!window.inkbloom,text:document.body.innerText.slice(0,1800)})));
console.log(await page.snapshot());
