const task=await taskSpace(21),page=task.page('p1');
const result=await page.evaluate(async()=>{
 const game=inkbloom.game,wild=game.scenes.wild;game.loop.stop();
 wild.building?.steps.return();wild.building=null;
 const key=[...wild.loaded.keys()].find(k=>wild.physics.groups.has('chunk:'+k+':door:0'));
 if(!key)throw new Error('No loaded farm chunk');
 wild.unload(key,wild.loaded.get(key));
 const [cx,cz]=key.split(',').map(Number);
 const groups=()=>[...wild.physics.groups.keys()].sort();
 const results=[];
 for(let stage=0;stage<4;stage++){
  const before={groups:groups(),children:wild.root.children.length,households:wild.households.size,chunks:wild.chunkCount};
  const steps=wild.loadSteps(cx,cz);let ticks=0,stages=0;
  try{while(true){const next=steps.next();ticks++;if(next.done)throw new Error('Unexpected completed chunk at stage '+stage);
   if(wild.physics.groups.has('chunk:'+key)&&stages++===stage)break;
   if(ticks>100000)throw new Error('Generation did not finish');
   if(ticks%100===0)await new Promise(r=>setTimeout(r,0));
  }}finally{steps.return();}
  const after={groups:groups(),children:wild.root.children.length,households:wild.households.size,chunks:wild.chunkCount};
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Cancelled chunk leaked '+JSON.stringify({stage,before,after}));
  results.push({stage,ticks,restored:true});
 }
 const start=game.ctx.player.position.clone();
 for(const [x,z] of [[1200,1200],[-1200,-1200],[start.x,start.z]]){
  game.ctx.player.position.set(x,60,z);
  for(let f=0;f<90;f++){game.loop.step(1/60);if(f%5===0)await new Promise(r=>setTimeout(r,0));}
 }
 const pcx=Math.floor(start.x/128),pcz=Math.floor(start.z/128);
 const stale=[...wild.loaded.keys()].filter(k=>{const [x,z]=k.split(',').map(Number);return Math.max(Math.abs(x-pcx),Math.abs(z-pcz))>3;});
 if(stale.length)throw new Error('Stale chunks '+stale);
 return {key,cancellations:results,teleportReturn:{chunks:wild.chunkCount,stale:stale.length,colliders:wild.physics.count}};
});
const fs=await import('node:fs/promises');await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/fast-movement-qa/lifecycle.json',JSON.stringify(result,null,2));console.log(result);
