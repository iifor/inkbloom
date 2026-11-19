const task = await taskSpace(17);
const page = task.page('p1');
console.log(await page.evaluate(() => {
 const api=window.inkbloom; const w=api.ctx.wilderness;
 api.fly(true);api.teleport(650,650,480);api.look(0.45,-0.75);
 return {terrainVersion:w.terrainVersion,seed:w.seed,towns:w.entrancesNear(650,650,1).map(e=>({id:e.cityId,x:e.x,z:e.z,size:e.size})),info:api.info()};
}));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/village-qa/aerial.png'}));
