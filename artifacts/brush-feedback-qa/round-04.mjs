const task=await taskSpace(16);const page=task.page('p1');
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.qa?.ready && window.qa.arms.model?.root.visible,undefined,{timeout:15000});
await page.click('#red');
await page.waitForFunction(()=>window.qa.arms.model.brushAccent===1);
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/brush-feedback-qa/final-red.png'}));
console.log(await page.evaluate(()=>({errors:window.qa.errors,painting:window.qa.held.painting,color:window.qa.arms.model.brushAccent})));
