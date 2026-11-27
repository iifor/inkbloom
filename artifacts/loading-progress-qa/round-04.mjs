const task = await taskSpace(5);
const page = task.page('p1');
await page.evaluate(async()=>{
  const {loadSettings,saveSettings}=await import('/src/world/settings.ts');
  const {browserKeyValue}=await import('/src/world/store.ts');
  const {kv}=browserKeyValue();
  saveSettings(kv,{...loadSettings(kv),quality:'low'});
});
await page.cdp('Network.enable');
await page.cdp('Network.setCacheDisabled',{cacheDisabled:true});
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`
window.loadingTrace=[];window.loadingErrors=[];window.loadingLongTasks=[];
new PerformanceObserver(list=>{for(const e of list.getEntries())loadingLongTasks.push({t:Math.round(e.startTime),duration:Math.round(e.duration)})}).observe({type:'longtask',buffered:true});
window.addEventListener('error',e=>loadingErrors.push(e.message));
window.addEventListener('unhandledrejection',e=>loadingErrors.push(String(e.reason)));
document.addEventListener('DOMContentLoaded',()=>{
 const root=document.querySelector('#startup');if(!root)return;
 const observe=()=>{
  const row={t:Math.round(performance.now()),target:Number(root.dataset.target||0),shown:document.querySelector('#startup-progress').value,label:document.querySelector('#startup-status').textContent,hidden:root.hidden,phase:root.dataset.phase};
  const prev=loadingTrace.at(-1);
  if(!prev||row.label!==prev.label||row.hidden!==prev.hidden||row.phase!==prev.phase||Math.abs(row.shown-prev.shown)>=.5||row.target!==prev.target)loadingTrace.push(row);
 };
 new MutationObserver(observe).observe(root,{attributes:true,subtree:true,characterData:true,childList:true});observe();
});`});
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelector('#startup')?.hidden,undefined,{timeout:45000}).catch(e=>console.log(e.message));
const result = await page.evaluate(()=>({trace:loadingTrace,errors:loadingErrors,longTasks:loadingLongTasks,hidden:document.querySelector('#startup').hidden,error:document.querySelector('#overlay-error').textContent,menu:document.querySelector('#overlay').innerText,dev:!!window.inkbloom,visibility:document.visibilityState,canvasInert:document.querySelector('#view').inert}));
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-progress-qa/low-quality-uncached-boot.json',JSON.stringify(result,null,2));
console.log({...result,trace:result.trace.filter((x,i,a)=>i===0||i===a.length-1||a[i-1].label!==x.label)});
