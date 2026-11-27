const task=await taskSpace(20);
const page=task.page('p1');
console.log(await page.evaluate(async()=>{
  const {GrassField}=await import('/src/systems/wilderness/grass.ts');
  const update=GrassField.prototype.update;
  GrassField.prototype.update=function(...args){window.debugGrass=this;return update.apply(this,args);};
  const {DistantTerrain}=await import('/src/systems/wilderness/distant-terrain.ts');
  const landscape=DistantTerrain.prototype.update;
  DistantTerrain.prototype.update=function(...args){window.debugLandscape=this;return landscape.apply(this,args);};
  await new Promise(r=>setTimeout(r,1000));
  return {ready:!!window.inkbloom,grass:window.debugGrass&&{ready:debugGrass.ready,pending:debugGrass.grids.map(g=>g.pending.length)},landscape:window.debugLandscape&&{ready:debugLandscape.startupReady,built:debugLandscape.built.size}};
}));
console.log(await page.snapshot());
