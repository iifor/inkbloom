const task=await taskSpace(18);const page=task.page('p1');
await page.waitForSelector('text=开始：');
await page.click('text=开始：');
console.log(await page.evaluate(async()=>{
 const api=window.inkbloom;const {ctx,game}=api;game.loop.stop();
 if(ctx.state.id!=='liberation-qa-20261126')throw new Error('Wrong test world');
 const {travelAltar}=await import('/src/world/city/travel-altar.ts');
 const {liberation}=await import('/src/world/city/liberation.ts');
 const city=game.scenes.currentCity,layout=city.layout,altar=travelAltar(layout);
 const saved=ctx.state.cities.get(layout.id);
 window.liberationQA={layout,altar,events:[]};
 ctx.events.on('title',e=>window.liberationQA.events.push(e));
 const required=Math.ceil(layout.monsters.length/2);
 const before={...liberation(layout,saved),completed:saved.completed};
 for(let i=0;i<required;i++)if(!saved.defeated[i]){
   const r=ctx.apply({kind:'defeat',city:layout.id,monster:i});if(!r.ok)throw new Error(JSON.stringify(r));
 }
 api.step(2);
 return{before,after:liberation(layout,saved),garrison:city.monsters.group.living('altar').map(v=>v.toArray()),objective:document.body.innerText};
}));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/liberation-qa/headquarters.png'}));
