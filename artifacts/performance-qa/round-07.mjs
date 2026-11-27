const task=await taskSpace(20);
const page=task.page('p1');
console.log(await page.evaluate(async()=>{
  const wild=inkbloom.game.scenes.wild;
  window.perfParts={};
  for(const [key,value] of Object.entries(wild)){
    if(!value || typeof value.update!=='function')continue;
    const original=value.update.bind(value);
    const record=perfParts[key]={total:0,max:0,n:0,slow:0};
    value.update=(...args)=>{const t=performance.now();const out=original(...args);const ms=performance.now()-t;record.total+=ms;record.max=Math.max(record.max,ms);record.n++;if(ms>8)record.slow++;return out;};
  }
  return await inkbloom.profile(4);
}));
const {runRoute}=await import('./route.mjs');
await runRoute(page,'after');
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/performance-qa/after-route.png'}));
