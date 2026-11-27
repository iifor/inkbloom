const task=await taskSpace(21),page=task.page('p1');
console.log(await page.snapshot());
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);`});
await page.goto('http://127.0.0.1:5190/?world=fast-town-final-20261127&seed=4242');
await page.waitForFunction(()=>!!window.inkbloom,undefined,{timeout:60000});
await page.evaluate(async()=>{inkbloom.game.loop.stop();inkbloom.game.ctx.player.position.set(1108,80,171.88);for(let n=0;n<450;n++){inkbloom.step();if(n%5===0)await new Promise(r=>setTimeout(r,0));}});
const {profileRoute}=await import('./profile.mjs');
await profileRoute(page,'town-cold-final',{x:1108,z:171.88,dx:0,dz:-.9,frames:1500});
