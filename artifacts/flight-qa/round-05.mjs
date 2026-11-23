const task = await taskSpace(6);
const page = task.page('p1');
console.log(await page.evaluate(() => ({ flying:window.inkbloom?.ctx.player.flying, ready:!!window.inkbloom, error:document.querySelector('#overlay-error')?.textContent })));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/flight-qa/pilot-01.png'}));
