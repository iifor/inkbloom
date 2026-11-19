const task=await taskSpace(22); const page=task.page('p1');
console.log(await page.evaluate(async()=>{
 const api=window.inkbloom; const {townLayout}=await import('/src/world/city/layout.ts');
 for(const e of api.ctx.wilderness.entrancesNear(64,64,2)) {
   if(Math.max(Math.abs(e.x),Math.abs(e.z))<1400)continue;
   const l=townLayout(e,api.ctx.wilderness);
   if(l.wheel){window.millQA={entrance:e,wheel:l.wheel};return window.millQA;}
 }
 return 'No wheel in second ring';
}));
