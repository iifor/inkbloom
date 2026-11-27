const task=await taskSpace(21);
const page=task.page('p1');
await page.goto('http://127.0.0.1:5190/?world=fast-after-20261127&seed=4242');
await page.waitForFunction(()=>!!window.inkbloom,undefined,{timeout:60000});
await page.evaluate(async()=>{inkbloom.game.loop.stop();for(let n=0;n<450;n++){inkbloom.step();if(n%5===0)await new Promise(r=>setTimeout(r,0));}});
const {profileRoute}=await import('./profile.mjs');
await profileRoute(page,'fast-after');
