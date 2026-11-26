const task=await taskSpace(18);const page=task.page('p1');
await page.click('@2');
console.log(await page.evaluate(async()=>{
 const api=window.inkbloom;const {ctx,game}=api;game.loop.stop();
 if(ctx.state.id!=='liberation-qa-20261126') throw new Error('Wrong QA world '+ctx.state.id);
 const {travelAltar}=await import('/src/world/city/travel-altar.ts');
 const {startsPeaceful}=await import('/src/world/city/origin.ts');
 const {Vector3}=await import('/node_modules/.vite/deps/three.js');
 const e=ctx.wilderness.entrancesNear(0,0,3).find(e=>!startsPeaceful(ctx.state.seed,e.cityId));
 if(!e)throw new Error('No occupied village');
 game.scenes.enterCity(e);const layout=ctx.cities.layout(e);const altar=travelAltar(layout);
 window.liberationQA={e,altar,layout,events:[]};
 ctx.events.on('title',ev=>window.liberationQA.events.push(ev));
 ctx.player.teleport(new Vector3(altar.x-7,altar.y+0.4,altar.z+7));
 ctx.player.yaw=-Math.PI/4;ctx.player.pitch=-0.13;
 api.step(3);
 return{world:ctx.state.id,info:api.info(),altar,streetMonsters:layout.monsters.length,saved:ctx.state.cities.get(e.cityId).completed};
}));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/liberation-qa/occupied.png'}));
