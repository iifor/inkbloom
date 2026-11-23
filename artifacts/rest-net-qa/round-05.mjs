const task=await taskSpace(12);
for(const id of ['p1','p2']) {
 const p=task.page(id);
 await p.click("loc=role:button[name*='开始：']");
 console.log(await p.evaluate((id)=>{
  const a=window.inkbloom; a.teleport(id==='p1'?40:43, id==='p1'?40:44); a.look(id==='p1'?0:Math.atan2(3,4),id==='p1'?0:-.2); a.step(8);
  return {pos:a.info().pos,restAllowed:a.ctx.player.canRest('lying')};
 },id));
}
await task.page('p1').keyboard.press('x');
console.log(await task.page('p1').evaluate(()=>{window.inkbloom.step(60); return {rest:window.inkbloom.ctx.player.restMotion, posture:window.inkbloom.ctx.player.resting};}));
console.log(await task.page('p2').evaluate(()=>{window.inkbloom.step(12); return [...window.inkbloom.ctx.net.remote.players.values()].map(r=>({drawn:r.drawn, sample:r.samples.at(-1)?.m}));}));
