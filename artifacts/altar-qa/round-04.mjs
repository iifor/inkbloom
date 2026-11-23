const task=await taskSpace(2);const page=task.page('p1');
console.log(await page.evaluate(async()=>{
 const {ctx,game}=window.inkbloom; const {Vector3}=await import('/node_modules/.vite/deps/three.js');
 const q=window.altarQA[0];
 ctx.player.teleport(new Vector3(q.at.x,q.at.y+0.3,q.at.z));
 window.inkbloom.step(30);
 const before=window.inkbloom.info();
 ctx.input.setHeld('interact',true);window.inkbloom.step(61);
 const charge=window.inkbloom.info();
 const particles=ctx.renderer.scene.getObjectByName('altar:charging-motes')?.visible;
 ctx.input.setHeld('interact',false);window.inkbloom.step(5);
 const cancelled={info:window.inkbloom.info(),veil:document.querySelector('[data-travel-veil]')?.style.opacity};
 ctx.input.setHeld('interact',true);window.inkbloom.step(160);
 const arrival=window.inkbloom.info();
 window.inkbloom.step(80);const heldStill=window.inkbloom.info();
 ctx.input.setHeld('interact',false);window.inkbloom.step(3);
 return {before,charge,particles,cancelled,arrival,heldStill,expected:window.altarQA[1].at};
}));
