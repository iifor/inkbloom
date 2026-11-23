const task=await taskSpace(14),page=task.page('p1');
console.log(await page.snapshot());
console.log(await page.evaluate(()=>{
const root=window.inkbloom.ctx.renderer.scene.getObjectByName('first-person-motion-preview');const names=[];root?.traverse(o=>{if(o.isSkinnedMesh)names.push({name:o.name,visible:o.visible});});return {names};
}));
