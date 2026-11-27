const task=await taskSpace(20);
const page=task.page('p1');
console.log(await page.snapshot());
console.log(await page.evaluate(()=>({hidden:document.hidden, startup:document.querySelector('#startup-status')?.textContent, error:document.querySelector('#overlay-error')?.textContent})));
