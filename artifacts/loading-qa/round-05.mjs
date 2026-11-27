const task=await taskSpace(5);const page=task.page('p1');
console.log(await page.info());
await page.cdp('Emulation.clearDeviceMetricsOverride');
await page.cdp('Page.bringToFront');
console.log(await page.evaluate(()=>({viewport:[innerWidth,innerHeight],visibility:document.visibilityState,body:document.body.innerText,root:document.querySelector('#startup').getBoundingClientRect().toJSON(),background:getComputedStyle(document.querySelector('#startup')).backgroundColor,images:[...document.images].map(x=>({src:x.src,valid:x.complete&&x.naturalWidth>0}))})));
const shot=await page.cdp('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-qa/visible-desktop.png',Buffer.from(shot.data,'base64'));
