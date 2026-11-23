import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as T from 'three';
import {CourierActor} from '@/systems/figures/quaternius-courier';
import {makeInkMaterial} from '@/engine/render/ink-material';
import {CHARACTERS,characterModelPath,defaultLook} from '@/content/characters';
for(const {key} of CHARACTERS){
 const bytes=readFileSync('public/'+characterModelPath(key)),{scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const a=new CourierActor(scene,makeInkMaterial({cloth:true}));let worst=0,record='';
 for(const state of [{air:true},{stride:1.7},{swim:true},{}]){
 a.pose(defaultLook(key),{x:15,y:7,z:3,yaw:1,pitch:0,walk:2,stride:0,air:false,glide:false,hurt:0,dying:-1,t:1,...state});
 a.model.updateMatrixWorld(true);
 a.model.traverse(o=>{if(!(o instanceof T.SkinnedMesh))return;
 const g=o.geometry,vs=g.attributes.position,idx=g.index!.array;
 const sk=Array.from({length:vs.count},(_,k)=>o.getVertexPosition(k,new T.Vector3()));
 for(let i=0;i<idx.length;i+=3)for(let j=0;j<3;j++){const x=idx[i+j],y=idx[i+(j+1)%3],rest=(k:number)=>new T.Vector3().fromBufferAttribute(vs,k),rd=rest(x).distanceTo(rest(y)),delta=sk[x].distanceTo(sk[y])-rd;
 if(delta>worst){worst=delta;record=JSON.stringify([o.name,state,...[x,y].map(k=>[rest(k).toArray().map(v=>+v.toFixed(2)),Array.from({length:4},(_,i)=>[o.skeleton.bones[g.attributes.skinIndex.getComponent(k,i)].name,g.attributes.skinWeight.getComponent(k,i)])])]);}}
 });}
 console.log(key,worst.toFixed(3),worst>.12?record:'');
}
