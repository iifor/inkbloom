const task=await taskSpace(3),page=task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);`});
await page.goto('http://127.0.0.1:5192/?world=performance-20261127b-shaders&seed=4242');
await page.waitForFunction(()=>!!window.inkbloom?.ctx,undefined,{timeout:60000});
const result=await page.evaluate(async()=>{
  const api=inkbloom,game=api.game,r=api.ctx.renderer;game.loop.stop();api.fly(true);api.look(-Math.PI/2,-.1);
  r.maxPixelRatio=1;r.pixelRatio=1;r.resize();r.governor.frame=()=>false;
  const gl=r.renderer.getContext(),old=gl.getProgramInfoLog,events=[];let frame=0;
  const programs=()=>r.renderer.info.programs.map(p=>({id:p.id,name:p.name,cacheKey:p.cacheKey}));const before=programs();
  gl.getProgramInfoLog=function(p){const start=performance.now();const result=old.call(this,p);const ms=performance.now()-start;
    events.push({frame,ms,shaders:gl.getAttachedShaders(p).map(s=>gl.getShaderSource(s))});return result;};
  try{for(;frame<700;frame++){api.ctx.player.position.set(64+frame*2,20,64+frame*.12);game.loop.step(1/60);if(frame%4===0)await new Promise(r=>setTimeout(r,0));}}
  finally{gl.getProgramInfoLog=old;}
  return {before,after:programs(),events};
});
const fs=await import('node:fs/promises');await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/performance-20261127b/shaders.json',JSON.stringify(result,null,2));
console.log({before:result.before.map(p=>({id:p.id,name:p.name})),added:result.after.filter(p=>!result.before.some(b=>b.id===p.id)),events:result.events.map(e=>({frame:e.frame,ms:e.ms,heads:e.shaders.map(s=>s.slice(0,350))}))});
