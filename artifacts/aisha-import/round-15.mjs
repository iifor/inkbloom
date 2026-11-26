const task=await taskSpace(11); const page=task.page('p1');
await page.evaluate(()=>document.querySelector('main').scrollTop=0);
const files=[['forest birds small stream','forest-birds-stream.wav'],['countryside birds insects 04','countryside-birds-insects.wav'],['contryside heavy wind','countryside-heavy-wind.wav'],['wind gust 27','wind-gust.wav'],['dark sci-fi drone layer 115','dark-drone.wav']];
for(const [title,name] of files){
 await page.evaluate(()=>document.querySelector('main').scrollTop=0);
 let found=false;
 for(let i=0;i<25;i++){
   found=await page.evaluate(t=>[...document.querySelectorAll('tr')].some(r=>r.innerText.split('\n').map(s=>s.trim()).includes(t)),title);
   if(found)break;
   await page.evaluate(()=>document.querySelector('main').scrollTop+=650);
   await page.waitForTimeout(150);
 }
 if(!found){console.log({title,error:'not found'});continue;}
 const downloadPromise=page.waitForEvent('download',{timeout:45000});
 await page.click(`xpath=//tr[.//*[text()="${title}"]]//button[@aria-label="Download sound"]`);
 const download=await downloadPromise;
 await download.saveAs('C:/Users/Administrator/Desktop/inkbloom/art/audio/aisha/source/'+name);
 console.log({title,filename:download.suggestedFilename(),saved:name});
}
