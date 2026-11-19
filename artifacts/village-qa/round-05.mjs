const task = await taskSpace(17);
const page = task.page('p1');
console.log(await page.evaluate(() => ({info:window.inkbloom.info(),fatal:document.body.textContent.includes('出错了'),version:window.inkbloom.ctx.state.terrainVersion})));
await page.goto('http://127.0.0.1:5190/artifacts/settlement-layout-comparison.svg');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:820,deviceScaleFactor:1,mobile:false});
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/settlement-layout-comparison.png'}));
