const task=await taskSpace(4),page=task.page('p1');
await page.evaluate(async()=>{inkbloom.game.loop.stop();for(let i=0;i<450;i++){inkbloom.step();if(i%4===0)await new Promise(r=>setTimeout(r,0));}});
await page.cdp('Tracing.start',{categories:'gpu,disabled-by-default-gpu.service,disabled-by-default-gpu.device,devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});
console.log(await page.evaluate(()=>{
 const api=inkbloom,r=api.ctx.renderer;api.game.loop.stop();api.fly(true);api.look(-Math.PI/2,-.1);r.maxPixelRatio=1;r.pixelRatio=1;r.resize();r.governor.frame=()=>false;r.passTimes=null;
 const gl=r.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
 window.stallRun={done:false,frame:0,frames:[],slow:[],gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
 void(async()=>{const out=window.stallRun;for(let f=0;f<300;f++){
  api.ctx.player.position.set(64+f*2,20,64+f*.12);performance.mark('flight-frame-start');
  const start=performance.now();api.game.loop.step(1/60);const ms=performance.now()-start;performance.measure('flight-step','flight-frame-start');out.frames.push(ms);out.frame=f;
  if(ms>20)out.slow.push({f,ms});await new Promise(resolve=>setTimeout(resolve,12));
 }out.done=true;})();return {started:true,gpu:window.stallRun.gpu};
}));
