const task=await taskSpace(22);const page=task.page('p1');
console.log(await page.evaluate(()=>({renderKeys:Object.keys(window.inkbloom.ctx.renderer),canvases:[...document.querySelectorAll('canvas')].map(c=>[c.width,c.height]),rotation:window.inkbloom.game.scenes.currentCity?.root.getObjectByName('waterwheel:fixed-support')?.rotation.toArray()})));
