const task=await taskSpace(5);const page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false,scale:1});
await page.cdp('Emulation.setEmulatedMedia',{media:'screen'});
console.log(await page.evaluate(()=>({viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,scene:document.querySelector('.startup-scene').getBoundingClientRect().toJSON(),layout:document.querySelector('.startup-layout').getBoundingClientRect().toJSON(),animations:document.getAnimations().length,mask:getComputedStyle(document.querySelector('.startup-village-colour')).maskImage})));
const pdf=await page.cdp('Page.printToPDF',{landscape:true,printBackground:true,paperWidth:15,paperHeight:9.375,marginTop:0,marginBottom:0,marginLeft:0,marginRight:0,scale:1});
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-qa/desktop.pdf',Buffer.from(pdf.data,'base64'));
console.log('PDF saved');
