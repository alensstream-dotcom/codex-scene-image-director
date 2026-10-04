import {getContext} from '../../../st-context.js';
import {enqueueChatSave} from '../../../../script.js';
import {saveCharacterChatPayload,saveGroupChatPayload} from '../../../chat-payload-transport.js';
import {saveWorldInfo,updateWorldInfoList,updateWorldInfoSettings,selected_world_info} from '../../../world-info.js';
import {loadCatalog} from './catalog.mjs';
import {createIdentityResolver} from './identity.mjs';
import {createStudioPersistence} from './studio-persistence.mjs';
import {initV2} from './v2-entry.mjs';
import {applyMainProfile} from './model-profiles.mjs';
import {ensureRenderSettings} from './render-settings.mjs';
const KEY='animadex_story_cast',BOOK='Animadex_剧情绘图_v2_使用指南',BASE=new URL('.',import.meta.url).href.replace(/\/$/,'');
const setting=()=>getContext().extensionSettings[KEY]??={enabled:true,diagnostics:[]};
const notify=(text,level='info')=>window.toastr?.[level]?.(text,'剧情绘图');
const persist=createStudioPersistence({getContext,enqueue:enqueueChatSave,saveCharacter:saveCharacterChatPayload,saveGroup:saveGroupChatPayload});
const configKeys=['worker','workerid','MODEL_NAME','comfyuiCLIPName','comfyui_vae','comfyuiUrl','comfyui_steps','cfg_comfyui','comfyui_width','comfyui_height','comfyuisamplerName','comfyui_scheduler','yusheid_comfyui','UCP_comfyui','AQT_comfyui'];
let loading,catalog,resolver,taxonomyInfo;
async function read(path){const r=await fetch(BASE+'/'+path,{cache:'no-store'});if(!r.ok)throw new Error(path+': HTTP '+r.status);return r.json();}
function diagnostics(event){const s=setting();s.diagnostics=[...(s.diagnostics||[]),{time:new Date().toISOString(),...event}].slice(-30);getContext().saveSettingsDebounced();}
async function ensureCatalog(){return loading??=Promise.all([loadCatalog(BASE,{excludedIds:()=>setting().catalog_excluded_ids||[]}),read('data/taxonomy.json')]).then(([c,taxonomy])=>{catalog=c;taxonomyInfo=taxonomy.tags;resolver=createIdentityResolver(c,{taxonomy});diagnostics({event:'catalog_ready',...c.stats});return c;}).catch(error=>{loading=undefined;throw error;});}
async function configureWorkflow(profile,{activate=true}={}) {
    const ctx = getContext(), s = setting(), target = ensureRenderSettings(s,ctx.extensionSettings['st-chatu8']||{});
    const chosen=typeof profile==='string'?profile:(s.mainProfile||'silvermoon_quality');
    const {config,workflow}=applyMainProfile(await read('workflow-config.json'),await read('workflow-api.json'),chosen);
    if(!activate){target.workers??={};target.workers[config.name]??=JSON.stringify(workflow,null,2);ctx.saveSettingsDebounced();return;}
    if (!s.previousComfy) s.previousComfy = Object.fromEntries(configKeys.map(k => [k, structuredClone(target[k] ?? null)]));
    if (!Object.hasOwn(s.previousComfy,'UCP_comfyui')) s.previousComfy.UCP_comfyui=structuredClone(target.UCP_comfyui??'');
    if (!Object.hasOwn(s.previousComfy,'AQT_comfyui')) s.previousComfy.AQT_comfyui=structuredClone(target.AQT_comfyui??'');
    if(chosen==='harem')config.settings.UCP_comfyui=s.previousComfy.UCP_comfyui??'';
    if(chosen==='harem')config.settings.AQT_comfyui=s.previousComfy.AQT_comfyui??'';
    // A separate named workflow preserves every existing workflow/prompt preset.
    const text = JSON.stringify(workflow, null, 2);
    target.workers ??= {};
    target.workers[config.name] = text;
    target.worker = text;
    target.workerid = config.name;
    config.settings.comfyuiUrl=target.comfyuiUrl||config.settings.comfyuiUrl;
    Object.assign(target, config.settings);
    if (config.promptPreset) {
        const { name, ...values } = config.promptPreset;
        target.yushe ??= {};
        target.yushe[name] = values;
        target.yusheid_comfyui = name;
    }
    s.configuredVersion = config.version;
    s.mainProfile=chosen;
    diagnostics({ event: 'workflow_configured', worker: config.name, main_model: config.settings.MODEL_NAME, steps: config.settings.comfyui_steps });
    ctx.saveSettingsDebounced();
}
async function installBook() {
    const book = await read('worldbook.json');
    await saveWorldInfo(BOOK, book, true);
    await updateWorldInfoList();
    updateWorldInfoSettings({}, [...new Set([...selected_world_info.filter(name=>!['Animadex_剧情形象抽取_v1','Animadex_剧情绘图_v2','自动生图世界书'].includes(name)), BOOK])]);
    setting().bookInstalled = true;
    setting().bookVersion = (await read('workflow-config.json')).version;
    diagnostics({ event: 'worldbook_installed', book: BOOK });
}
await initV2({getContext,getTools:async()=>{await ensureCatalog();return {catalog,resolver,taxonomy:taxonomyInfo};},persist,setting,notify,diagnostics,configure:configureWorkflow,installBook});
