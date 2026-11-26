const task = await takeOverTaskSpace(11);
const tabs = await task.tabs();
const user = task.userPage();
const existing = (await task.pages()).find(p => tabs.some(t => t.active && t.label === p.label));
const page = existing ?? await task.adopt(user);
console.log({ spaceId: task.spaceId, page: page.label });
console.log(await page.snapshot({ scope: 'full_page' }));
