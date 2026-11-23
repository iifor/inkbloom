const t=await taskSpace(16),a=t.page('p1'),b=t.page('p2');
await a.keyboard.press('z');await a.evaluate(()=>window.inkbloom.step(70));
await b.waitForFunction(()=>{window.inkbloom.step(1);return [...window.inkbloom.ctx.net.remote.players.values()].some(r=>r.samples.at(-1)?.m.rest?.lying===1);},undefined,{timeout:10000});
for(const [id,name] of [['p1','lie-first'],['p2','lie-side']]) {
 const p=t.page(id);const data=await p.evaluate(id=>{const a=window.inkbloom;if(id==='p1')a.look(0,-.35);a.step(10);a.ctx.renderer.render();return a.ctx.renderer.renderer.domElement.toDataURL('image/png');},id);
 await (await import('node:fs/promises')).writeFile(`C:/Users/Administrator/Desktop/inkbloom/artifacts/relaxed-rest-qa/${name}.png`,Buffer.from(data.split(',')[1],'base64'));
}
console.log('Lying views saved.');
await a.keyboard.down('w');await a.evaluate(()=>window.inkbloom.step(3));await a.keyboard.up('w');
console.log(await a.evaluate(()=>{window.inkbloom.step(40);return {standing:!window.inkbloom.ctx.player.restMotion};}));
