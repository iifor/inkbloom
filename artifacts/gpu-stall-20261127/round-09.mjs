const task=await taskSpace(4),page=task.page('p1');
const {flightCheck}=await import('./flight-check.mjs');
await flightCheck(page,{name:'verified60-programs',fixedBuffer:true,queries:true});
console.log(await page.evaluate(()=>({programs:flightCheckResult.programs.map(p=>({frame:p.frame,headers:p.shaders.map(s=>s.split('\n').filter(l=>/^#define/.test(l)).slice(0,25))}))})));
