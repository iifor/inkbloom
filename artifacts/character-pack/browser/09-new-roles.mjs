const entry=(await listTaskSpaces()).find(s=>s.id===14);
const task=entry?.ownership==='user'?await claimTaskSpace(14):await taskSpace(14);
const page=(await task.pages())[0]??await task.adopt((await task.tabs())[0].page);
await page.goto('http://127.0.0.1:5190/?preview=mason&world=modular-b-preview&seed=173');
await page.waitForFunction(()=>!!window.inkbloom&&!!document.querySelector('[data-char="mason"]'),undefined,{timeout:60000});
console.log({space:task.spaceId,page:page.label});
console.log(await page.snapshot());
