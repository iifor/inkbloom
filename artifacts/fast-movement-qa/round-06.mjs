const task=await taskSpace(21),page=task.page('p1');
console.log(await page.evaluate(()=>({pos:inkbloom.info().pos,towns:inkbloom.game.ctx.wilderness.entrancesNear(64,64,1).map(e=>({id:e.cityId,x:e.x,z:e.z,ox:e.ox,oz:e.oz,size:e.size})),renderer:inkbloom.game.ctx.renderer.renderer.info.memory})));
const {profileRoute}=await import('./profile.mjs');
await profileRoute(page,'sprint-return',{x:1862,z:171.88,dx:-.9,dz:0,frames:900});
