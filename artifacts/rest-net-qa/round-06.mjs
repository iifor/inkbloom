const task=await taskSpace(12), observer=task.page('p2');
console.log(await observer.evaluate(()=>{
 const a=window.inkbloom; a.teleport(42.4,36.8); a.look(Math.atan2(2.4,-3.2),-.17); a.step(15);
 return [...a.ctx.net.remote.players.values()].map(r=>({drawn:r.drawn, rest:r.samples.at(-1)?.m.rest}));
}));
console.log(await observer.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/rest-net-qa/sitting.png'}));
