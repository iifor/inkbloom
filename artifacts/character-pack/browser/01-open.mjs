const entry=(await listTaskSpaces()).find(s=>s.id===15);
const task=!entry?await taskSpace('重彩 · 全角色与村民'):entry.ownership==='user'?await claimTaskSpace(15):await taskSpace(15);
const tab=(await task.tabs()).find(t=>t.url.includes('127.0.0.1:5190'));
const page=tab?(tab.label?task.page(tab.label):await task.adopt(tab.page)):task.page('p1');
await page.goto('http://127.0.0.1:5190/?preview=courier&world=modular-b-preview&seed=173');
await page.waitForFunction(()=>!!window.inkbloom && !!document.querySelector('[data-char="worker"]'));
console.log({space:task.spaceId,page:page.label});
console.log(await page.snapshot());
