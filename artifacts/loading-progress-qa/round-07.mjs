const task = await taskSpace(5);
const page = task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`
const originalFetch=window.fetch.bind(window);
let release;
const gate=new Promise(resolve=>release=resolve);
window.qaReleaseCharacter=release;window.qaCharacterHeld=false;window.qaReadyTrace=[];
window.fetch=(input,init)=>{
 const url=typeof input==='string'?input:(input.url||input.href||'');
 if(url.includes('/player-rogue.glb')){
  window.qaCharacterHeld=true;
  return gate.then(()=>originalFetch(input,init));
 }
 return originalFetch(input,init);
};
document.addEventListener('DOMContentLoaded',()=>{
 const root=document.querySelector('#startup');
 new MutationObserver(()=>{
  if(root.dataset.phase==='ready'||root.hidden)qaReadyTrace.push({t:Math.round(performance.now()),hidden:root.hidden,value:document.querySelector('#startup-progress').value});
 }).observe(root,{attributes:true,subtree:true});
});`});
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.qaCharacterHeld&&document.querySelector('#startup-status')?.textContent.includes('玩家角色'),undefined,{timeout:25000});
const waiting=await page.evaluate(()=>({target:Number(document.querySelector('#startup').dataset.target),shown:document.querySelector('#startup-progress').value,hidden:document.querySelector('#startup').hidden,canvasInert:document.querySelector('#view').inert,label:document.querySelector('#startup-status').textContent}));
console.log({waiting});
if(waiting.hidden||!waiting.canvasInert||waiting.target>80.001)throw new Error('Game entered before the selected character was ready');
await page.evaluate(()=>window.qaReleaseCharacter());
await page.waitForFunction(()=>document.querySelector('#startup').hidden,undefined,{timeout:30000});
const ready=await page.evaluate(()=>({trace:qaReadyTrace,error:document.querySelector('#overlay-error').textContent,canvasInert:document.querySelector('#view').inert,menu:document.querySelector('#overlay').innerText}));
if(ready.error||ready.canvasInert||!ready.trace.some(x=>!x.hidden&&x.value===100))throw new Error('Readiness handoff failed');
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-progress-qa/delayed-character.json',JSON.stringify({waiting,ready},null,2));
console.log({ready});
console.log(await page.snapshot());
