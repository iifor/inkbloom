const task=await taskSpace(5);const page=await task.newPage();
console.log({page:page.label});
await page.goto('http://127.0.0.1:5192/?world=loading-qa-20261128&seed=4242',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelector('#startup')?.hidden,undefined,{timeout:45000}).catch(e=>console.log(e.message));
const evidence=await page.evaluate(()=>({hidden:document.querySelector('#startup').hidden,status:document.querySelector('#startup-status').textContent,menuVisible:!document.querySelector('#overlay').hidden,menuText:document.querySelector('#overlay').innerText,canvasReady:!document.querySelector('#view').inert,phase:document.querySelector('#startup').dataset.phase}));
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-qa/final-boot.json',JSON.stringify(evidence,null,2));
console.log(evidence);
