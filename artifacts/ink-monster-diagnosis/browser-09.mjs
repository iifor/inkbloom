const task = await taskSpace(2);
const page = task.page('p1');
await page.click('loc=role:button[name="开始：世界 4 · Lv 1"]');
console.log(await page.evaluate(async () => {
  const api = window.inkbloom;
  const { ctx, game } = api;
  if (ctx.state.id !== 'infection-fix-1127') throw Error('Unexpected world');
  game.loop.stop();
  const { enemyIndex } = await import('/src/content/enemies.ts');
  const p = ctx.player.position;
  const sys = game.loop.systems.find(s => s.id === 'infection');
  const site = { scene: {kind:'wild'}, x:p.x, y:ctx.wilderness.heightAt(p.x,p.z-10), z:p.z-10 };
  ctx.apply({kind:'infectNpc',person:'resident:qa1127',site});
  ctx.state.inkAreas.set('wild:qa1127',site);
  const group = game.scenes.wild.monsters.group;
  for (const [i,key] of ['blot','spitter','rat','frog','weasel'].entries()) {
    const x=p.x+(i-2)*3.5, z=p.z-18;
    group.spawn(enemyIndex(key), p.clone().set(x,ctx.wilderness.heightAt(x,z)+0.05,z), {tag:'qa-night',key:'qa-night-'+key});
  }
  api.look(0, -0.05);
  ctx.state.calendarOffset=180-ctx.state.clock;
  api.step(36);
  window.inkQA={sys,group,site,enemy:sys.group.monsters.find(m=>m.key==='resident:qa1127'),read(){
    return { hour:ctx.renderer.atmosphere.hour, shaderAreas:ctx.renderer.post.uniforms.uInkAreaCount.value,
      infected:this.sys.group.monsters.map(m=>({key:m.key,hp:m.hp,dead:m.dead})),
      ordinary:this.group.monsters.filter(m=>m.tag==='qa-night').map(m=>({key:m.key,hp:m.hp,dead:m.dead,pose:!!m.pose})),
      infectedDraw:Object.values(this.sys.group.figures.figures.meshes).map(m=>({count:m.count,visible:m.visible})) };
  }};
  return window.inkQA.read();
}));
console.log({shot:await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/ink-monster-diagnosis/day.png'})});
