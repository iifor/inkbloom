const entry=(await listTaskSpaces()).find(s=>s.id===5);
const task=!entry?await taskSpace('InkBloom loading music'):entry.ownership==='user'?await claimTaskSpace(5):entry.ownership==='agentDelegatedToUser'?await takeOverTaskSpace(5):await taskSpace(5);
const page=(await task.pages())[0]??await task.adopt((await task.tabs())[0].page);
console.log({space:task.spaceId,page:page.label});
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:"window.loadingAudio=[];const NativeAudio=window.Audio;window.Audio=function(...args){const audio=new NativeAudio(...args);window.loadingAudio.push(audio);return audio;};window.Audio.prototype=NativeAudio.prototype;"});
await page.goto('http://127.0.0.1:5193/artifacts/loading-qa/preview.html',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.startupQA?.ready&&window.loadingAudio?.length,undefined,{timeout:15000});
console.log(await page.evaluate(()=>({audio:window.loadingAudio.map(a=>({src:a.src,paused:a.paused,duration:a.duration,volume:a.volume,loop:a.loop,error:a.error?.message})),button:document.querySelector('#startup-sound').textContent})));
console.log(await page.snapshot());
