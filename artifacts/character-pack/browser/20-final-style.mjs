const task=await taskSpace(14), page=task.page('p1'), fs=await import('node:fs/promises');
async function capture(name){
 const data=await page.evaluate(async()=>{
  for(let i=0;i<20;i++) await new Promise(requestAnimationFrame);
  const r=window.inkbloom.ctx.renderer;r.atmosphere.hour=10;r.render();
  return r.renderer.domElement.toDataURL('image/png');
 });
 await fs.writeFile(`C:/Users/Administrator/Desktop/inkbloom/artifacts/character-pack/${name}.png`,Buffer.from(data.split(',')[1],'base64'));
}
await page.click('[data-a="back"]');
const data=await page.evaluate(()=>{
 const ctx=window.inkbloom.ctx,r=ctx.renderer,a=ctx.scenes.currentCity.residents.villagers.find(a=>a.root.userData.variant==='rogue');
 r.camera.children.forEach(c=>c.visible=false);r.setFov(52);r.atmosphere.hour=10;
 const p=a.root.position,yaw=a.root.rotation.y;
 r.camera.position.set(p.x+Math.sin(yaw)*3.2,p.y+1.5,p.z+Math.cos(yaw)*3.2);
 r.camera.lookAt(p.x,p.y+.85,p.z);r.camera.updateMatrixWorld(true);a.root.visible=true;r.render();
 return r.renderer.domElement.toDataURL('image/png');
});
await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/character-pack/final-world-villager.png',Buffer.from(data.split(',')[1],'base64'));
console.log(await page.evaluate(()=>({exitCity:typeof window.inkbloom.exitCity})));
await page.evaluate(()=>window.inkbloom.exitCity());
await page.reload();
await page.waitForFunction(()=>!!window.inkbloom&&!!document.querySelector('[data-char="courier"]'),undefined,{timeout:60000});
await capture('final-style-courier');
await page.click('[data-char="apprentice"]');
await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent==='动作预览');
await capture('final-style-apprentice');
await page.click('[data-motion="shoot"]');await capture('final-style-third-rifle');
await page.click('[data-perspective="first"]');await capture('final-style-first-rifle');
await page.click('[data-motion="swim"]');await capture('final-style-first-swim');
await page.click('[data-perspective="third"]');await page.click('[data-motion="idle"]');
console.log(await page.evaluate(()=>{let ready=0,total=0,width=0;window.inkbloom.ctx.renderer.scene.traverse(o=>{const u=o.material?.uniforms;if(u?.uCharacterPaintReady){total++;ready+=u.uCharacterPaintReady.value;for(const v of Object.values(u))if(v.value?.image?.width===1254)width=1254;}});return {total,ready,width};}));
console.log(await page.snapshot());
