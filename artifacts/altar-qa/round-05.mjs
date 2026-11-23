const task=await taskSpace(2);const page=task.page('p1');
await page.keyboard.down('e');
console.log(await page.evaluate(()=>{
 window.inkbloom.step(61);
 return {info:window.inkbloom.info(),charge:window.inkbloom.ctx.interactions.charging?.time,veil:document.querySelector('[data-travel-veil]')?.style.opacity};
}));
await page.keyboard.up('e');
console.log(await page.evaluate(()=>{window.inkbloom.step(4);return {info:window.inkbloom.info(),veil:document.querySelector('[data-travel-veil]')?.style.opacity}}));
await page.keyboard.down('e');
console.log(await page.evaluate(()=>{
 window.inkbloom.step(210);
 return {info:window.inkbloom.info(),expected:window.altarQA?.[1].at,veil:document.querySelector('[data-travel-veil]')?.style.opacity};
}));
await page.keyboard.up('e');
