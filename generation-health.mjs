import {validateWorkflow} from './workflow-library.mjs';
export function inspectRenderConfig(native={},scene){
    if(native.mode&&native.mode!=='comfyui')throw new Error('剧情绘图需要使用 ComfyUI 模式。');
    let url;try{url=new URL(native.comfyuiUrl);}catch{throw new Error('请在 ComfyUI 页面配置绘图地址。');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('ComfyUI 地址格式无效。');
    const graph=validateWorkflow(native.worker);
    const hasReferences=scene?.actors?.some(a=>a.person_snapshot?.reference_enabled&&a.person_snapshot?.reference_ids?.length);
    if(hasReferences&&!Object.values(graph).some(n=>n.class_type==='AnimadexIdentityReference'))throw new Error('当前工作流不支持人物图片参考，请换用剧情绘图工作流或在人物档案中关闭参考。');
    return {url:url.href.replace(/\/+$/,''),workflow:native.workerid||'当前工作流',nodes:Object.keys(graph).length,reference_supported:Object.values(graph).some(n=>n.class_type==='AnimadexIdentityReference')};
}
