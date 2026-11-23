const task=await taskSpace(14),page=task.page('p1');
await page.waitForFunction(()=>!!window.inkbloom&&!!document.querySelector('[data-char="mason"]'),undefined,{timeout:60000});
await page.click('[data-char="mason"]');
await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent==='动作预览');
await page.waitForFunction(()=>{const group=window.inkbloom.ctx.renderer.scene.getObjectByName('third-person-motion-preview');return group?.children.some(c=>c.visible&&!!c.getObjectByName('KayKitPlayerRig'));});
const fs=await import('node:fs/promises');
const data=await page.evaluate(()=>{const r=window.inkbloom.ctx.renderer;r.atmosphere.hour=10;r.render();return r.renderer.domElement.toDataURL('image/png');});
await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/character-pack/mason-painted.png',Buffer.from(data.split(',')[1],'base64'));
console.log(await page.snapshot());
