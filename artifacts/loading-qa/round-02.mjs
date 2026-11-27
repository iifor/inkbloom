const task=await taskSpace(5);const page=task.page('p1');
console.log(await page.snapshot());
console.log(await page.evaluate(()=>({ready:window.startupQA?.ready,viewport:[innerWidth,innerHeight],imgs:[...document.querySelectorAll('#startup img')].map(i=>({src:i.src,ok:i.complete&&i.naturalWidth>0})),root:document.querySelector('#startup').getBoundingClientRect().toJSON()})));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-qa/desktop-68.png'}));
