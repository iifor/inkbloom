const t=await taskSpace('InkBloom relaxed resting poses');console.log({space:t.spaceId});
await t.page('p1').goto('http://localhost:5290/?server=127.0.0.1:5297');
const p=await t.newPage();await p.goto('http://127.0.0.1:5290/?server=127.0.0.1:5297');
console.log(await t.page('p1').snapshot());console.log(await p.snapshot());
