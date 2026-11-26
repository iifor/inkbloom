const task=await taskSpace(18);const page=task.page('p1');
await page.reload({waitUntil:'domcontentloaded',timeout:30000});
await page.waitForSelector('text=开始：');
await page.click('text=开始：');
console.log(await page.evaluate(async()=>{
 const api=window.inkbloom;const {ctx,game}=api;game.loop.stop();
 const {travelAltar}=await import('/src/world/city/travel-altar.ts');
 const {liberation}=await import('/src/world/city/liberation.ts');
 const city=game.scenes.currentCity,layout=city.layout,altar=travelAltar(layout),saved=ctx.state.cities.get(layout.id);
 window.liberationQA={layout,altar,events:[]};ctx.events.on('title',e=>window.liberationQA.events.push(e));
 api.step(3);
 return{progress:liberation(layout,saved),garrison:city.monsters.group.living('altar').length,completed:saved.completed};
}));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/liberation-qa/headquarters.png'}));
