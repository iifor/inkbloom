const spaces=await listTaskSpaces();
const entry=spaces.find(s=>s.id===20);
const task=entry ? await taskSpace(20) : await taskSpace('InkBloom fast movement');
const page=task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`
 window.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),16);
 window.cancelAnimationFrame=id=>clearTimeout(id);
`});
await page.goto('http://127.0.0.1:5190/?world=fast-movement-20261127&seed=4242');
await page.waitForFunction(()=>!!window.inkbloom,undefined,{timeout:60000});
console.log({space:task.spaceId,info:await page.evaluate(()=>inkbloom.info())});
