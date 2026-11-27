export async function flightCheck(page, {name, hz=60, queries=false, fixedBuffer=false}) {
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1400,height:1361,deviceScaleFactor:1,mobile:false});
 await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);`});
 await page.goto(`http://127.0.0.1:5192/?world=${name}&seed=4242`);
 await page.waitForFunction(()=>!!window.inkbloom?.game.loop.isRunning,undefined,{timeout:60000});
 await page.evaluate(async({hz,queries,fixedBuffer})=>{
  const api=inkbloom,r=api.ctx.renderer;api.game.loop.stop();
  for(let i=0;i<300;i++){api.step();await new Promise(resolve=>setTimeout(resolve,16));}
  api.game.loop.stop();api.fly(true);api.look(-Math.PI/2,-.1);
  if(fixedBuffer){r.maxPixelRatio=1;r.pixelRatio=1;r.resize();r.governor.frame=()=>false;}
  r.passTimes=queries?new Map():null;
  const gl=r.renderer.getContext();const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
  while(gl.clientWaitSync(sync,0,0)===gl.TIMEOUT_EXPIRED)await new Promise(resolve=>setTimeout(resolve,1));gl.deleteSync(sync);
  window.flightCheckResult={hz,queries,fixedBuffer,frames:[],intervals:[],render:[],fences:[],pending:[],buffers:[],invalidWait:0,errors:[],gpu:{},last:0,next:0};
  flightCheckResult.programQueries=0;flightCheckResult.programs=[];
  const programInfo=gl.getProgramInfoLog.bind(gl);gl.getProgramInfoLog=(...args)=>{flightCheckResult.programQueries++;flightCheckResult.programs.push({frame:flightCheckResult.frames.length,shaders:gl.getAttachedShaders(args[0]).map(shader=>gl.getShaderSource(shader))});return programInfo(...args);};
  if(queries){
   const queryFrames=new WeakMap(),begin=gl.beginQuery.bind(gl),get=gl.getQueryParameter.bind(gl);
   flightCheckResult.gpuByFrame={};
   gl.beginQuery=(target,query)=>{queryFrames.set(query,flightCheckResult.frames.length);return begin(target,query);};
   gl.getQueryParameter=(query,key)=>{const result=get(query,key);if(key===gl.QUERY_RESULT){const f=queryFrames.get(query);flightCheckResult.gpuByFrame[f]=(flightCheckResult.gpuByFrame[f]??0)+result/1e6;}return result;};
  }
  const original=r.render.bind(r);r.render=(...args)=>{const t=performance.now();try{return original(...args);}finally{flightCheckResult.render.push(performance.now()-t);}};
  window.addEventListener('error',e=>flightCheckResult.errors.push(e.message));
 },{hz,queries,fixedBuffer});
 for(let part=0;part<3;part++){
  console.log(await page.evaluate(async(part)=>{
   const api=inkbloom,r=api.ctx.renderer,gl=r.renderer.getContext(),out=flightCheckResult;
   if(api.game.loop.isRunning)throw new Error('Controlled benchmark requires the game loop to be stopped');
   out.next=performance.now();out.last=0;
   for(let f=part*300;f<(part+1)*300;f++){
    let delay=out.next-performance.now();while(delay>0){await new Promise(resolve=>setTimeout(resolve,delay));delay=out.next-performance.now();}
    const start=performance.now();if(out.last)out.intervals.push(start-out.last);out.last=start;out.next=start+1000/out.hz;
    while(out.pending.length){const p=out.pending[0],status=gl.clientWaitSync(p.sync,0,0);if(status===gl.TIMEOUT_EXPIRED)break;if(status===gl.WAIT_FAILED)out.invalidWait++;out.pending.shift();out.fences.push({f:p.f,latency:performance.now()-p.at,frames:f-p.f});gl.deleteSync(p.sync);}
    api.ctx.player.position.set(64+f*2,20,64+f*.12);const t=performance.now();api.game.loop.step(1/out.hz);out.frames.push(performance.now()-t);
    out.pending.push({sync:gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0),at:performance.now(),f});gl.flush();
    if(f%60===0)out.buffers.push([gl.drawingBufferWidth,gl.drawingBufferHeight]);
   }
   return {part,max:Math.max(...out.frames),renderMax:Math.max(...out.render),slow:out.frames.flatMap((ms,f)=>ms>25?[{f,ms}]:[]),pending:out.pending.length};
  },part));
 }
 const result=await page.evaluate(async()=>{
  const out=flightCheckResult,r=inkbloom.ctx.renderer,gl=r.renderer.getContext();
  const timeout=performance.now()+5000;
  while(out.pending.length&&performance.now()<timeout){
   const p=out.pending[0],status=gl.clientWaitSync(p.sync,0,0);
   if(status===gl.TIMEOUT_EXPIRED){await new Promise(resolve=>setTimeout(resolve,1));continue;}
   if(status===gl.WAIT_FAILED)out.invalidWait++;out.pending.shift();gl.deleteSync(p.sync);
  }
  out.pendingCount=out.pending.length;out.pending.forEach(p=>gl.deleteSync(p.sync));out.pending=[];
  const totals=r.passTimes;r.passTimes=null;out.gpu={frames:r.gpuFrames,totals:Object.fromEntries(totals??[])};
  if(out.render.length!==out.frames.length)throw new Error('Unexpected extra renders during benchmark');
  out.glError=gl.getError();return out;
 });
 const fs=await import('node:fs/promises');await fs.writeFile(`C:/Users/Administrator/Desktop/inkbloom/artifacts/gpu-stall-20261127/${name}.json`,JSON.stringify(result,null,2));
 const stats=values=>{const a=[...values].sort((a,b)=>a-b);return {p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],max:a.at(-1),over50:a.filter(v=>v>50).length};};
 console.log(JSON.stringify({name,frames:stats(result.frames),render:stats(result.render),intervals:stats(result.intervals),maxFenceFrames:Math.max(...result.fences.map(f=>f.frames)),buffers:[...new Set(result.buffers.map(b=>b.join('x')))],gpuFrames:result.gpu.frames,errors:result.errors,glError:result.glError}));
}
