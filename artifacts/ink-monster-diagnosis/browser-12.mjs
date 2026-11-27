const task=await taskSpace(2);
const page=task.page('p1');
console.log(await page.evaluate(() => {
  const api=window.inkbloom,{ctx,game}=api,qa=window.inkQA;
  game.loop.stop();
  const m=qa.border.enemy;
  const target=m.body.pos.clone(); target.y+=m.def.height*0.55;
  game.belt.select(1);
  const dx=target.x-ctx.player.position.x,dz=target.z-ctx.player.position.z;
  api.look(Math.atan2(-dx,-dz),Math.atan2(ctx.player.eye.y-target.y,Math.hypot(dx,dz)));
  api.step(3);
  return { hp:m.hp, target:target.toArray(),eye:ctx.player.eye.toArray(),forward:ctx.player.forward.toArray(),weapon:game.belt.active.id,
    wall:ctx.scenes.active.physics.raycast(ctx.player.eye,ctx.player.forward,30), groupHit:qa.sys.group.raycast(ctx.player.eye,ctx.player.forward,30) };
}));
