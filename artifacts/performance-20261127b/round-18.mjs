const task=await taskSpace(3),page=task.page('p1');
await page.evaluate(()=>{const api=window.inkbloom;if(api){api.game.dispose();api.ctx.renderer.renderer.forceContextLoss();}});
await task.finish({keep:[]});
