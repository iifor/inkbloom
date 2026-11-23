const task=await taskSpace(2);const page=task.page('p1');await page.click('@11');
console.log(await page.evaluate(async()=>{
 const {ctx,game}=window.inkbloom;game.loop.stop();
 const {travelAltar,hasTravelAltar}=await import('/src/world/city/travel-altar.ts');
 const {Vector3}=await import('/node_modules/.vite/deps/three.js');
 const e=ctx.cities.entranceOf('c-16_-11');game.scenes.enterCity(e);
 const at=travelAltar(ctx.cities.layout(e));window.altarQA={at,e};
 ctx.player.teleport(new Vector3(at.x-4,at.y+0.3,at.z+4));ctx.player.yaw=-Math.PI/4;ctx.player.pitch=-0.36;
 window.inkbloom.step(20);
 const counts={small:[0,0,0],medium:[0,0,0],town:[0,0,0]};
 for(const e of ctx.wilderness.entrancesNear(0,0,2)){
   const bucket=counts[e.chunks<=2?'small':e.chunks<=3?'medium':'town'];bucket[0]++;
   if(hasTravelAltar(e.seed,e.chunks)){bucket[1]++;if(travelAltar(ctx.cities.layout(e)))bucket[2]++;}
 }
 return {info:window.inkbloom.info(),counts};
}));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/altar-qa/altar-final.png'}));
