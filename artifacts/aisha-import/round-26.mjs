const task=await taskSpace(11);const page=task.page('p2');
console.log(await page.evaluate(()=>({text:document.body.innerText.slice(0,6500),links:[...document.querySelectorAll('a[aria-label]')].filter(a=>a.getAttribute('aria-label')).map(a=>({text:a.getAttribute('aria-label'),url:a.href}))})));
const p1=task.page('p1');
console.log(await p1.evaluate(()=>[...document.querySelectorAll('tr')].map(r=>r.innerText.trim()).filter(Boolean)));
await p1.click('xpath=//tr[.//*[text()="dark sci-fi drone layer 115"]]//button[@aria-label="more"]');
console.log(await p1.snapshot());
