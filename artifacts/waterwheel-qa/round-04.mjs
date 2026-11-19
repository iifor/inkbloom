const task=await taskSpace(22);const page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
console.log(await page.evaluate(()=>{
 const api=window.inkbloom, q=window.millQA;
 api.game.scenes.enterCity(q.entrance);
 api.teleport(q.wheel.x+11,q.wheel.z+8,3);
 api.look(Math.atan2(11,8),-0.25);
 api.fly(true);
 const scene=api.game.scenes.currentCity;
 const rotor=scene.root.getObjectByName('waterwheel:rotor'),support=scene.root.getObjectByName('waterwheel:fixed-support');
 window.millQA.initial={rotor:rotor.rotation.x,support:support.matrix.toArray()};
 return {info:api.info(),rotorTriangles:rotor.geometry.index.count/3,supportTriangles:support.geometry.index.count/3,parts:[rotor.name,support.name]};
}));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/waterwheel-qa/in-game-01.png'}));
