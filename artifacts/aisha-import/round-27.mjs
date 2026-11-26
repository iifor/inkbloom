const task=await taskSpace(11);const page=task.page('p2');
await page.goto('http://127.0.0.1:5192/artifacts/aisha-import/playback.html',{waitUntil:'domcontentloaded'});
await page.click('#run');
await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('"pass"'),undefined,{timeout:20000});
const result=await page.evaluate(()=>document.querySelector('#result').textContent);console.log(result);
const fs=await import('node:fs/promises');await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/aisha-import/playback-result.json',result);
