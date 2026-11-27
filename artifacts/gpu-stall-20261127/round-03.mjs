const task=await taskSpace(4),page=task.page('p1');
await page.waitForFunction(()=>window.stallRun.done,undefined,{timeout:15000});
const result=await page.evaluate(()=>window.stallRun);console.log({gpu:result.gpu,slow:result.slow,max:Math.max(...result.frames)});
await page.cdp('Tracing.end');
let stream;
for(let i=0;i<40&&!stream;i++){const events=await page.events();const event=events.find(e=>e.method==='Tracing.tracingComplete');if(event){stream=event.params.stream;break;}await new Promise(r=>setTimeout(r,100));}
if(!stream)throw new Error('Trace stream did not complete');
const chunks=[];while(true){const part=await page.cdp('IO.read',{handle:stream});chunks.push(part.data);if(part.eof)break;}
await page.cdp('IO.close',{handle:stream});
const fs=await import('node:fs/promises');const dir='C:/Users/Administrator/Desktop/inkbloom/artifacts/gpu-stall-20261127/';
await fs.writeFile(dir+'paced-before.json',JSON.stringify(result,null,2));await fs.writeFile(dir+'gpu-trace.json',chunks.join(''));
console.log({traceBytes:chunks.reduce((n,s)=>n+s.length,0)});
