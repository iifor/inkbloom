const task=await taskSpace(2);
const page=task.page('p1');
await page.reload();
await page.waitForFunction(()=>!!window.inkbloom?.ctx,undefined,{timeout:30000});
console.log(await page.evaluate(()=>{
  const api=window.inkbloom;
  api.game.loop.stop();
  api.step(36);
  const sys=api.game.loop.systems.find(s=>s.id==='infection');
  return {world:api.ctx.state.id, saved:api.ctx.state.infectedPeople.get('resident:borderqa'),
    live:sys.group?.monsters.filter(m=>m.key==='resident:borderqa'&&!m.dead).length??0,
    shaderAreas:api.ctx.renderer.post.uniforms.uInkAreaCount.value};
}));
