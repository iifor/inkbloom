const task=await taskSpace(21);
const page=task.page('p1');
console.log(await page.snapshot());
console.log(await page.evaluate(()=>({ready:!!window.inkbloom,hidden:document.hidden,raf:String(window.requestAnimationFrame)})));
