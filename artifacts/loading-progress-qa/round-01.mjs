const entry=(await listTaskSpaces()).find(s=>s.id===5);
const task=!entry?await taskSpace('InkBloom loading readiness'):entry.ownership==='user'?await claimTaskSpace(5):entry.ownership==='agentDelegatedToUser'?await takeOverTaskSpace(5):await taskSpace(5);
const page=(await task.pages())[0]??await task.adopt((await task.tabs())[0].page);
console.log({space:task.spaceId,page:page.label});
await page.goto('http://127.0.0.1:5193/artifacts/loading-qa/preview.html',{waitUntil:'domcontentloaded'});
await page.evaluate(async()=>{
  const {defaultLook}=await import('/src/content/characters.ts');
  const {saveProfile}=await import('/src/world/profile.ts');
  const {browserKeyValue}=await import('/src/world/store.ts');
  saveProfile(browserKeyValue().kv,{name:'加载检查',look:defaultLook('gardener')});
});
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false,scale:1});
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`
window.loadingTrace=[];window.loadingErrors=[];
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
await page.goto('http://127.0.0.1:5193/?world=loading-progress-20261128&seed=4242',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelector('#startup')?.hidden,undefined,{timeout:45000}).catch(e=>console.log(e.message));
const result=await page.evaluate(()=>({trace:loadingTrace,errors:loadingErrors,hidden:document.querySelector('#startup').hidden,status:document.querySelector('#startup-status').textContent,error:document.querySelector('#overlay-error').textContent,menu:document.querySelector('#overlay').innerText,dev:!!window.inkbloom,resources:performance.getEntriesByType('resource').filter(x=>x.name.includes('.glb')).map(x=>({url:x.name,t:x.responseEnd}))}));
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-progress-qa/first-boot.json',JSON.stringify(result,null,2));
console.log({...result,trace:result.trace.filter((x,i,a)=>i===0||i===a.length-1||!a[i-1].label.startsWith(x.label.split(' ')[0]))});
