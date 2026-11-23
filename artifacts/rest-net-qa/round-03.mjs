const task = await taskSpace(12);
for (const id of ['p1', 'p2']) {
  const p = task.page(id);
  await p.click("loc=role:button[name='加入']");
  await p.waitForFunction(() => !!window.inkbloom, undefined, {timeout:60000});
  console.log(await p.snapshot());
}
