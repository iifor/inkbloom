const task=await taskSpace(12), p=task.page('p2');
const result=await p.evaluate(()=>{
 const a=window.inkbloom; a.step(2); a.ctx.renderer.render();
 return {image:a.ctx.renderer.renderer.domElement.toDataURL('image/png'), poses:[...a.ctx.net.remote.players.values()].map(r=>({rest:r.samples.at(-1)?.m.rest,at:r.at})), models:[...a.ctx.net.remote.figures.couriers.pools].map(([key,pool])=>({key,used:pool.used}))};
});
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/rest-net-qa/sitting.png',Buffer.from(result.image.split(',')[1],'base64'));
console.log({poses:result.poses,models:result.models});
