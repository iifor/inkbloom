const task=await taskSpace(22);const page=task.page('p1');
console.log(await page.evaluate(()=>{
 const api=window.inkbloom; api.game.loop.stop();
 const scene=api.game.scenes.currentCity;
 const rotor=scene?.root.getObjectByName('waterwheel:rotor'),support=scene?.root.getObjectByName('waterwheel:fixed-support');
 return {info:api.info(),rotor:rotor?.rotation.x,support:support?.matrix.toArray(),before:window.millQA?.initial,fatal:document.body.textContent.includes('出错了')};
}));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/waterwheel-qa/in-game-02.png'}));
