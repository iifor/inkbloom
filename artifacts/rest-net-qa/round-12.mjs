const t=await taskSpace(12),actor=t.page('p1'),observer=t.page('p2');
await actor.keyboard.down('w');
console.log(await actor.evaluate(()=>{window.inkbloom.step(3);return {transition:window.inkbloom.ctx.player.restMotion};}));
await actor.keyboard.up('w');
console.log(await actor.evaluate(()=>{window.inkbloom.step(45);return {standing:!window.inkbloom.ctx.player.restMotion};}));
await observer.waitForFunction(()=>{window.inkbloom.step(1);return [...window.inkbloom.ctx.net.remote.players.values()].some(r=>r.drawn&&!r.samples.at(-1)?.m.rest);},undefined,{timeout:10000});
console.log(await observer.evaluate(()=>{const a=window.inkbloom;a.step(10);return [...a.ctx.net.remote.players.values()].filter(r=>r.drawn).map(r=>({rest:r.samples.at(-1)?.m.rest??null,grounded:r.samples.at(-1)?.m.f,position:r.at}));}));
