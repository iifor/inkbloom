const task=await taskSpace(11); const page=task.page('p1');
console.log(await page.snapshot({scope:'full_page'}));
console.log(await page.evaluate(()=>Array.from(document.querySelectorAll('*')).filter(e=>e.scrollHeight>e.clientHeight+100&&getComputedStyle(e).overflowY.match(/auto|scroll/)).map(e=>({tag:e.tagName,class:e.className,height:e.clientHeight,total:e.scrollHeight}))));
