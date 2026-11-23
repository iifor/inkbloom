const task=await taskSpace(12), actor=task.page('p1'), observer=task.page('p2');
await actor.keyboard.press('z');
console.log(await actor.evaluate(()=>{window.inkbloom.step(70);return window.inkbloom.ctx.player.restMotion;}));
await observer.waitForFunction(()=>{window.inkbloom.step(1);return [...window.inkbloom.ctx.net.remote.players.values()].some(r=>r.samples.at(-1)?.m.rest?.lying===1);},undefined,{timeout:10000});
const data=await observer.evaluate(()=>{
 const a=window.inkbloom;a.look(Math.atan2(2.4,-3.2),-.34);a.step(10);a.ctx.renderer.render();
 return {image:a.ctx.renderer.renderer.domElement.toDataURL('image/png'),pose:[...a.ctx.net.remote.players.values()].filter(r=>r.drawn).map(r=>r.samples.at(-1)?.m.rest)};
});
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/rest-net-qa/lying.png',Buffer.from(data.image.split(',')[1],'base64'));
console.log(data.pose);
