const task=await taskSpace(12);
for(const id of ['p1','p2']) await task.page(id).click("loc=role:button[name='确定，开始游戏']");
const p=task.page('p2');
const data=await p.evaluate(()=>{
 const a=window.inkbloom; a.look(Math.atan2(2.4,-3.2),-.28); a.step(10); a.ctx.renderer.render();
 return {image:a.ctx.renderer.renderer.domElement.toDataURL('image/png'),pose:[...a.ctx.net.remote.players.values()].filter(r=>r.drawn).map(r=>r.samples.at(-1)?.m.rest)};
});
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/rest-net-qa/sitting.png',Buffer.from(data.image.split(',')[1],'base64'));
console.log(data.pose);
console.log(await p.snapshot());
