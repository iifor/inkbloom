const task=await taskSpace(20);
const page=task.page('p1');
console.log(await page.evaluate(()=>({ready:!!window.inkbloom,error:document.querySelector('#overlay-error')?.textContent})));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/performance-qa/after-route.png'}));
