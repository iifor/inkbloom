const task=await taskSpace(6);
const page=task.page('p1');
await page.click('@20');
await page.evaluate(() => {
  const a=window.inkbloom;a.game.loop.stop();a.teleport(64,64,20);a.look(0,-0.3);
});
await page.keyboard.press('F2');
const fs=await import('node:fs/promises');
let data=await page.evaluate(() => {
  const a=window.inkbloom;a.step(35);a.ctx.renderer.render();
  return document.querySelector('#view').toDataURL('image/png');
});
await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/flight-qa/pilot-final.png',Buffer.from(data.split(',')[1],'base64'));
await page.keyboard.press('F2');
console.log(await page.evaluate(() => {
  const a=window.inkbloom;a.step(35);
  return {afterF2:a.ctx.player.flying,planeCount:a.ctx.renderer.scene.getObjectByName('paper-plane-vehicles')?.count,
    pilotVisible:a.ctx.renderer.scene.getObjectByName('paper-plane-pilot')?.visible,error:document.querySelector('#overlay-error')?.textContent};
}));
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
  const cam=a.ctx.renderer.camera;cam.fov=55;cam.updateProjectionMatrix();
  cam.position.set(69,23.4,59);cam.lookAt(64,20.9,54);
  a.ctx.renderer.render();
  return document.querySelector('#view').toDataURL('image/png');
});
await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/flight-qa/observer-final.png',Buffer.from(data.split(',')[1],'base64'));
console.log('Saved final game views');
