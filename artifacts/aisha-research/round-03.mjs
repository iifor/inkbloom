const task = await taskSpace(10);
const page = task.page('p1');
console.log(await page.evaluate(() => ({ url: location.href, packs: Array.from(document.querySelectorAll('a[aria-label][href*="/public-libraries/"]')).map(a => ({ name: a.getAttribute('aria-label'), url: a.href, info: a.parentElement.innerText })) })));
help('page.goto');
