const task=await taskSpace(2);
const page=task.page('p1');
console.log(await page.evaluate(async () => {
  const api=window.inkbloom,{ctx,game}=api,qa=window.inkQA;
  const m=qa.border.enemy;
  game.loop.stop();
  const x=m.body.pos.x-6,z=m.body.pos.z+4;
  game.scenes.enterWild({pos:ctx.player.position.clone().set(x,ctx.wilderness.heightAt(x,z)+0.1,z),yaw:0});
  api.fly(false);
  api.step(3);
  let hits=0; const off=ctx.events.on('shot:hit',()=>hits++);
  const before=m.hp;
  ctx.input.setHeld('use',true);
  for(let i=0;i<100&&!m.dead;i++) {
    const dx=m.body.pos.x-ctx.player.position.x,dz=m.body.pos.z-ctx.player.position.z;
    api.look(Math.atan2(-dx,-dz),Math.atan2(m.body.pos.y+m.def.height*0.55-ctx.player.eye.y,Math.hypot(dx,dz)));
    api.step(1);
  }
  ctx.input.setHeld('use',false); off();
  api.step(12);
  await game.save.flush();
  return {before,after:m.hp,dead:m.dead,hits,saved:ctx.state.infectedPeople.get('resident:borderqa'), position:ctx.player.position.toArray()};
}));
