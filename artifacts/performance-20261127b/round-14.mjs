const task=await taskSpace(3),page=task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);`});
await page.goto('http://127.0.0.1:5192/?world=performance-20261127b-actor-preflight&seed=4242');
await page.waitForFunction(()=>!!window.inkbloom?.ctx,undefined,{timeout:60000});
await page.evaluate(async()=>{
 inkbloom.game.loop.stop();for(let n=0;n<450;n++){inkbloom.step();if(n%4===0)await new Promise(r=>setTimeout(r,0));}
 const {KayKitVillager,loadVillager}=await import('/src/systems/figures/kaykit-villager.ts');
 const actor=new KayKitVillager(await loadVillager('rogue-hooded'));
 const r=inkbloom.ctx.renderer;actor.root.position.set(0,-1,-2);r.camera.add(actor.root);
 r.render();r.renderer.getContext().finish();actor.root.removeFromParent();window.warmActor=actor;
});
const result=await page.evaluate(async()=>{
 const api=inkbloom,game=api.game,r=api.ctx.renderer,rr=r.renderer;api.fly(true);api.look(-Math.PI/2,-.1);r.maxPixelRatio=1;r.pixelRatio=1;r.resize();r.governor.frame=()=>false;
 const gl=rr.getContext(),old=rr.renderBufferDirect,draws=[];let frame=0;gl.finish();
 rr.renderBufferDirect=function(camera,scene,geometry,material,obj,group){const start=performance.now();const result=old.apply(this,arguments);const ms=performance.now()-start;if(ms>4){const path=[];for(let p=obj;p;p=p.parent)path.push(p.name||p.type);draws.push({frame,ms,path,defines:material.defines,vertices:geometry.getAttribute('position')?.count,indices:geometry.index?.count});}return result;};
 try{for(;frame<180;frame++){api.ctx.player.position.set(64+frame*2,20,64+frame*.12);game.loop.step(1/60);gl.finish();if(frame%4===0)await new Promise(r=>setTimeout(r,0));}}
 finally{rr.renderBufferDirect=old;window.warmActor.dispose();}
 return draws;
});
console.log(result);
