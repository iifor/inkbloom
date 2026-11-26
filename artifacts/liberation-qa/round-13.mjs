const task=await taskSpace(18);const page=task.page('p1');
await page.evaluate(()=>{window.inkbloom.ctx.input.setHeld('interact',false);window.inkbloom.step(1);});
await page.keyboard.down('e');
console.log(await page.evaluate(()=>{
 const api=window.inkbloom;api.step(90);
 return{focused:api.info().focused,completed:api.game.scenes.currentCity.completed,motes:api.ctx.renderer.scene.getObjectByName('altar:charging-motes')?.visible,alive:api.ctx.combat.alive};
}));
console.log(await page.snapshot());
