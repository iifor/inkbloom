const task=await taskSpace(20);
const page=task.page('p1');
const image=await page.evaluate(async()=>{
  inkbloom.game.loop.stop();
  inkbloom.fly(true);
  inkbloom.ctx.player.position.set(64,4,64);
  inkbloom.look(-1.8,-0.12);
  for(let i=0;i<160;i++){
    inkbloom.game.loop.step(1/60);
    if(i%4===0) await new Promise(r=>setTimeout(r,0));
  }
  inkbloom.ctx.renderer.render();
  return document.querySelector('#view').toDataURL('image/png');
});
const fs=await import('node:fs/promises');
await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/performance-qa/after-spawn.png',Buffer.from(image.split(',')[1],'base64'));
console.log(await page.evaluate(()=>({info:inkbloom.info(),grassReady:inkbloom.game.scenes.wild.grass.ready,error:document.querySelector('#overlay-error')?.textContent})));
