const task=await taskSpace(21),page=task.page('p1');
console.log(await page.snapshot());
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);`});
await page.goto('http://127.0.0.1:5190/?world=fast-visual-20261127&seed=4242');
await page.waitForFunction(()=>!!window.inkbloom,undefined,{timeout:60000});
const shot=await page.evaluate(async()=>{
 const game=inkbloom.game;game.loop.stop();inkbloom.look(-1.13,-.08);
 for(let n=0;n<150;n++){game.loop.step(1/60);if(n%5===0)await new Promise(r=>setTimeout(r,0));}
 game.ctx.renderer.render();return game.ctx.renderer.renderer.domElement.toDataURL('image/png');
});
const fs=await import('node:fs/promises');await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/fast-movement-qa/final-spawn.png',Buffer.from(shot.split(',')[1],'base64'));console.log('Saved final-spawn.png');
