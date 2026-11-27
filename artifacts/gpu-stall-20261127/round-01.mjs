const task=await taskSpace('InkBloom GPU stall investigation');
const page=task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);`});
await page.goto('http://127.0.0.1:5192/?world=gpu-stall-before-20261127&seed=4242');
await page.waitForFunction(()=>!!window.inkbloom?.ctx,undefined,{timeout:60000});
await page.evaluate(()=>inkbloom.game.loop.stop());
console.log({space:task.spaceId});
help('page.cdp');help('page.events');help('page.waitForEvent');
console.log(await page.snapshot());
