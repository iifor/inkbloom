const task=await taskSpace(18);const page=task.page('p1');
await page.keyboard.up('e');
console.log(await page.evaluate(async()=>{
 const api=window.inkbloom,{ctx}=api,{altar}=window.liberationQA;
 const {Vector3}=await import('/node_modules/.vite/deps/three.js');
 ctx.combat.blast(new Vector3(altar.x,altar.y+1,altar.z),35,10000);
 api.step(1);
 return{canHold:ctx.interactions.focused?.canHold?.(),infected:ctx.combat.infected,hp:ctx.combat.hp,grounded:ctx.player.grounded,active:document.activeElement?.tagName};
}));
await page.focus('canvas');
await page.keyboard.down('e');
console.log(await page.evaluate(()=>{const api=window.inkbloom;api.step(2);return{held:api.ctx.input.held('interact'),focused:api.info().focused,canHold:api.ctx.interactions.focused?.canHold?.(),awaiting:api.ctx.input.awaitingCanvas};}));
