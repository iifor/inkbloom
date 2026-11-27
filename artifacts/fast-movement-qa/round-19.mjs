const task=await taskSpace(21),page=task.page('p1');
const shot=await page.evaluate(async()=>{
 const game=inkbloom.game;game.loop.stop();game.ctx.player.position.set(64,10,64);inkbloom.fly(false);inkbloom.look(-1.13,-.08);
 for(let n=0;n<200;n++){game.loop.step(1/60);if(n%5===0)await new Promise(r=>setTimeout(r,0));}
 game.ctx.renderer.render();return game.ctx.renderer.renderer.domElement.toDataURL('image/png');
});
const fs=await import('node:fs/promises');await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/fast-movement-qa/final-spawn.png',Buffer.from(shot.split(',')[1],'base64'));console.log('Saved final-spawn.png');
