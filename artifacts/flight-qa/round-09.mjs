const task = await taskSpace(6);
const page = task.page('p1');
await page.click('@11');
await page.evaluate(() => {
  const a=window.inkbloom; a.game.loop.stop();
  a.fly(false);a.step(1);
  a.teleport(64,64,20);a.look(0,-0.42);
});
await page.keyboard.press('F2');
console.log(await page.evaluate(() => {
  const a=window.inkbloom; a.step(35);
  return {flying:a.ctx.player.flying,error:document.querySelector('#overlay-error')?.textContent};
}));
const fs=await import('node:fs/promises');
let data=await page.evaluate(() => {
  const a=window.inkbloom;a.ctx.renderer.render();
  return document.querySelector('#view').toDataURL('image/png');
});
await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/flight-qa/pilot-02.png',Buffer.from(data.split(',')[1],'base64'));
data=await page.evaluate(async () => {
  const a=window.inkbloom;
  const {RemotePlayers}=await import('/src/systems/net/remote-players.ts');
  const {defaultLook}=await import('/src/content/characters.ts');
  const {FLYING}=await import('/src/world/net/protocol.ts');
  const remote=new RemotePlayers(a.ctx,document.createElement('div'));
  remote.add({id:998,name:'纸飞机试飞员',look:defaultLook('courier')});
  remote.push(998,{p:[64,20,54],v:[0,0,-12],yaw:-0.4,pitch:0,f:FLYING,h:'rifle'});
  for(let i=0;i<40;i++)remote.update(1/60);
  window.flightQA={remote};
  a.ctx.renderer.scene.getObjectByName('paper-plane-pilot').visible=false;
  const cam=a.ctx.renderer.camera;
  cam.fov=55;cam.updateProjectionMatrix();
  cam.position.set(69,23.4,59);
  cam.lookAt(64,20.9,54);
  a.ctx.renderer.render();
  return document.querySelector('#view').toDataURL('image/png');
});
await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/flight-qa/observer-02.png',Buffer.from(data.split(',')[1],'base64'));
console.log('Saved pilot-02 and observer-02');
