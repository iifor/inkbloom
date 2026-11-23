const task = await taskSpace(2); const page = task.page('p1');
await page.click('@2');
console.log(await page.evaluate(async () => {
  const api = window.inkbloom; const {ctx, game} = api;
  game.loop.stop();
  const {travelAltar, hasTravelAltar} = await import('/src/world/city/travel-altar.ts');
  const entries = ctx.wilderness.entrancesNear(0,0,2).filter(e => hasTravelAltar(e.seed,e.chunks));
  const found=[];
  for (const e of entries) {
    const l=ctx.cities.layout(e); const at=travelAltar(l);
    if(at) found.push({e,at,name:l.name});
    if(found.length===2)break;
  }
  window.altarQA=found;
  return {found, clock:ctx.state.clock, input:typeof ctx.input.setHeld, renderer:Object.keys(ctx.renderer)};
}));
