const task=await taskSpace(5);const page=task.page('p1');
await page.cdp('Emulation.clearDeviceMetricsOverride');
const shot=await page.cdp('Page.captureScreenshot',{format:'png',fromSurface:false,captureBeyondViewport:false});
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-qa/desktop-68.png',Buffer.from(shot.data,'base64'));
console.log(await page.evaluate(()=>({viewport:[innerWidth,innerHeight],phase:document.querySelector('#startup').dataset.phase,progress:document.querySelector('#startup-progress').value})));
