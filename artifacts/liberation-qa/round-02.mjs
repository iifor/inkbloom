const task=await taskSpace(18);const page=task.page('p1');
await page.waitForFunction(()=>document.body.innerText.includes('开始') || window.inkbloom,undefined,{timeout:20000});
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
console.log(await page.snapshot());
