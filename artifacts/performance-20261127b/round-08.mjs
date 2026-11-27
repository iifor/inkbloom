const task=await taskSpace(3),page=task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);`});
await page.goto('http://127.0.0.1:5192/?world=performance-20261127b-shader-details&seed=4242');
await page.waitForFunction(()=>!!window.inkbloom?.ctx,undefined,{timeout:60000});
await page.evaluate(async()=>{inkbloom.game.loop.stop();for(let n=0;n<450;n++){inkbloom.step();if(n%4===0)await new Promise(r=>setTimeout(r,0));}});
const result=await page.evaluate(async()=>{
 const api=inkbloom,game=api.game,r=api.ctx.renderer;
 api.fly(true);api.look(-Math.PI/2,-.1);r.maxPixelRatio=1;r.pixelRatio=1;r.resize();r.governor.frame=()=>false;
 const gl=r.renderer.getContext(),old=gl.getProgramInfoLog,render=r.renderer.render,events=[],draws=[];let frame=0;gl.finish();
 const existing=new Set(r.renderer.info.programs.map(p=>p.id));
 gl.getProgramInfoLog=function(p){const start=performance.now();const result=old.call(this,p);const ms=performance.now()-start;events.push({frame,ms,shaders:gl.getAttachedShaders(p).map(s=>gl.getShaderSource(s))});return result;};
 r.renderer.render=function(scene,camera){const start=performance.now();const result=render.call(this,scene,camera);const ms=performance.now()-start;
  if(ms>8)draws.push({frame,ms,scene:scene===r.scene?'world':scene.children.map(o=>o.name||o.type),added:this.info.programs.filter(p=>!existing.has(p.id)).map(p=>({id:p.id,key:p.cacheKey}))});
  for(const p of this.info.programs)existing.add(p.id);return result;};
 window.perfShaderResult={events,draws};
 try{for(;frame<600;frame++){api.ctx.player.position.set(64+frame*2,20,64+frame*.12);game.loop.step(1/60);gl.finish();if(frame%4===0)await new Promise(r=>setTimeout(r,0));}}
 finally{gl.getProgramInfoLog=old;r.renderer.render=render;}
 return window.perfShaderResult;
});
const fs=await import('node:fs/promises');await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/performance-20261127b/shader-details.json',JSON.stringify(result,null,2));
console.log({draws:result.draws,events:result.events.map(e=>({frame:e.frame,ms:e.ms,signature:e.shaders.map(s=>s.match(/#define (USE_\w+|WIND|REEDS)[^\n]*|uniform \w+ \w+[^\n]*|attribute \w+ a\w+[^\n]*/g))}))});
