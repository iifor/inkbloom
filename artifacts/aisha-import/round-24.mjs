const task=await taskSpace(11);const page=task.page('p2');
console.log(await page.evaluate(()=>({text:document.body.innerText.slice(0,1300),menus:[...document.querySelectorAll('[role="menu"],[role="listbox"]')].map(e=>e.innerText),buttons:[...document.querySelectorAll('button')].map(b=>b.innerText).filter(t=>/Free|Offer|Sort|All lib/i.test(t))})));
await page.click('text="Sort: Newest First"');
console.log(await page.evaluate(()=>({text:document.body.innerText.slice(0,1600),menus:[...document.querySelectorAll('[role="menu"],[role="listbox"]')].map(e=>e.innerText)})));
