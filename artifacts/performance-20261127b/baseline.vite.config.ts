import {execFileSync} from 'node:child_process';
import {mergeConfig} from 'vite';
import config from '../../vite.config';
const terrain=execFileSync('git',['show','HEAD:src/systems/wilderness/distant-terrain.ts'],{encoding:'utf8'});
const warm=execFileSync('git',['show','HEAD:src/engine/render/warm-up.ts'],{encoding:'utf8'});
export default mergeConfig(config,{plugins:[{
  name:'performance-baseline',enforce:'pre',
  load(id:string){if(id.replaceAll('\\','/').endsWith('/src/systems/wilderness/distant-terrain.ts'))return terrain;if(id.replaceAll('\\','/').endsWith('/src/engine/render/warm-up.ts'))return warm;},
  transform(code:string,id:string){if(id.replaceAll('\\','/').endsWith('/src/engine/render/warm-up.ts'))return code.replace('  renderer.warmEffects();','');},
}]});
