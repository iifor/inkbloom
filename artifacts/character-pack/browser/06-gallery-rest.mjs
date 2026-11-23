const task=await taskSpace(14),page=task.page('p1');
const fs=await import('node:fs/promises');
for (const key of ['casual2','farmer','king','punk','spacesuit','suit','swat','worker']) {
 await page.evaluate(key=>document.querySelector(`[data-char="${key}"]`).click(),key);
 await page.evaluate(async key=>{const {loadCourier}=await import('/src/systems/figures/quaternius-courier.ts');await loadCourier(key);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},key);
 const data=await page.evaluate(()=>{const r=window.inkbloom.ctx.renderer;r.render();return r.renderer.domElement.toDataURL('image/png');});
 await fs.writeFile(`C:/Users/Administrator/Desktop/inkbloom/artifacts/character-pack/${key}.png`,Buffer.from(data.split(',')[1],'base64'));
}
await page.click('[data-perspective="first"]');
await page.click('[data-motion="shoot"]');
await page.waitForFunction(()=>{const r=window.inkbloom.ctx.renderer.scene.getObjectByName('first-person-motion-preview');return !!r?.children.find(c=>c.name==='courier-model-arms')?.children.some(c=>c.getObjectByName('Worker_Body'));});
console.log(await page.snapshot());
