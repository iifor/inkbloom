const t=await claimTaskSpace(14),p=await t.adopt((await t.tabs())[0].page),fs=await import('node:fs/promises');
console.log(p.label,await p.snapshot());
await p.reload();
await p.waitForSelector('[data-char="courier"]',{timeout:90000});
const looks=await p.evaluate(()=>Array.from(document.querySelectorAll('[data-char]'),b=>[b.dataset.char,b.querySelector('strong')?.textContent||b.textContent.slice(0,4)]));
const frames=[];
async function frame(label){
  const url=await p.evaluate(async()=>{
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    const r=window.inkbloom.ctx.renderer;r.atmosphere.hour=10;r.render();
    const src=r.renderer.domElement,c=document.createElement('canvas');c.width=280;c.height=310;
    const w=Math.min(src.width,src.height*.91);c.getContext('2d').drawImage(src,(src.width-w)/2,0,w,src.height,0,0,280,310);
    return c.toDataURL();
  });
  frames.push([label,url]);
}
for(const [key,label] of looks){
  await p.evaluate(key=>document.querySelector('[data-char="'+key+'"]').click(),key);
  await p.waitForFunction(()=>document.querySelector('[data-status]')?.textContent==='动作预览');
  await frame(label);
}
await p.click('[data-a="villager-preview"]');
for(const key of ['rogue','mage','barbarian','knight','rogue-hooded']){
 await p.click('[data-villager="'+key+'"]');
 await p.waitForFunction(()=>document.querySelector('[data-status]')?.textContent==='村民原版动作');
 await frame(key);
}
const url=await p.evaluate(async frames=>{
 const c=document.createElement('canvas');c.width=280*4;c.height=Math.ceil(frames.length/4)*344;
 const ctx=c.getContext('2d');ctx.fillStyle='#f4eddc';ctx.fillRect(0,0,c.width,c.height);ctx.font='20px sans-serif';
 for(const [i,[label,url]] of frames.entries()){
   const img=new Image();img.src=url;await img.decode();const x=(i%4)*280,y=Math.floor(i/4)*344;
   ctx.drawImage(img,x,y);ctx.fillStyle='#392e27';ctx.fillText(label,x+8,y+334);
 }return c.toDataURL();
},frames);
await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/character-pack/model-review.png',Buffer.from(url.split(',')[1],'base64'));
console.log(frames.map(f=>f[0]));
