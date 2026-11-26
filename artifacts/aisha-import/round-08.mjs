const task = await taskSpace(11);
const page = task.page('p1');
await page.fill('input[aria-label="Maximum price"]', '0');
await page.press('input[aria-label="Maximum price"]', 'Escape');
console.log(await page.evaluate(() => ({ buttons: Array.from(document.querySelectorAll('button')).filter(b => b.getBoundingClientRect().width).map(b => ({text:b.innerText,aria:b.getAttribute('aria-label')})).filter(b => /close|apply|search|filter/i.test(b.text+' '+b.aria)), url: location.href })));
console.log(await page.snapshot());
