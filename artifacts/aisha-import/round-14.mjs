const task=await taskSpace(11); const page=task.page('p1'); const fs=await import('node:fs/promises');
const dest='C:/Users/Administrator/Desktop/inkbloom/artifacts/aisha-import/some-of-many-list.json';
const rows=new Set(JSON.parse(await fs.readFile(dest,'utf8')));
for(let i=0,stale=0;i<50&&stale<4;i++) {
 const prev=rows.size;
 const state=await page.evaluate(()=>{const m=document.querySelector('main');const rows=[...document.querySelectorAll('tr')].map(r=>r.innerText.trim()).filter(Boolean);m.scrollTop+=750;return {rows,end:m.scrollTop+m.clientHeight>=m.scrollHeight-10};});
 state.rows.forEach(r=>rows.add(r));stale=state.end&&rows.size===prev?stale+1:0;
 await page.waitForTimeout(state.end?800:150);
}
await fs.writeFile(dest,JSON.stringify([...rows],null,2));console.log({total:rows.size,rows:[...rows].map(r=>r.split('\n')[0])});
console.log(await page.evaluate(()=>({top:document.querySelector('main').scrollTop,height:document.querySelector('main').scrollHeight,buttons:[...document.querySelectorAll('button')].map(b=>({text:b.innerText,aria:b.getAttribute('aria-label')})).filter(b=>b.text||!/collection|more|sound/.test(b.aria))})));
