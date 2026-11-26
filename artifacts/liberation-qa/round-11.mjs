const task=await taskSpace(18);const page=task.page('p1');
await page.click('@21');
console.log(await page.evaluate(async()=>{
 const api=window.inkbloom;const {ctx,game}=api;game.loop.stop();
 const {travelAltar}=await import('/src/world/city/travel-altar.ts');
 const city=game.scenes.currentCity,layout=city.layout,altar=travelAltar(layout);
 window.liberationQA={layout,altar,events:[]};ctx.events.on('title',e=>window.liberationQA.events.push(e));
 api.step(2);
 return{garrison:city.monsters.group.living('altar').length,completed:ctx.state.cities.get(layout.id).completed};
}));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/liberation-qa/headquarters.png'}));
