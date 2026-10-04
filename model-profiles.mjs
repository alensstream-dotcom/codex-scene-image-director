const BF16='SilvermoonMix-Anima29B-Evolved-V2.3.safetensors';
const INT8='SilvermoonMix-Anima29B-Evolved-V2.3-INT8-ConvRot.safetensors';
export const WORKFLOW_VERSION='2.1.3';
export const MAIN_PROFILES={
    silvermoon_quality:{label:'SilvermoonMix · 画质优先 · 约45秒',name:'Animadex_Silvermoon_画质优先_平板',model:INT8,steps:28,cfg:3,sampler:'euler_ancestral',scheduler:'simple',turbo:0,boost:0,mainBudget:'high',outputSize:'tablet',hint:'先以832×1344生成细节，再缩到704×1152。约45秒为本机竖图实测，冷启动与图片参考可能更久。'},
    silvermoon_efficiency:{label:'SilvermoonMix · 效率优先 · 约30秒',name:'Animadex_Silvermoon_效率优先_平板',model:INT8,steps:24,cfg:3,sampler:'euler_ancestral',scheduler:'simple',turbo:0,boost:0,mainBudget:'standard',outputSize:'tablet',hint:'以704×1152直接生成，适合连续看剧情。约30秒为本机竖图实测，冷启动与图片参考可能更久。'},
    silvermoon:{label:'SilvermoonMix · 原普通版 BF16',name:'Animadex_Silvermoon_原版BF16',model:BF16,steps:24,cfg:3,sampler:'euler_ancestral',scheduler:'simple',turbo:0,boost:0},
    harem:{label:'原有 Harem 2.9B',model:'miaomiaoHarem_29BBETA10.safetensors',steps:20,cfg:2,sampler:'euler',scheduler:'sgm_uniform',turbo:.7,boost:.45},
    silvermoon_turbo:{label:'SilvermoonMix 2.9B · 快速版',name:'Animadex_Silvermoon_Turbo',model:'SilvermoonMix-Anima29B-Evolved-Turbo-V2.3.safetensors',steps:10,cfg:1,sampler:'er_sde',scheduler:'simple',turbo:0,boost:0}
};
export const DEFAULT_MAIN_PROFILE='silvermoon_quality';
export function applyMainProfile(config,workflow,id=DEFAULT_MAIN_PROFILE){
    const p=MAIN_PROFILES[id];if(!p)throw new Error('主模型选项不存在。');
    const c=structuredClone(config),w=structuredClone(workflow);if(c.legacyPromptPreset)c.promptPreset=structuredClone(c.legacyPromptPreset);
    c.version=WORKFLOW_VERSION;c.name=p.name||config.name;c.settings.workerid=c.name;
    Object.assign(c.settings,{MODEL_NAME:p.model,comfyui_steps:p.steps,cfg_comfyui:p.cfg,comfyuisamplerName:p.sampler,comfyui_scheduler:p.scheduler});
    w['15'].inputs.unet_name=p.model;w['15'].inputs.weight_dtype=id==='harem'?'fp8_e4m3fn_fast':'default';
    w['19'].inputs.strength_model=p.turbo;w['19'].inputs.strength_clip=p.turbo;w['23'].inputs.strength_model=p.boost;
    Object.assign(w['30'].inputs,{main_steps:p.steps,main_cfg:p.cfg,main_sampler:p.sampler,main_scheduler:p.scheduler});
    // Both plain and reference routes were measured with the native ConvRot checkpoint.
    const standardSilvermoon=id==='silvermoon'||id==='silvermoon_quality'||id==='silvermoon_efficiency';
    const optimized=id==='silvermoon_quality'||id==='silvermoon_efficiency';
    w['31'].inputs.unet_name=optimized?INT8:standardSilvermoon?BF16:'anima-base-v1.0.safetensors';w['31'].inputs.weight_dtype='default';
    Object.assign(w['30'].inputs,{reference_steps:id==='silvermoon_efficiency'?20:24,reference_cfg:standardSilvermoon?3:4,reference_sampler:standardSilvermoon?'euler_ancestral':'er_sde',reference_scheduler:'simple'});
    w['26'].inputs.main_budget=p.mainBudget||'standard';w['26'].inputs.output_size=p.outputSize||'original';
    w['26'].inputs.reference_budget=id==='silvermoon_quality'?'quality':'standard';
    c.canvasBudget={portrait:p.mainBudget==='high'?[832,1344]:[704,1152],landscape:p.mainBudget==='high'?[1344,832]:[1152,704],square:p.mainBudget==='high'?[1024,1024]:[896,896],outputSize:p.outputSize||'original'};
    if(id!=='harem'){
        c.settings.UCP_comfyui='';c.settings.AQT_comfyui='';c.promptPreset.name=id==='silvermoon_quality'||id==='silvermoon_efficiency'?'Animadex_Silvermoon_原生标签':c.promptPreset.name;
        c.promptPreset.negativePrompt='';c.promptPreset.fixedPrompt='';c.promptPreset.fixedPrompt_end='';w['25'].inputs.default_style='ModelDefault';
    }
    return {config:c,workflow:w};
}
export function workflowUpgradeProfile(setting,native){
    if(setting.workflowOptimizationVersion===WORKFLOW_VERSION)return null;
    const owned=new Set(['Animadex_剧情形象参考_v2',...Object.values(MAIN_PROFILES).map(p=>p.name).filter(Boolean)]);
    if(native.workerid&&!owned.has(native.workerid))return null;
    return !setting.mainProfile||setting.mainProfile==='silvermoon'?DEFAULT_MAIN_PROFILE:MAIN_PROFILES[setting.mainProfile]?setting.mainProfile:null;
}
export async function installWorkflowUpgrade(setting,native,configure){
    if(setting.workflowOptimizationVersion===WORKFLOW_VERSION)return;
    const activate=workflowUpgradeProfile(setting,native);
    for(const id of['silvermoon_efficiency','silvermoon_quality','silvermoon'])await configure(id,{activate:false});
    if(activate)await configure(activate);
    setting.workflowOptimizationVersion=WORKFLOW_VERSION;
}
