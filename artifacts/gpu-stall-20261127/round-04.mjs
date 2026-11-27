const task=await taskSpace(4),page=task.page('p1');
await page.cdp('Tracing.start',{categories:'gpu,disabled-by-default-gpu.service,disabled-by-default-gpu.device,devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});
const result=await page.evaluate(async()=>{
 const api=inkbloom;api.game.loop.stop();const r=api.ctx.renderer;r.passTimes=new Map();r.gpuFrames=0;
 const gl=r.renderer.getContext(),frames=[],slow=[];
 for(let f=0;f<300;f++){
  api.ctx.player.position.set(664+f*2,20,100+f*.12);performance.mark('flight-start');const t=performance.now();api.game.loop.step(1/60);const ms=performance.now()-t;performance.measure('flight','flight-start');frames.push(ms);if(ms>20)slow.push({f,ms});gl.finish();if(f%4===0)await new Promise(r=>setTimeout(r,0));
 }r.passTimes=null;return {frames,slow,max:Math.max(...frames)};
});
await page.cdp('Tracing.end');
let stream;let lastEvents;
for(let i=0;i<40&&!stream;i++){const events=await page.events();lastEvents=events;const event=events.find(e=>e.method==='Tracing.tracingComplete');if(event){stream=event.params.stream;break;}await new Promise(r=>setTimeout(r,100));}
console.log({result,stream,lastEventKeys:lastEvents?.map(e=>Object.keys(e))});
if(stream){const chunks=[];while(true){const part=await page.cdp('IO.read',{handle:stream});chunks.push(part.data);if(part.eof)break;}await page.cdp('IO.close',{handle:stream});const fs=await import('node:fs/promises');await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/gpu-stall-20261127/gpu-trace.json',chunks.join(''));}
