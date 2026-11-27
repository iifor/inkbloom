const task=await taskSpace(4),page=task.page('p1');
const {flightCheck}=await import('./flight-check.mjs');
await flightCheck(page,{name:'verified60-fixed-a',fixedBuffer:true});
await flightCheck(page,{name:'verified60-fixed-b',fixedBuffer:true,queries:true});
console.log('profileLoop',await page.evaluate(async()=>{const result=await inkbloom.profile(2);return {result,running:inkbloom.game.loop.isRunning};}));
await flightCheck(page,{name:'verified60-default'});
