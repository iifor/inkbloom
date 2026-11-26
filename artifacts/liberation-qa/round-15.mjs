const task=await taskSpace(18);const page=task.page('p1');
console.log(await page.evaluate(()=>{
 const api=window.inkbloom;api.step(90);
 return{completed:api.game.scenes.currentCity.completed,focused:api.info().focused,motes:api.ctx.renderer.scene.getObjectByName('altar:charging-motes')?.visible};
}));
console.log(await page.snapshot());
