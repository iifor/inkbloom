const task=await taskSpace(18);const page=task.page('p1');
const result=await page.evaluate(async()=>{
 const api=window.inkbloom;const {ctx,game}=api;game.loop.stop();
 const {Vector3}=await import('/node_modules/.vite/deps/three.js');
 const {travelAltar}=await import('/src/world/city/travel-altar.ts');
 const city=game.scenes.currentCity,layout=city.layout,altar=travelAltar(layout),saved=ctx.state.cities.get(layout.id);
 if(!window.liberationQA){window.liberationQA={layout,altar,events:[]};ctx.events.on('title',e=>window.liberationQA.events.push(e));}
 const before=city.monsters.group.living('altar').length;
 ctx.combat.blast(new Vector3(altar.x,altar.y+1,altar.z),6,10000);
 ctx.player.teleport(new Vector3(altar.x,altar.y+0.3,altar.z));
 ctx.player.pitch=-0.4;
 api.step(40);
 ctx.input.setHeld('interact',true);api.step(90);
 return{before,after:city.monsters.group.living('altar').length,mask:saved.altarGuards,completed:saved.completed,focused:api.info().focused,grounded:ctx.player.grounded,alive:ctx.combat.alive,motes:ctx.renderer.scene.getObjectByName('altar:charging-motes')?.visible,image:document.querySelector('canvas').toDataURL('image/png')};
});
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/liberation-qa/repairing.png',Buffer.from(result.image.split(',')[1],'base64'));
delete result.image;console.log(result);
console.log(await page.snapshot());
