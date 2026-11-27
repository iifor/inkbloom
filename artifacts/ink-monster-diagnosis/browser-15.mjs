const task=await taskSpace(2);
const page=task.page('p1');
console.log(await page.evaluate(()=>({ready:!!window.inkbloom,status:document.body.innerText.slice(-250),raf:window.requestAnimationFrame.toString()})));
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.requestAnimationFrame=cb=>window.setTimeout(()=>cb(performance.now()),16);window.cancelAnimationFrame=id=>window.clearTimeout(id);`});
await page.reload();
console.log(await page.snapshot());
