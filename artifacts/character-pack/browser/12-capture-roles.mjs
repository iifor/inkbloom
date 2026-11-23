const task=await taskSpace(14),page=task.page('p1');
await page.waitForFunction(()=>!!document.querySelector('[data-char="mason"]'),undefined,{timeout:30000});
const fs=await import('node:fs/promises');
for(const key of ['mason','apprentice','ranger','boatman','gardener']) {
 await page.evaluate(key=>document.querySelector(`[data-char="${key}"]`).click(),key);
 await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent==='动作预览');
 const data=await page.evaluate(async()=>{for(let i=0;i<35;i++)await new Promise(requestAnimationFrame);const r=window.inkbloom.ctx.renderer;r.atmosphere.hour=10;r.render();return r.renderer.domElement.toDataURL('image/png');});
 await fs.writeFile(`C:/Users/Administrator/Desktop/inkbloom/artifacts/character-pack/role-${key}.png`,Buffer.from(data.split(',')[1],'base64'));
}
await page.click('[data-perspective="first"]');
await page.click('[data-motion="shoot"]');
const data=await page.evaluate(async()=>{for(let i=0;i<30;i++)await new Promise(requestAnimationFrame);const r=window.inkbloom.ctx.renderer;r.atmosphere.hour=10;r.render();return r.renderer.domElement.toDataURL('image/png');});
await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/character-pack/role-rifle-before.png',Buffer.from(data.split(',')[1],'base64'));
console.log(await page.snapshot());
