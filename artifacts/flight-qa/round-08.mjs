const task = await taskSpace(6);
const page = task.page('p1');
console.log(await page.snapshot());
console.log(await page.evaluate(() => ({ready:!!window.inkbloom, loop:window.inkbloom ? Object.keys(window.inkbloom.game.loop) : []})));
