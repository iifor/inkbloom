const task = await taskSpace(6);
const page = task.page('p1');
await page.click('@2');
console.log(await page.evaluate(() => {
  const a = window.inkbloom;
  a.game.loop.stop();
  const p = a.ctx.player.position;
  a.teleport(p.x,p.z,p.y+15);
  a.look(0,-0.42);
  return a.info();
}));
await page.keyboard.press('F2');
console.log(await page.evaluate(() => {
  const a=window.inkbloom;
  a.step(35);
  return { flying:a.ctx.player.flying, plane:!!a.ctx.renderer.scene.getObjectByName('paper-plane-vehicles'), error:document.querySelector('#overlay-error')?.textContent };
}));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/flight-qa/pilot-01.png'}));
