const task=await taskSpace(22);const page=task.page('p1');
const data=await page.evaluate(()=>{
 const a=window.inkbloom;
 a.ctx.renderer.renderer.setPixelRatio(1);
 a.ctx.renderer.renderer.setSize(1280,720,false);
 a.ctx.renderer.camera.aspect=1280/720;
 a.ctx.renderer.camera.updateProjectionMatrix();
 a.ctx.renderer.render();
 return a.ctx.renderer.renderer.domElement.toDataURL('image/png');
});
const fs=await import('node:fs/promises');
const path='C:/Users/Administrator/Desktop/inkbloom/artifacts/waterwheel-qa/waterwheel-small.png';
await fs.writeFile(path,Buffer.from(data.split(',')[1],'base64'));
console.log(path);
