const task=await taskSpace(3),page=task.page('p1');
console.log(await page.snapshot());
const result=await page.evaluate(()=>{
 const api=inkbloom,r=api.ctx.renderer;api.game.loop.stop();api.look(-Math.PI/2,-.35);api.step();r.render(api.ctx.player.position);
 return {image:r.renderer.domElement.toDataURL('image/png'),info:api.info(),renderer:r.renderer.getContext().getParameter(r.renderer.getContext().RENDERER),glError:r.renderer.getContext().getError(),landscape:api.game.scenes.wild.landscape.root.children.filter(o=>o.visible&&o.name==='landscape-batch').length};
});
const fs=await import('node:fs/promises');await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/performance-20261127b/flight-final.png',Buffer.from(result.image.split(',')[1],'base64'));
console.log({info:result.info,renderer:result.renderer,glError:result.glError,landscape:result.landscape});
