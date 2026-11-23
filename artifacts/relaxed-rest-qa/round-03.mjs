const t=await taskSpace(16);
for(const id of ['p1','p2']) {
 const p=t.page(id);await p.click("loc=role:button[name*='开始：']");
 console.log(await p.evaluate(id=>{const a=window.inkbloom; a.teleport(id==='p1'?40:42.2,id==='p1'?40:38.6);a.look(id==='p1'?0:Math.atan2(2.2,-1.4),id==='p1'?-.25:-.35);a.step(8);return a.info();},id));
}
await t.page('p1').keyboard.press('x');
console.log(await t.page('p1').evaluate(()=>{window.inkbloom.step(55);return window.inkbloom.ctx.player.restMotion;}));
await t.page('p2').waitForFunction(()=>{window.inkbloom.step(1);return [...window.inkbloom.ctx.net.remote.players.values()].some(r=>r.samples.at(-1)?.m.rest?.sitting===1);},undefined,{timeout:10000});
for(const [id,name] of [['p1','sit-first'],['p2','sit-side']]) {
 const p=t.page(id);const data=await p.evaluate(()=>{const a=window.inkbloom;a.step(10);a.ctx.renderer.render();return a.ctx.renderer.renderer.domElement.toDataURL('image/png');});
 await (await import('node:fs/promises')).writeFile(`C:/Users/Administrator/Desktop/inkbloom/artifacts/relaxed-rest-qa/${name}.png`,Buffer.from(data.split(',')[1],'base64'));
}
