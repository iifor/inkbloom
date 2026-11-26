const task=await taskSpace(11);const page=task.page('p2');const results={};
for(const query of ['rain','river','cicada','owl','frog','cuckoo','bird','thunder','leaves']){
 const old=await page.evaluate(()=>document.querySelector('tbody')?.innerText||'');
 await page.fill('input[name="sound-search"]',query);await page.click('button[aria-label="Search"]');
 await page.waitForURL('https://aishasound.com/?q='+query);
 await page.waitForFunction(old=>{const text=document.querySelector('tbody')?.innerText;return (text&&text!==old&&!document.body.innerText.includes('Loading sounds...'))||document.body.innerText.includes('No sounds found');},old,{timeout:25000});
 results[query]=await page.evaluate(()=>[...document.querySelectorAll('tr')].map(r=>({text:r.innerText.trim(),links:[...r.querySelectorAll('a')].map(a=>a.href)})).filter(r=>r.text).slice(0,8));
 console.log({query,rows:results[query].slice(0,4)});
}
const fs=await import('node:fs/promises');await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/aisha-import/search-shortlist.json',JSON.stringify(results,null,2));
