const old = (await listTaskSpaces()).find(s => s.id === 10);
const task = !old ? await taskSpace('InkBloom AiSHA sound import') : old.ownership === 'user' ? await claimTaskSpace(10) : await taskSpace(10);
const page = (await task.pages())[0] ?? await task.adopt((await task.tabs())[0].page);
await page.goto('https://aishasound.com/public-libraries/126-countryside-samples', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.body.innerText.includes('Library info') && !document.body.innerText.includes('Loading page'), undefined, { timeout: 15000 });
console.log({ taskSpaceId: task.spaceId });
console.log(await page.snapshot({ scope: 'full_page' }));
