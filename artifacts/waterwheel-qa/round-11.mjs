const task=await taskSpace(22);const page=task.page('p1');
const data=await page.evaluate(()=>{
 const a=window.inkbloom, q=a.game.scenes.currentCity.layout.wheel, r=a.ctx.renderer;
 a.game.loop.stop();
 r.renderer.setPixelRatio(1);r.renderer.setSize(1280,720,false);
 r.camera.aspect=1280/720;r.camera.updateProjectionMatrix();
 r.camera.position.set(q.x+8,q.y+4,q.z+5);
 r.camera.lookAt(q.x,q.y+0.1,q.z);
 for(const child of r.camera.children)child.visible=false;
 r.render();
 return r.renderer.domElement.toDataURL('image/png');
});
const fs=await import('node:fs/promises');
const path='C:/Users/Administrator/Desktop/inkbloom/artifacts/waterwheel-qa/waterwheel-close.png';
await fs.writeFile(path,Buffer.from(data.split(',')[1],'base64'));
console.log(path);
