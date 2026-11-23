const t=await taskSpace(12);
for(const [id,host] of [['p1','localhost'],['p2','127.0.0.1']]) {
 const p=t.page(id); await p.goto(`http://${host}:5290/?server=127.0.0.1:5297`);
 await p.waitForSelector("loc=role:button[name='加入']"); await p.click("loc=role:button[name='加入']");
 await p.waitForSelector("loc=role:button[name*='开始：']",{timeout:60000}); await p.click("loc=role:button[name*='开始：']");
 console.log(await p.evaluate(id=>{const a=window.inkbloom; a.teleport(id==='p1'?40:42.4,id==='p1'?40:36.8); a.look(id==='p1'?0:Math.atan2(2.4,-3.2),id==='p1'?0:-.17); a.step(8); return a.info();},id));
}
await t.page('p1').keyboard.press('x');
console.log(await t.page('p1').evaluate(()=>{window.inkbloom.step(60);return window.inkbloom.ctx.player.restMotion;}));
