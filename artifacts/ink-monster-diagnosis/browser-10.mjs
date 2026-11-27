const task = await taskSpace(2);
const page = task.page('p1');
const fs = await import('node:fs/promises');
for (const [name,hour] of [['day',12],['sunset',18],['night',23],['sunrise',6]]) {
  const result = await page.evaluate(({hour}) => {
    const api=window.inkbloom;
    if (!window.inkQA) return {missing:true};
    api.game.loop.stop();
    api.ctx.state.calendarOffset=((hour-9+24)%24)*60-api.ctx.state.clock;
    api.step(6);
    const state=window.inkQA.read();
    state.sameInfected=window.inkQA.enemy===window.inkQA.sys.group.monsters.find(m=>m.key==='resident:qa1127');
    api.ctx.renderer.render(api.ctx.player.position);
    return {state,png:api.ctx.renderer.renderer.domElement.toDataURL('image/png')};
  },{hour});
  if(result.missing) {console.log(result);break;}
  await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/ink-monster-diagnosis/'+name+'.png',Buffer.from(result.png.split(',')[1],'base64'));
  console.log({name,...result.state});
}
