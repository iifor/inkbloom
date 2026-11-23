const task = await taskSpace(12);
for (const id of ['p1','p2']) console.log(await task.page(id).snapshot());
console.log(await task.page('p1').evaluate(() => {
  const a=window.inkbloom, p=a.ctx.player, original=p.position.clone();
  let found=null;
  for(let x=40;x<120&&!found;x+=3) for(let z=40;z<120&&!found;z+=3) {
    p.position.set(x,a.ctx.wilderness.heightAt(x,z)+0.04,z);
    if(p.canRest('lying')) found=p.position.toArray();
  }
  p.position.copy(original);
  return {found, info:a.info(), net:a.ctx.net.players};
}));
