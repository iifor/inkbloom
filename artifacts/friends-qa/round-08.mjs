const task = await taskSpace(10);
const page = task.page('p1');
await page.click('@21', { label: 'Inspect final friends menu' });
console.log(await page.screenshot({ path: 'C:/Users/Administrator/Desktop/inkbloom/artifacts/friends-qa/menu-final.png' }));
await page.click('loc=role:button[name="取消定位"]', { label: 'Cancel friend tracking' });
await page.waitForFunction(() => !document.querySelector('.hud-friend')?.textContent);
console.log({ cancelled: true });
