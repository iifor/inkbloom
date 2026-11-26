const task = await taskSpace(10);
const page = task.page('p1');
for (const category of ['nature', 'weather', 'animals']) {
  await page.goto('https://aishasound.com/public-libraries/collection/' + category);
  console.log(category, await page.evaluate(() => Array.from(document.querySelectorAll('a[aria-label][href*="/public-libraries/"]')).map(a => ({ name: a.getAttribute('aria-label'), url: a.href, info: a.parentElement.innerText }))));
}
console.log(await page.snapshot());
