export async function profileRoute(page,name,config={x:64,z:64,dx:2,dz:0.12,frames:900}) {
  await page.cdp('Profiler.enable'); await page.cdp('Profiler.start');
  const result=await page.evaluate(async(config)=>{
    const game=inkbloom.game,ctx=game.ctx,wild=game.scenes.wild;
    game.loop.stop(); inkbloom.fly(true); inkbloom.look(-Math.PI/2,-0.1);
    ctx.renderer.maxPixelRatio=1;ctx.renderer.pixelRatio=1;ctx.renderer.resize();
    const stats={},restores=[];let frameParts={};
    const time=(name,fn)=>{const t=performance.now();try{return fn();}finally{const ms=performance.now()-t;const s=stats[name]??(stats[name]={total:0,max:0,over8:0});s.total+=ms;s.max=Math.max(s.max,ms);if(ms>8)s.over8++;frameParts[name]=(frameParts[name]??0)+ms;}};
    const wrap=(obj,key,name)=>{const old=obj[key];if(typeof old!=='function')return;obj[key]=function(...args){return time(name,()=>old.apply(this,args));};restores.push(()=>obj[key]=old);};
    for(const system of game.loop.systems)wrap(system,'update','system:'+system.id);
    wrap(game.loop,'before','loop:before');wrap(game.loop,'after','loop:after');
    const wrappedTowns=new Set();const instrumentTown=town=>{if(wrappedTowns.has(town))return;wrappedTowns.add(town);for(const key of ['build','finish','updateDetail','updateResidents','update','updateOutside','dispose'])wrap(town,key,'city:'+key);};
    for(const town of game.scenes.towns.values())instrumentTown(town);
    const makeCity=game.scenes.makeCity;game.scenes.makeCity=function(...args){const town=makeCity.apply(this,args);instrumentTown(town);return town;};restores.push(()=>game.scenes.makeCity=makeCity);
    for(const [key,value] of Object.entries(wild)) if(value&&typeof value.update==='function') wrap(value,'update',key);
    for(const key of ['updateRivers','updateDrain']) wrap(wild,key,key);
    for(const key of ['stream','follow'])wrap(game.scenes,key,'town:'+key);
    for(const key of ['update','prepare'])wrap(ctx.player,key,'player:'+key);
    wrap(ctx.renderer,'render','render');
    const old=wild.loadSteps;
    wild.loadSteps=function(...args){const generator=old.apply(this,args);return {next:(...args)=>time('chunk-step',()=>generator.next(...args)),return:(...args)=>generator.return(...args)};};restores.push(()=>wild.loadSteps=old);
    const times=[],slow=[];
    try{
      for(let frame=0;frame<config.frames;frame++){
        ctx.player.position.set(config.x+frame*config.dx,20,config.z+frame*config.dz);
        frameParts={};const t=performance.now();game.loop.step(1/60);const ms=performance.now()-t;times.push(ms);
        if(ms>16.7)slow.push({frame,x:ctx.player.position.x,z:ctx.player.position.z,ms,parts:Object.entries(frameParts).sort((a,b)=>b[1]-a[1]).slice(0,5)});
        if(frame%4===0)await new Promise(r=>setTimeout(r,0));
      }
    }finally{for(const restore of restores)restore();}
    const sorted=[...times].sort((a,b)=>a-b);
    return {config,stats,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],max:sorted.at(-1),over16:slow.length,over50:slow.filter(f=>f.ms>50).length,slow:slow.sort((a,b)=>b.ms-a.ms).slice(0,30),info:inkbloom.info(),buffer:[ctx.renderer.renderer.domElement.width,ctx.renderer.renderer.domElement.height],chunks:wild.chunkCount};
  },config);
  const {profile}=await page.cdp('Profiler.stop');
  const hotspots=profile.nodes.filter(n=>n.callFrame.url.includes('/src/')).sort((a,b)=>(b.hitCount??0)-(a.hitCount??0)).slice(0,25).map(n=>({name:n.callFrame.functionName,url:n.callFrame.url.split('/src/')[1],hits:n.hitCount}));
  const fs=await import('node:fs/promises');
  await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/fast-movement-qa/'+name+'.cpuprofile',JSON.stringify(profile));
  await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/fast-movement-qa/'+name+'.json',JSON.stringify({result,hotspots},null,2));
  console.log({result,hotspots});
}
