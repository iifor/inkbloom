const task=await taskSpace(21),page=task.page('p1');
console.log(await page.evaluate(()=>({seed:inkbloom.game.ctx.state.seed,terrain:inkbloom.game.ctx.state.terrainVersion,towns:[...inkbloom.game.scenes.towns.keys()]})));
const {profileRoute}=await import('./profile.mjs');
await profileRoute(page,'sprint-town',{x:1108,z:171.88,dx:0,dz:-.9,frames:1500});
