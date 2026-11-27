const task=await taskSpace(3),page=task.page('p1');
console.log(await page.evaluate(()=>{
 const meshes=[];inkbloom.ctx.renderer.scene.traverse(o=>{if(o.isSkinnedMesh&&meshes.length<8)meshes.push({name:o.name,indices:o.geometry.index?.array.constructor.name,bones:o.skeleton.bones.length,attributes:Object.fromEntries(Object.entries(o.geometry.attributes).map(([k,a])=>[k,{type:a.array?.constructor.name,size:a.itemSize,normalized:a.normalized,interleaved:!!a.isInterleavedBufferAttribute,stride:a.data?.stride,offset:a.offset}]))});});return meshes;
}));
