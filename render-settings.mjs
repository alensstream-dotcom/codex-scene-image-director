/** One-time, whitelisted migration. Rendering settings belong to this extension. */
import {inspectRenderConfig} from './generation-health.mjs';
const KEYS=['worker','workerid','workers','yushe','yusheid_comfyui','comfyuiUrl','MODEL_NAME','comfyuiCLIPName','comfyui_vae','comfyui_steps','cfg_comfyui','comfyui_width','comfyui_height','comfyuisamplerName','comfyui_scheduler','UCP_comfyui','AQT_comfyui','comfyui_lora','comfyui_lora2','comfyui_lora3','comfyui_lora4'];
const DEFAULTS={version:1,mode:'comfyui',comfyuiUrl:'http://127.0.0.1:8188',comfyui_steps:24,cfg_comfyui:3,comfyui_width:704,comfyui_height:1152,comfyuisamplerName:'euler_ancestral',comfyui_scheduler:'simple'};
export function ensureRenderSettings(setting,legacy={}){
    if(setting.render_settings){for(const[k,v]of Object.entries(DEFAULTS))setting.render_settings[k]??=v;return setting.render_settings;}
    const values=Object.fromEntries(KEYS.filter(k=>legacy[k]!==undefined).map(k=>[k,structuredClone(legacy[k])]));
    const result={...DEFAULTS,workers:{},yushe:{},...values};
    if(result.worker&&!Object.hasOwn(result.workers,result.workerid||'')){result.workerid||='迁移的工作流';result.workers[result.workerid]=result.worker;}
    setting.render_settings=result;return result;
}
export function updateRenderSettings(current,patch){
    const next=structuredClone(current);
    if(patch.url!==undefined)next.comfyuiUrl=String(patch.url).trim();
    for(const k of ['MODEL_NAME','comfyuiCLIPName','comfyui_vae','comfyuisamplerName','comfyui_scheduler','UCP_comfyui','AQT_comfyui'])if(patch[k]!==undefined)next[k]=String(patch[k]).trim();
    for(const[k,min,max,integer]of[['comfyui_steps',1,200,true],['cfg_comfyui',0,30,false],['comfyui_width',64,16384,true],['comfyui_height',64,16384,true]])if(patch[k]!==undefined){const n=Number(patch[k]);if(!Number.isFinite(n)||n<min||n>max||integer&&!Number.isInteger(n))throw new Error('绘图参数超出范围：'+k);next[k]=n;}
    next.comfyuiUrl=inspectRenderConfig(next).url;
    Object.assign(current,next);return structuredClone(next);
}
