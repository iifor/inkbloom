const task = await taskSpace(4), page = task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument', {source: `window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);`});
await page.goto('http://127.0.0.1:5192/?world=gpu-stall-paced60-a&seed=4242');
await page.waitForFunction(()=>!!window.inkbloom?.ctx, undefined, {timeout:60000});
await page.evaluate(async()=>{
 const api=inkbloom,r=api.ctx.renderer;api.game.loop.stop();
 for(let i=0;i<300;i++){api.step();await new Promise(resolve=>setTimeout(resolve,8));}
 api.fly(true);api.look(-Math.PI/2,-.1);r.maxPixelRatio=1;r.pixelRatio=1;r.resize();r.governor.frame=()=>false;r.passTimes=null;
 const gl=r.renderer.getContext();
 const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
 while(gl.clientWaitSync(sync,0,0)===gl.TIMEOUT_EXPIRED)await new Promise(resolve=>setTimeout(resolve,1));gl.deleteSync(sync);
 window.flightResult={frames:[],intervals:[],render:[],fences:[],pending:[],next:performance.now(),last:0,invalidWait:0,glError:0};
 const original=r.render.bind(r);r.render=(...args)=>{const t=performance.now();try{return original(...args);}finally{flightResult.render.push(performance.now()-t);}};
});
for(let part=0;part<3;part++){
 console.log(await page.evaluate(async(part)=>{
  const api=inkbloom,r=api.ctx.renderer,gl=r.renderer.getContext(),out=flightResult;
  for(let f=part*300;f<(part+1)*300;f++){
   let delay=out.next-performance.now();while(delay>0){await new Promise(resolve=>setTimeout(resolve,delay));delay=out.next-performance.now();}
   const start=performance.now();if(out.last)out.intervals.push(start-out.last);out.last=start;out.next=Math.max(out.next+1000/60,start+1000/60);
   while(out.pending.length){const p=out.pending[0],status=gl.clientWaitSync(p.sync,0,0);if(status===gl.TIMEOUT_EXPIRED)break;if(status===gl.WAIT_FAILED)out.invalidWait++;out.pending.shift();out.fences.push({f:p.f,latency:performance.now()-p.at,frames:f-p.f});gl.deleteSync(p.sync);}
   api.ctx.player.position.set(64+f*2,20,64+f*.12);const t=performance.now();api.game.loop.step(1/60);out.frames.push(performance.now()-t);
   out.pending.push({sync:gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0),at:performance.now(),f});gl.flush();
  }
  return {part,max:Math.max(...out.frames),renderMax:Math.max(...out.render),slow:out.frames.flatMap((ms,f)=>ms>25?[{f,ms}]:[]),pending:out.pending.length};
 },part));
}
const result=await page.evaluate(()=>{const gl=inkbloom.ctx.renderer.renderer.getContext();flightResult.pending.forEach(p=>gl.deleteSync(p.sync));flightResult.pending=[];flightResult.glError=gl.getError();return flightResult;});
const fs=await import('node:fs/promises');await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/gpu-stall-20261127/paced60-a.json',JSON.stringify(result,null,2));
