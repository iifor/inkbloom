const task=await taskSpace(14),page=task.page('p1');
console.log(await page.evaluate(()=>({ready:!!window.inkbloom,text:document.body.innerText.slice(-1200),visibility:document.visibilityState,keys:window.inkbloom?Object.keys(window.inkbloom):[]})));
console.log(await page.snapshot());
