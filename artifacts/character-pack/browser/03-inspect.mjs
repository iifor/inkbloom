const task=await taskSpace(14),page=task.page('p1');
console.log(await page.snapshot());
console.log(await page.evaluate(()=>({ready:!!window.inkbloom,buttons:document.querySelectorAll('[data-char]').length,errors:document.querySelector('vite-error-overlay')?.shadowRoot?.textContent?.slice(-2500)})));
