const task = await taskSpace(2);
const page = task.page('p1');
// This test surface receives no animation frames. Drive its callbacks with timers,
// then use the game's deterministic step API for the regression checks.
await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.requestAnimationFrame = cb => window.setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = id => window.clearTimeout(id);
` });
await page.reload();
console.log(await page.snapshot());
