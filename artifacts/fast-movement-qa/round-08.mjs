const task=await taskSpace(21),page=task.page('p1');
const {profileRoute}=await import('./profile.mjs');
await profileRoute(page,'sprint-town-return',{x:1108,z:-1177.22,dx:0,dz:.9,frames:1500});
