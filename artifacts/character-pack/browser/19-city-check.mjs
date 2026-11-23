const task=await taskSpace(14),page=task.page('p1');
await page.click('[data-a="player-preview"]');
await page.click('[data-a="back"]');
console.log(await page.evaluate(()=>window.inkbloom.enterNearestCity()));
await page.waitForFunction(()=>window.inkbloom.ctx.scenes.currentCity?.residents?.villagers.length>=5,undefined,{timeout:60000});
console.log(await page.evaluate(()=>{const city=window.inkbloom.ctx.scenes.currentCity;return {name:city.layout.name,count:city.residents.villagers.length,roles:city.residents.villagers.slice(0,5).map(a=>a.root.userData),positions:city.residents.villagers.slice(0,5).map(a=>a.root.position.toArray())};}));
const data=await page.evaluate(()=>{const ctx=window.inkbloom.ctx,r=ctx.renderer,a=ctx.scenes.currentCity.residents.villagers.find(a=>a.root.userData.variant==='rogue');r.camera.children.forEach(c=>c.visible=false);r.setFov(52);r.atmosphere.hour=10;const p=a.root.position,yaw=a.root.rotation.y;r.camera.position.set(p.x+Math.sin(yaw)*3.2,p.y+1.5,p.z+Math.cos(yaw)*3.2);r.camera.lookAt(p.x,p.y+.85,p.z);r.camera.updateMatrixWorld(true);a.root.visible=true;r.render();return r.renderer.domElement.toDataURL('image/png');});
const fs=await import('node:fs/promises');await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/character-pack/live-villager-painted.png',Buffer.from(data.split(',')[1],'base64'));
console.log(await page.snapshot());
