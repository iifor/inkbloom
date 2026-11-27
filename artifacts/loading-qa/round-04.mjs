const task=await taskSpace(5);const page=task.page('p1');
await page.keyboard.press('Control+0');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
console.log(await page.evaluate(()=>({viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,scene:document.querySelector('.startup-scene').getBoundingClientRect().toJSON()})));
const shot=await page.cdp('Page.captureScreenshot',{format:'png',fromSurface:false,captureBeyondViewport:false});
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-qa/desktop-final.png',Buffer.from(shot.data,'base64'));
