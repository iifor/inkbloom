const task = await taskSpace(2);
const page = task.page('p1');
await page.cdp('Page.bringToFront');
await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
console.log(await page.evaluate(async () => {
  let frames = 0;
  const count = () => { if (++frames < 3) requestAnimationFrame(count); };
  requestAnimationFrame(count);
  await new Promise(resolve => setTimeout(resolve, 500));
  return { frames, dev: !!window.inkbloom, status: document.body.innerText.slice(-600) };
}));
