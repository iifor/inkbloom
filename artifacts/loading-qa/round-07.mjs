const task=await taskSpace(5);const page=task.page('p1');
const fs=await import('node:fs/promises');
const base='C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-qa/';
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.startupQA?.ready,undefined,{timeout:15000});
await page.evaluate(async()=>{document.querySelector('#preview-controls').hidden=true;await document.fonts.ready;});
const results={};
results.progress=await page.evaluate(()=>{
  const read=()=>({value:document.querySelector('progress').value,phase:document.querySelector('#startup').dataset.phase});
  const out=[];
  startupQA.set(0);out.push(read());
  startupQA.screen.update(.25,'work');out.push(read());
  startupQA.screen.update(.68,'work');out.push(read());
  startupQA.screen.update(.20,'work');out.push(read());
  startupQA.screen.update(NaN,'invalid');out.push(read());
  startupQA.screen.update(1.2,'done');out.push(read());
  return out;
});
await page.evaluate(()=>startupQA.set(68));
await page.waitForFunction(()=>getComputedStyle(document.querySelector('#startup')).getPropertyValue('--startup-progress').trim()==='68%');
results.motion=await page.evaluate(async()=>{
  const brush=document.querySelector('.startup-brush-stroke');
  const before=getComputedStyle(brush).transform;
  await new Promise(r=>setTimeout(r,200));
  return {before,after:getComputedStyle(brush).transform,animations:document.getAnimations().length};
});
for(const [name,width,height] of [['desktop',1440,900],['mobile',375,812],['short',844,390]]){
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false,scale:1});
  results[name]=await page.evaluate(()=>{
    const root=document.querySelector('#startup'),layout=document.querySelector('.startup-layout'),copy=document.querySelector('.startup-copy');
    return {viewport:[innerWidth,innerHeight],scroll:[root.scrollWidth,root.scrollHeight],client:[root.clientWidth,root.clientHeight],layout:layout.getBoundingClientRect().toJSON(),copy:copy.getBoundingClientRect().toJSON()};
  });
  const pdf=await page.cdp('Page.printToPDF',{landscape:false,printBackground:true,paperWidth:width/96,paperHeight:height/96,marginTop:0,marginBottom:0,marginLeft:0,marginRight:0,scale:1});
  await fs.writeFile(base+name+'-final.pdf',Buffer.from(pdf.data,'base64'));
}
await page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
results.reduced=await page.evaluate(()=>{
  startupQA.set(68);
  const animations=document.getAnimations().length;
  startupQA.screen.finish();
  return {animations,hidden:document.querySelector('#startup').hidden};
});
await page.cdp('Emulation.setEmulatedMedia',{features:[]});
await page.evaluate(()=>{startupQA.set(100);startupQA.screen.finish();});
await page.waitForFunction(()=>document.querySelector('#startup').hidden,undefined,{timeout:2000});
results.finish=await page.evaluate(()=>({hidden:document.querySelector('#startup').hidden,inert:document.querySelector('#startup').inert,busy:document.querySelector('#startup').getAttribute('aria-busy'),animations:document.getAnimations().length}));
await fs.writeFile(base+'ui-results.json',JSON.stringify(results,null,2));
console.log(results);
