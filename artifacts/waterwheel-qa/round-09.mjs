const task=await taskSpace(22);const page=task.page('p1');
const data=await page.evaluate(()=>{
 const a=window.inkbloom, q=window.millQA, r=a.ctx.renderer;
 r.camera.position.set(q.wheel.x+8,q.wheel.y+4,q.wheel.z+5);
 r.camera.lookAt(q.wheel.x,q.wheel.y+0.1,q.wheel.z);
 for(const child of r.camera.children)child.visible=false;
 r.render();
 return r.renderer.domElement.toDataURL('image/png');
});
const fs=await import('node:fs/promises');
const path='C:/Users/Administrator/Desktop/inkbloom/artifacts/waterwheel-qa/waterwheel-close.png';
await fs.writeFile(path,Buffer.from(data.split(',')[1],'base64'));
console.log(path);
