const task=await taskSpace(5);const page=task.page('p1');
await page.waitForFunction(()=>document.querySelector('#startup')?.hidden,undefined,{timeout:45000});
const evidence=await page.evaluate(()=>({qa:window.loadingQAEvidence,menuVisible:!document.querySelector('#overlay').hidden,menuText:document.querySelector('#overlay').innerText,canvasReady:!document.querySelector('#view').inert,phase:document.querySelector('#startup').dataset.phase,animations:document.querySelector('#startup').getAnimations({subtree:true}).length}));
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-qa/boot-results.json',JSON.stringify(evidence,null,2));
console.log(evidence);
