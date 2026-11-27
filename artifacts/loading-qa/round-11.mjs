const task=await taskSpace(5);const page=task.page('p1');
await page.waitForFunction(()=>document.querySelector('#startup').hidden||document.querySelector('#startup-progress').value>=80,undefined,{timeout:45000}).catch(e=>console.log(e.message));
const evidence=await page.evaluate(()=>({qa:window.loadingQAEvidence,hidden:document.querySelector('#startup').hidden,menuVisible:!document.querySelector('#overlay').hidden,menuText:document.querySelector('#overlay').innerText,canvasReady:!document.querySelector('#view').inert,status:document.querySelector('#startup-status').textContent,phase:document.querySelector('#startup').dataset.phase}));
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-qa/boot-results.json',JSON.stringify(evidence,null,2));
console.log(evidence);
