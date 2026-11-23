const task=await taskSpace(14),page=task.page('p1');
console.log(await page.snapshot());
console.log(await page.evaluate(()=>({selected:document.querySelector('.char.on')?.dataset.char,container:{height:document.querySelector('.chars').clientHeight,scroll:document.querySelector('.chars').scrollTop,total:document.querySelector('.chars').scrollHeight},bounds:[...document.querySelectorAll('[data-char]')].map(e=>({key:e.dataset.char,rect:JSON.stringify(e.getBoundingClientRect().toJSON())}))})));
