const task=await taskSpace(22);const page=task.page('p1');
console.log(await page.evaluate(()=>({info:window.inkbloom?.info(),wheel:window.inkbloom?.game.scenes.currentCity?.layout.wheel,text:document.body.textContent.slice(-250)})));
