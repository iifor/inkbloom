const task=await taskSpace(20);
const page=task.page('p1');
await page.cdp('Page.bringToFront');
console.log(await page.evaluate(()=>new Promise(resolve=>{const t=performance.now();const timer=setTimeout(()=>resolve({raf:false}),1000);requestAnimationFrame(()=>{clearTimeout(timer);resolve({raf:true,ms:performance.now()-t});});})));
console.log(await page.snapshot());
