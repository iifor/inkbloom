const task=await taskSpace(18);const page=task.page('p1');
await page.keyboard.up('e');await page.focus('canvas');await page.keyboard.down('e');
const result=await page.evaluate(async()=>{
 const api=window.inkbloom,{ctx,game}=api,{layout,altar}=window.liberationQA;
 api.step(90);const halfway={focused:api.info().focused,held:ctx.input.held('interact'),completed:game.scenes.currentCity.completed};
 api.step(100);const final={focused:api.info().focused,held:ctx.input.held('interact'),completed:game.scenes.currentCity.completed};
 ctx.input.setHeld('interact',false);api.step(2);
 if(!final.completed)return{halfway,final,canHold:ctx.interactions.focused?.canHold?.(),infected:ctx.combat.infected};
 const {Vector3}=await import('/node_modules/.vite/deps/three.js');
 ctx.player.teleport(new Vector3(altar.x-7,altar.y+0.4,altar.z+7));ctx.player.yaw=-Math.PI/4;ctx.player.pitch=-0.13;
 api.step(400);await api.save();
 return{halfway,final,progress:game.scenes.currentCity.progress(),living:game.scenes.currentCity.monsters.group.living().length,corruption:ctx.renderer.scene.getObjectByName('altar:ink-stronghold')?.visible,events:window.liberationQA.events,image:document.querySelector('canvas').toDataURL('image/png')};
});
await page.keyboard.up('e');
if(result.image){await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/liberation-qa/restored.png',Buffer.from(result.image.split(',')[1],'base64'));delete result.image;}
console.log(result);console.log(await page.snapshot());
