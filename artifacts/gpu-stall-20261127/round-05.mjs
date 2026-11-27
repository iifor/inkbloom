const task=await taskSpace(4),page=task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);`});
await page.goto('http://127.0.0.1:5192/?world=gpu-stall-trace-fresh&seed=4242');
await page.waitForFunction(()=>!!window.inkbloom?.ctx,undefined,{timeout:60000});
await page.evaluate(async()=>{inkbloom.game.loop.stop();for(let i=0;i<450;i++){inkbloom.step();if(i%4===0)await new Promise(r=>setTimeout(r,0));}});
await page.cdp('Tracing.start',{categories:'gpu,disabled-by-default-gpu.service,disabled-by-default-gpu.device,devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});
const result=await page.evaluate(async()=>{
 const api=inkbloom,r=api.ctx.renderer;api.game.loop.stop();api.fly(true);api.look(-Math.PI/2,-.1);r.maxPixelRatio=1;r.pixelRatio=1;r.resize();r.governor.frame=()=>false;r.passTimes=new Map();r.gpuFrames=0;
 const gl=r.renderer.getContext(),frames=[],slow=[];gl.finish();
 for(let f=0;f<300;f++){
  api.ctx.player.position.set(64+f*2,20,64+f*.12);performance.mark('flight-start');const t=performance.now();api.game.loop.step(1/60);const ms=performance.now()-t;performance.measure('flight','flight-start');frames.push(ms);if(ms>20)slow.push({f,ms});gl.finish();if(f%4===0)await new Promise(r=>setTimeout(r,0));
 }r.passTimes=null;return {frames,slow,max:Math.max(...frames)};
});
await page.cdp('Tracing.end');let stream;
for(let i=0;i<40&&!stream;i++){const events=await page.events();const event=events.find(e=>e.method==='Tracing.tracingComplete');if(event){stream=event.params.stream;break;}await new Promise(r=>setTimeout(r,100));}
console.log({slow:result.slow,max:result.max,stream});
const fs=await import('node:fs/promises');const dir='C:/Users/Administrator/Desktop/inkbloom/artifacts/gpu-stall-20261127/';await fs.writeFile(dir+'burst-fresh.json',JSON.stringify(result,null,2));
if(stream){const chunks=[];while(true){const part=await page.cdp('IO.read',{handle:stream});chunks.push(part.data);if(part.eof)break;}await page.cdp('IO.close',{handle:stream});await fs.writeFile(dir+'gpu-trace-fresh.json',chunks.join(''));}
