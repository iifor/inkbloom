const task=await taskSpace('InkBloom loading animation');const page=task.page('p1');
await page.goto('http://127.0.0.1:5192/artifacts/loading-qa/preview.html',{waitUntil:'domcontentloaded'});
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await page.waitForFunction(()=>window.startupQA?.ready,undefined,{timeout:15000});
await page.evaluate(()=>{document.querySelector('#preview-controls').hidden=true;});
console.log({id:task.spaceId});
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-qa/desktop-68.png'}));
