const task=await taskSpace(11); const page=task.page('p1');
const rows=new Map();
for(let i=0;i<45;i++) {
 const state=await page.evaluate(()=>{const m=document.querySelector('main'); const rows=[...document.querySelectorAll('tr')].map(r=>r.innerText.trim()).filter(Boolean); const end=m.scrollTop+m.clientHeight>=m.scrollHeight-10;m.scrollTop+=900;return {rows,end,height:m.scrollHeight,top:m.scrollTop};});
 state.rows.forEach(r=>rows.set(r,r));
 if(state.end)break;
 await page.waitForTimeout(180);
}
console.log([...rows.values()]);
const fs=await import('node:fs/promises');
await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/aisha-import/some-of-many-list.json',JSON.stringify([...rows.values()],null,2));
console.log(await page.evaluate(()=>({top:document.querySelector('main').scrollTop,height:document.querySelector('main').scrollHeight,text:document.body.innerText.slice(0,1500)})));
