export async function measure(page, name, config={x:64,z:64,dx:2,dz:0.12,frames:900}) {
  // Historical throughput diagnostic, NOT a frame-latency benchmark: Chromium implements
  // gl.finish() as Flush, so this unpaced loop does not fence the GPU. The corrected paced
  // benchmark and true GPU fences are in ../gpu-stall-20261127/flight-check.mjs.
  await page.evaluate(async()=>{inkbloom.game.loop.stop();for(let n=0;n<450;n++){inkbloom.step();if(n%4===0)await new Promise(r=>setTimeout(r,0));}inkbloom.ctx.renderer.renderer.getContext().finish();});
  await page.cdp('Profiler.enable');
  await page.cdp('Profiler.start');
  const result=await page.evaluate(async(config)=>{
    const api=window.inkbloom, game=api.game, ctx=api.ctx, wild=game.scenes.wild;
    game.loop.stop(); api.fly(true); api.look(-Math.PI/2,-0.1);
    ctx.renderer.maxPixelRatio=1; ctx.renderer.pixelRatio=1;ctx.renderer.resize();
    // Freeze automatic quality changes so both runs draw the same buffer.
    const governor=ctx.renderer.governor.frame;ctx.renderer.governor.frame=()=>false;
    const stats={}, restores=[], times=[], slow=[]; let parts={};
    const wrap=(obj,key,name)=>{const old=obj?.[key];if(typeof old!=='function')return;
      obj[key]=function(...args){const start=performance.now();try{return old.apply(this,args);}finally{
        const ms=performance.now()-start;const s=stats[name]??(stats[name]={total:0,max:0,over8:0});
        s.total+=ms;s.max=Math.max(s.max,ms);if(ms>8)s.over8++;parts[name]=(parts[name]??0)+ms;
      }};restores.push(()=>obj[key]=old);};
    for(const system of game.loop.systems)wrap(system,'update','system:'+system.id);
    for(const [key,obj]of Object.entries(wild))if(obj&&typeof obj.update==='function')wrap(obj,'update','wild:'+key);
    for(const key of ['updateRivers','updateDrain'])wrap(wild,key,'wild:'+key);
    for(const key of ['stream','follow'])wrap(game.scenes,key,'town:'+key);
    wrap(ctx.renderer,'render','render');wrap(ctx.renderer.renderer,'render','draw');
    const gl=ctx.renderer.renderer.getContext();for(const key of ['bufferData','bufferSubData','texImage2D','getProgramInfoLog'])wrap(gl,key,'gl:'+key);
    const load=wild.loadSteps;wild.loadSteps=function(...args){const it=load.apply(this,args);const obj={next:(...a)=>it.next(...a),return:(...a)=>it.return(...a)};wrap(obj,'next','chunk-step');return obj;};
    ctx.renderer.passTimes=new Map();ctx.renderer.gpuFrames=0;
    try{for(let f=0;f<config.frames;f++){
      ctx.player.position.set(config.x+f*config.dx,20,config.z+f*config.dz);parts={};
      const start=performance.now();game.loop.step(1/60);const ms=performance.now()-start;times.push(ms);
      if(ms>16.7)slow.push({frame:f,ms,parts:Object.entries(parts).sort((a,b)=>b[1]-a[1]).slice(0,8)});
      gl.finish();
      if(f%4===0)await new Promise(r=>setTimeout(r,0));
    }}finally{wild.loadSteps=load;for(const restore of restores)restore();ctx.renderer.governor.frame=governor;}
    const sorted=[...times].sort((a,b)=>a-b);const gpu={frames:ctx.renderer.gpuFrames,passes:Object.fromEntries(ctx.renderer.passTimes)};ctx.renderer.passTimes=null;
    return {config,stats,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],max:sorted.at(-1),over16:slow.length,over50:slow.filter(f=>f.ms>50).length,slow:slow.sort((a,b)=>b.ms-a.ms).slice(0,15),gpu,buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],draws:ctx.renderer.renderer.info.render,chunks:wild.chunkCount};
  },config);
  const {profile}=await page.cdp('Profiler.stop');
  const hotspots=profile.nodes.filter(n=>n.callFrame.url.includes('/src/')).sort((a,b)=>(b.hitCount??0)-(a.hitCount??0)).slice(0,20).map(n=>({name:n.callFrame.functionName,url:n.callFrame.url.split('/src/')[1],hits:n.hitCount}));
  const fs=await import('node:fs/promises');const dir='C:/Users/Administrator/Desktop/inkbloom/artifacts/performance-20261127b/';
  await fs.writeFile(dir+name+'.cpuprofile',JSON.stringify(profile));await fs.writeFile(dir+name+'.json',JSON.stringify({result,hotspots},null,2));
  console.log({result,hotspots});
}
