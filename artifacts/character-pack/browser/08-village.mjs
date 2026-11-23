const task=await taskSpace(14),page=task.page('p1');
await page.waitForFunction(()=>!!window.inkbloom&&!!document.querySelector('[data-char="worker"]'),undefined,{timeout:60000});
await page.click('text="返回"');
console.log(await page.evaluate(()=>{window.__packQAStart={pos:window.inkbloom.ctx.player.position.clone(),yaw:window.inkbloom.ctx.player.yaw};return window.inkbloom.enterNearestCity();}));
await page.waitForFunction(()=>window.inkbloom.ctx.scenes.currentCity?.residents.villagers.size>0,undefined,{timeout:30000});
console.log(await page.evaluate(()=>{const city=window.inkbloom.ctx.scenes.currentCity;return {city:city.layout.name,requests:city.layout.requests.length,residents:[...city.residents.villagers].map(([i,a])=>({i,...a.root.userData,position:a.root.position.toArray()}))};}));
const fs=await import('node:fs/promises');
for(const variant of ['rogue','mage','barbarian','knight','rogue-hooded']) {
 const data=await page.evaluate(variant=>{
  const ctx=window.inkbloom.ctx,city=ctx.scenes.currentCity,r=ctx.renderer;
  const a=[...city.residents.villagers.values()].find(a=>a.root.userData.variant===variant);
  if(!a)return null;
  r.camera.children.forEach(c=>c.visible=false);
  r.setFov(52);r.atmosphere.hour=10;r.atmosphere.gloom=0;r.atmosphere.colour=1;
  const p=a.root.position,yaw=a.root.rotation.y;
  r.camera.position.set(p.x+Math.sin(yaw)*3.2,p.y+1.5,p.z+Math.cos(yaw)*3.2);
  r.camera.lookAt(p.x,p.y+.85,p.z);r.camera.updateMatrixWorld(true);
  a.update(.2,true);r.render();return r.renderer.domElement.toDataURL('image/png');
 },variant);
 if(data) await fs.writeFile(`C:/Users/Administrator/Desktop/inkbloom/artifacts/character-pack/villager-${variant}.png`,Buffer.from(data.split(',')[1],'base64'));
}
