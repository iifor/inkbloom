const t=await taskSpace(16);
for(const id of ['p1','p2']) {
 const p=t.page(id);await p.waitForSelector("loc=role:button[name='加入']");await p.click("loc=role:button[name='加入']");
 await p.waitForSelector("loc=role:button[name*='开始：']",{timeout:60000});await p.click("loc=role:button[name*='开始：']");console.log(await p.snapshot());
}
