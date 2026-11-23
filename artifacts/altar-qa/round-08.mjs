const task=await taskSpace(2);const page=task.page('p1');
console.log(await page.evaluate(async()=>{
 const {ctx,game}=window.inkbloom;const {at}=window.altarQA;
 const {Vector3}=await import('/node_modules/.vite/deps/three.js');
 ctx.player.teleport(new Vector3(at.x,ctx.wilderness.heightAt(at.x,at.z-5)+0.1,at.z-5));
 ctx.player.yaw=Math.PI;ctx.player.pitch=-0.45;window.inkbloom.step(20);
 ctx.input.setHeld('forward',true);window.inkbloom.step(50);ctx.input.setHeld('forward',false);window.inkbloom.step(20);
 const walked=window.inkbloom.info();
 ctx.player.teleport(new Vector3(at.x-1.4,at.y+0.26,at.z+1.4));ctx.player.yaw=-Math.PI/4;ctx.player.pitch=-0.75;
 window.inkbloom.step(20);
 return {walked,center:at,ready:ctx.interactions.focused?.canHold?.()};
}));
await page.keyboard.down('e');
console.log(await page.evaluate(()=>{
 window.inkbloom.step(94);
 const ctx=window.inkbloom.ctx;
 return {info:window.inkbloom.info(),particles:ctx.renderer.scene.getObjectByName('altar:charging-motes')?.visible};
}));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/altar-qa/altar-charging.png'}));
await page.keyboard.up('e');
await page.evaluate(()=>window.inkbloom.step(2));
