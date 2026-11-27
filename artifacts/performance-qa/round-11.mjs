const task=await taskSpace(20);
const page=task.page('p1');
// The automation pane suppresses animation frames between commands. Drive startup at 60 Hz;
// route timings below are explicit CPU steps, not a claim about displayed FPS.
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16);
  window.cancelAnimationFrame = id => clearTimeout(id);
`});
await page.reload();
await page.waitForFunction(()=>!!window.inkbloom,undefined,{timeout:60000});
console.log(await page.snapshot());
