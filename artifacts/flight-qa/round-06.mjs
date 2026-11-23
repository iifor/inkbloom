const task = await taskSpace(6);
const page = task.page('p1');
const data = await page.evaluate(() => {
  window.inkbloom.ctx.renderer.render();
  return document.querySelector('#view').toDataURL('image/png');
});
const fs = await import('node:fs/promises');
await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/flight-qa/pilot-01.png',Buffer.from(data.split(',')[1],'base64'));
console.log('Saved pilot-01.png');
