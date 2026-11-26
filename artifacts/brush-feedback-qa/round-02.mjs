const task=await taskSpace(16);const page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.qa?.ready && window.qa.renderer.camera.getObjectByName('courier-model-arms')?.visible,undefined,{timeout:15000});
console.log(await page.snapshot());
await page.click('#red');
await page.waitForFunction(()=>window.qa.held.paintColor===1);
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/brush-feedback-qa/red.png'}));
console.log(await page.evaluate(async()=>{
 const q=window.qa;const zs=[];for(let i=0;i<18;i++){await new Promise(requestAnimationFrame);zs.push(q.renderer.camera.getObjectByName('walking-hands').children[1].position.z)}
 return {errors:q.errors,forwardStrokeRange:Math.max(...zs)-Math.min(...zs),color:q.held.paintColor};
}));
