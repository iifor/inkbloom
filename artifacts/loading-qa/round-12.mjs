const task=await taskSpace(5);const page=task.page('p1');
console.log({gameCheck:await page.evaluate(()=>({hidden:document.querySelector('#startup')?.hidden,status:document.querySelector('#startup-status')?.textContent,errors:window.loadingQAEvidence?.errors}))});
await page.goto('http://127.0.0.1:5192/artifacts/loading-qa/preview.html',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.startupQA?.ready,undefined,{timeout:15000});
await page.evaluate(async()=>{document.querySelector('#preview-controls').hidden=true;await document.fonts.ready;});
const fs=await import('node:fs/promises');
const base='C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-qa/';
const results={};
results.motion=await page.evaluate(async()=>{
  const brush=document.querySelector('.startup-brush-stroke');
  const transforms=new Set();
  for(let i=0;i<12;i++){transforms.add(getComputedStyle(brush).transform);await new Promise(r=>setTimeout(r,100));}
  return {transforms:[...transforms],running:brush.getAnimations().map(x=>({time:x.currentTime,playState:x.playState}))};
});
for(const [name,width,height] of [['mobile',375,812],['desktop',1440,900]]){
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false,scale:1});
  results[name]=await page.evaluate(()=>({viewport:[innerWidth,innerHeight],layout:document.querySelector('.startup-layout').getBoundingClientRect().toJSON(),horizontalOverflow:getComputedStyle(document.querySelector('#startup')).overflowX,message:document.querySelector('#startup-message').textContent}));
  const pdf=await page.cdp('Page.printToPDF',{landscape:false,printBackground:true,paperWidth:width/96,paperHeight:height/96,marginTop:0,marginBottom:0,marginLeft:0,marginRight:0,scale:1});
  await fs.writeFile(base+name+'-accepted.pdf',Buffer.from(pdf.data,'base64'));
}
await fs.writeFile(base+'final-results.json',JSON.stringify(results,null,2));
console.log(results);
await page.evaluate(()=>{document.querySelector('#preview-controls').hidden=false;});
