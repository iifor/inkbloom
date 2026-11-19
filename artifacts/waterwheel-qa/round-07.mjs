const task=await taskSpace(22);const page=task.page('p1');
const data=await page.evaluate(()=>{
 const a=window.inkbloom;
 a.ctx.renderer.render();
 return a.ctx.renderer.renderer.domElement.toDataURL('image/png');
});
const fs=await import('node:fs/promises');
const path='C:/Users/Administrator/Desktop/inkbloom/artifacts/waterwheel-qa/waterwheel-preview.png';
await fs.writeFile(path,Buffer.from(data.split(',')[1],'base64'));
console.log({path,bytes:Math.floor(data.length*.75)});
