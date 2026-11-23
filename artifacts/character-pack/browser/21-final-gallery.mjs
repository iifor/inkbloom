const task=await taskSpace(14),page=task.page('p1'),fs=await import('node:fs/promises');
async function capture(name){const data=await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const r=window.inkbloom.ctx.renderer;r.atmosphere.hour=10;r.render();return r.renderer.domElement.toDataURL('image/png');});await fs.writeFile(`C:/Users/Administrator/Desktop/inkbloom/artifacts/character-pack/${name}.png`,Buffer.from(data.split(',')[1],'base64'));}
await capture('final-style-courier');
await page.click('[data-char="apprentice"]');
await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent==='动作预览');
await capture('final-style-apprentice');
await page.click('[data-motion="shoot"]');await capture('final-style-third-rifle');
await page.click('[data-perspective="first"]');await capture('final-style-first-rifle');
await page.click('[data-motion="swim"]');await capture('final-style-first-swim');
await page.click('[data-perspective="third"]');await page.click('[data-motion="idle"]');
await page.cdp('Emulation.clearDeviceMetricsOverride');
console.log(await page.evaluate(()=>{let ready=0,total=0,width=0;window.inkbloom.ctx.renderer.scene.traverse(o=>{const u=o.material?.uniforms;if(u?.uCharacterPaintReady){total++;ready+=u.uCharacterPaintReady.value;for(const v of Object.values(u))if(v.value?.image?.width===1254)width=1254;}});return {total,ready,width};}));
console.log(await page.snapshot());
