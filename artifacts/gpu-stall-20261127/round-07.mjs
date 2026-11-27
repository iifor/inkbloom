const task=await taskSpace(4),page=task.page('p1');
const {flightCheck}=await import('./flight-check.mjs');
await flightCheck(page,{name:'default60-queries',queries:true});
console.log('profileLoop',await page.evaluate(async()=>{const result=await inkbloom.profile(2);return {result,running:inkbloom.game.loop.isRunning};}));
await flightCheck(page,{name:'default60-repeat'});
await flightCheck(page,{name:'default120',hz:120});
