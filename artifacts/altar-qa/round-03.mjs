const task=await taskSpace(2);const page=task.page('p1');
console.log(await page.evaluate(async()=>{
 const {ctx,game}=window.inkbloom;
 const {Vector3}=await import('/node_modules/.vite/deps/three.js');
 for(const q of window.altarQA){game.scenes.enterCity(q.e);ctx.state.cities.get(q.e.cityId).peaceful=true;}
 const q=window.altarQA[0];game.scenes.enterCity(q.e);
 ctx.player.teleport(new Vector3(q.at.x-5,q.at.y+0.3,q.at.z+5));
 ctx.player.yaw=-Math.PI/4;ctx.player.pitch=-0.28;
 ctx.renderer.setSize?.(1280,720);
 window.inkbloom.step(3);
 return {info:window.inkbloom.info(), altar:!!ctx.renderer.scene.getObjectByName('travel-altar')};
}));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/altar-qa/altar.png'}));
