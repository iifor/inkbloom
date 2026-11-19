const task = await taskSpace(22);
const page = task.page('p1');
await page.click('@2');
console.log(await page.evaluate(async () => {
 const a=window.inkbloom;
 const {townLayout}=await import('/src/world/city/layout.ts');
 const found=[];
 for(const e of a.ctx.wilderness.entrancesNear(64,64,1)) {
   const l=townLayout(e,a.ctx.wilderness);
   if(l.wheel) found.push({id:e.cityId,x:e.x,z:e.z,wheel:l.wheel});
 }
 return found;
}));
