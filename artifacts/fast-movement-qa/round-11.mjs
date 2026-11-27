const task=await taskSpace(21),page=task.page('p1');
console.log(await page.evaluate(()=>{const w=inkbloom.game.scenes.wild;const item=w.loaded.get('15,1');if(item)w.unload('15,1',item);return {loaded:[...w.loaded.keys()],groups:[...w.physics.groups.keys()].slice(0,30)};}));
