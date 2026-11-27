const task=await taskSpace(5);
const page=task.page('p1');
console.log(await page.evaluate(()=>({held:window.qaCharacterHeld,release:typeof window.qaReleaseCharacter,hidden:document.querySelector('#startup').hidden,label:document.querySelector('#startup-status').textContent,target:document.querySelector('#startup').dataset.target,error:document.querySelector('#overlay-error').textContent,menu:document.querySelector('#overlay').innerText})));
console.log(await page.snapshot());
