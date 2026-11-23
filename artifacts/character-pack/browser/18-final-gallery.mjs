const task=await taskSpace(14),page=task.page('p1'),fs=await import('node:fs/promises');
// Reload once to invalidate the model template cache after the palette rebuild.
await page.reload();
await page.waitForFunction(()=>!!window.inkbloom&&!!document.querySelector('[data-char="courier"]'),undefined,{timeout:60000});
async function capture(name){const data=await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const r=window.inkbloom.ctx.renderer;r.atmosphere.hour=10;r.render();return r.renderer.domElement.toDataURL('image/png');});await fs.writeFile(`C:/Users/Administrator/Desktop/inkbloom/artifacts/character-pack/${name}.png`,Buffer.from(data.split(',')[1],'base64'));}
for(const key of ['courier','mason','apprentice','ranger','boatman','gardener']){
 await page.evaluate(key=>document.querySelector(`[data-char="${key}"]`).click(),key);
 await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent==='动作预览');
 await capture('accepted-'+key);
}
await page.click('[data-perspective="first"]');
for(const motion of ['brush','slash','shoot','swim']){
 await page.click(`[data-motion="${motion}"]`);await capture('accepted-first-'+motion);
}
await page.click('[data-a="villager-preview"]');
await page.click('[data-perspective="third"]');
for(const key of ['rogue','mage','barbarian','knight','rogue-hooded']){
 await page.click(`[data-villager="${key}"]`);
 await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent==='村民原版动作');
 await capture('accepted-villager-'+key);
}
await page.click('[data-perspective="first"]');
await page.click('[data-motion="walk"]');await capture('accepted-native-first-walk');
console.log(await page.evaluate(()=>{let meshes=0,ready=0;window.inkbloom.ctx.renderer.scene.traverse(o=>{if(o.material?.uniforms?.uCharacterPaintReady){meshes++;ready+=o.material.uniforms.uCharacterPaintReady.value;}});return{meshes,ready,atlasRequests:performance.getEntriesByType('resource').filter(e=>e.name.includes('painted-materials')).map(e=>({name:e.name,bytes:e.transferSize}))};}));
console.log(await page.snapshot());
