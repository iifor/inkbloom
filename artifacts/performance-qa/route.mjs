export async function runRoute(page, name) {
  const fs = await import('node:fs/promises');
  await page.cdp('Profiler.enable');
  await page.cdp('Profiler.start');
  const result = await page.evaluate(async () => {
    const game=inkbloom.game, ctx=inkbloom.ctx;
    game.loop.stop();
    ctx.renderer.governor.reset(1);
    ctx.renderer.maxPixelRatio=1; ctx.renderer.pixelRatio=1; ctx.renderer.resize();
    inkbloom.fly(true); inkbloom.look(0,0);
    ctx.player.position.set(64,4,64);
    for(const record of Object.values(perfParts)) Object.assign(record,{total:0,max:0,n:0,slow:0});
    const cpu=new Map(); game.loop.profile=cpu;
    const times=[];
    for(let frame=0;frame<600;frame++) {
      ctx.player.position.x=64+frame*0.08;
      ctx.player.position.z=64-frame*0.35;
      const start=performance.now(); game.loop.step(1/60); times.push(performance.now()-start);
      if(frame%4===0) await new Promise(r=>setTimeout(r,0));
    }
    game.loop.profile=null;
    const sorted=[...times].sort((a,b)=>a-b);
    return {frames:times.length, cpu:Object.fromEntries(cpu), parts:perfParts,
      p50:sorted[300], p95:sorted[570],p99:sorted[594],max:sorted.at(-1),over16:times.filter(t=>t>16.7).length,over50:times.filter(t=>t>50).length,
      viewport:[innerWidth,innerHeight],buffer:[ctx.renderer.renderer.domElement.width,ctx.renderer.renderer.domElement.height], info:inkbloom.info()};
  });
  const {profile}=await page.cdp('Profiler.stop');
  const hits=profile.nodes.filter(n=>n.callFrame.url.includes('/src/')).sort((a,b)=>(b.hitCount??0)-(a.hitCount??0)).slice(0,18).map(n=>({name:n.callFrame.functionName,url:n.callFrame.url.split('/src/')[1],hits:n.hitCount}));
  await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/performance-qa/'+name+'.json',JSON.stringify({result,hits},null,2));
  console.log({result,hits});
}
