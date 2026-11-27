import fs from 'node:fs';
const trace=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).traceEvents;
const times=new Map();const stack=new Map();const done=[];
for(const e of trace){let event;if(e.ph==='X')event=e;else if(e.ph==='B'){const key=e.pid+','+e.tid;const s=stack.get(key)||[];s.push(e);stack.set(key,s);}else if(e.ph==='E'){const start=stack.get(e.pid+','+e.tid)?.pop();if(start)event={...start,dur:e.ts-start.ts};}if(event){done.push(event);const v=times.get(event.name)||{count:0,total:0,max:0};v.count++;v.total+=event.dur;v.max=Math.max(v.max,event.dur);times.set(event.name,v);}}
console.log(JSON.stringify({events:trace.length,longest:done.sort((a,b)=>b.dur-a.dur).slice(0,25).map(e=>({name:e.name,ms:e.dur/1000,pid:e.pid,tid:e.tid,args:e.args})),gpu:[...times].filter(([k])=>/D3D|Compile|Shader|Wait|Finish|Flush|DoCommands|Decoder/.test(k)).sort((a,b)=>b[1].max-a[1].max).slice(0,35)},null,2));
