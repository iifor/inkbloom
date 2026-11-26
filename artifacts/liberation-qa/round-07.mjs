const task=await taskSpace(18);const page=task.page('p1');
console.log(await page.evaluate(()=>({ready:!!window.inkbloom,qa:!!window.liberationQA,world:window.inkbloom?.ctx.state.id,scene:window.inkbloom?.info()})));
console.log(await page.snapshot());
