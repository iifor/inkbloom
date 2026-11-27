const task=await taskSpace(5);
const game=task.page('p2');
const result=await game.evaluate(()=>({hidden:document.querySelector('#startup').hidden,status:document.querySelector('#startup-status').textContent,menuVisible:!document.querySelector('#overlay').hidden,menuText:document.querySelector('#overlay').innerText,canvasReady:!document.querySelector('#view').inert}));
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-qa/final-boot.json',JSON.stringify(result,null,2));
console.log({finalBoot:result});
const preview=task.page('p1');
await preview.cdp('Page.bringToFront');
console.log(await preview.snapshot());
