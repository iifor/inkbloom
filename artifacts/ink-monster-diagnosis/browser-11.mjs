const task = await taskSpace(2);
const page = task.page('p1');
console.log(await page.evaluate(() => {
  const api=window.inkbloom,{ctx,game}=api;
  game.loop.stop();
  const e=ctx.wilderness.entranceInCell(0,0);
  const layout=ctx.cities.layout(e);
  const gate=layout.gates.find(g=>g.main)??layout.gates[0];
  const x=layout.ox+(gate.ix+0.5)*layout.cell;
  const z=layout.oz+(gate.iz+0.5)*layout.cell;
  const [dx,dz]=[[1,0],[0,1],[-1,0],[0,-1]][gate.dir];
  const site={scene:{kind:'wild'},x:x-dx*6,z:z-dz*6,y:ctx.wilderness.heightAt(x-dx*6,z-dz*6)+0.05};
  api.fly(true);
  game.scenes.enterWild({pos:ctx.player.position.clone().set(site.x,site.y+3,site.z),yaw:0});
  ctx.apply({kind:'infectNpc',person:'resident:borderqa',site});
  ctx.state.inkAreas.set('wild:borderqa',site);
  ctx.state.calendarOffset=180-ctx.state.clock;
  api.step(30);
  const sys=game.loop.systems.find(s=>s.id==='infection');
  const enemy=sys.group.monsters.find(m=>m.key==='resident:borderqa');
  enemy.foe.damage(10,ctx.player.position);
  const results=[];
  for(const sign of [1,-1,1,-1]) {
    game.scenes.enterWild({pos:ctx.player.position.clone().set(x+dx*6*sign,site.y+3,z+dz*6*sign),yaw:0});
    api.step(3);
    const current=sys.group.monsters.find(m=>m.key==='resident:borderqa'&&!m.dead);
    results.push({scene:ctx.scenes.active.ref, sameMonster:current===enemy,hp:current?.hp,shaderAreas:ctx.renderer.post.uniforms.uInkAreaCount.value});
  }
  window.inkQA.border={enemy,site,x,z,dx,dz};
  return {town:layout.name,gate,results,weapons:ctx.state.inventory.weapons};
}));
