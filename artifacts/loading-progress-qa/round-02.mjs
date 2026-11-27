const task = await taskSpace(5);
const page = task.page('p1');
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelector('#startup')?.hidden,undefined,{timeout:45000}).catch(e=>console.log(e.message));
const result = await page.evaluate(()=>({trace:loadingTrace,errors:loadingErrors,hidden:document.querySelector('#startup').hidden,error:document.querySelector('#overlay-error').textContent,menu:document.querySelector('#overlay').innerText,dev:!!window.inkbloom}));
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/loading-progress-qa/async-boot.json',JSON.stringify(result,null,2));
console.log({...result,trace:result.trace.filter((x,i,a)=>i===0||i===a.length-1||a[i-1].label!==x.label)});
