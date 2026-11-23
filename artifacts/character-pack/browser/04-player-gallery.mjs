const task=await taskSpace(14),page=task.page('p1');
const fs=await import('node:fs/promises');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1200,height:800,deviceScaleFactor:1,mobile:false});
const keys=['courier','beach','casual','casual2','farmer','king','punk','spacesuit','suit','swat','worker'];
for (const key of keys) {
 await page.click(`[data-char="${key}"]`);
 await page.evaluate(async key=>{ const {loadCourier}=await import('/src/systems/figures/quaternius-courier.ts'); await loadCourier(key); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); },key);
 const data=await page.evaluate(()=>{const r=window.inkbloom.ctx.renderer;r.resize();r.render();return r.renderer.domElement.toDataURL('image/png');});
 await fs.writeFile(`C:/Users/Administrator/Desktop/inkbloom/artifacts/character-pack/${key}.png`,Buffer.from(data.split(',')[1],'base64'));
}
console.log({captured:keys});
console.log(await page.evaluate(()=>({keys:Object.keys(window.inkbloom),player:window.inkbloom.ctx.player.position,active:window.inkbloom.ctx.scenes.active.ref})));
