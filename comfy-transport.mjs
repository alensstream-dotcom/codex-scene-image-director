/** Independent ComfyUI REST transport. Does not patch or call private functions of another extension. */
import {inspectRenderConfig} from './generation-health.mjs';
import {validateWorkflow} from './workflow-library.mjs';
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
export function buildComfyRequest(native,request){
    inspectRenderConfig(native);const graph=validateWorkflow(native.worker),refs=request.animadexReferenceFiles||[];
    if(!Array.isArray(refs)||refs.length>4||refs.some(p=>!/^AnimadexIdentity\/img_[0-9a-f]{64}\.png$/.test(p)))throw new Error('人物参考文件无效。');
    const preset=native.yushe?.[native.yusheid_comfyui]||{},size=String(request.change||'').match(/\b(\d{2,4})x(\d{2,4})\b/);
    const width=finite(size?.[1]??request.width??native.comfyui_width,704),height=finite(size?.[2]??request.height??native.comfyui_height,1152);
    if(width<64||height<64||width>16384||height>16384)throw new Error('绘图尺寸无效。');
    const seed=Number.isSafeInteger(request.animadexSeed)&&request.animadexSeed>=0?request.animadexSeed:Math.floor(Math.random()*Number.MAX_SAFE_INTEGER);
    const scenePrompt=String(request.change||request.prompt||'').replace(/\b\d{2,4}x\d{2,4}\b/g,'').trim();
    if(!scenePrompt||/ADSCENE|ADCAP/.test(scenePrompt))throw new Error('图片提示词尚未准备好。');
    const prompt=[preset.fixedPrompt,scenePrompt,preset.fixedPrompt_end,native.AQT_comfyui].filter(v=>typeof v==='string'&&v.trim()).join(', ');
    const referenceTag=refs.length?', @adref:'+btoa(JSON.stringify(refs)).replaceAll('+','-').replaceAll('/','_'):'';
    const values={prompt:prompt+referenceTag,negative_prompt:[preset.negativePrompt,request.extraNegativePrompt,native.UCP_comfyui].filter(v=>typeof v==='string'&&v.trim()).join(', '),
        seed,steps:finite(native.comfyui_steps,24),cfg_scale:finite(native.cfg_comfyui,3),sampler_name:native.comfyuisamplerName||'euler_ancestral',scheduler:native.comfyui_scheduler||'simple',width,height,
        MODEL_NAME:native.MODEL_NAME||'',clip:native.comfyuiCLIPName||'',vae:native.comfyui_vae||'',c_quanzhong:finite(native.comfyui_lora,1),c_idquanzhong:finite(native.comfyui_lora2,1),c_xijie:finite(native.comfyui_lora3,1),c_fenwei:finite(native.comfyui_lora4,1),
        comfyuicankaotupian:native.comfyuicankaotupian||'',ipa:native.comfyui_ipa||'',inpaint_image:'',inpaint_mask:'',inpaint_positive:'',inpaint_negative:'',inpaint_denoise:.75};
    function replace(value){if(typeof value==='string'){const match=value.match(/^%([\w]+)%$/);if(match){if(!Object.hasOwn(values,match[1]))throw new Error('工作流存在未支持的占位符：'+match[1]);return values[match[1]];}return value.replace(/%([\w]+)%/g,(_,key)=>{if(!Object.hasOwn(values,key))throw new Error('工作流存在未支持的占位符：'+key);return String(values[key]);});}if(Array.isArray(value))return value.map(replace);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)]));return value;}
    const resolved=replace(graph),modelNode=Object.values(resolved).find(n=>n.class_type==='AnimadexDrawingModel');
    if(modelNode){const inputs=modelNode.inputs;Object.assign(inputs,{main_steps:values.steps,main_cfg:values.cfg_scale,main_sampler:values.sampler_name,main_scheduler:values.scheduler});if(values.MODEL_NAME&&resolved['15']?.inputs?.unet_name)resolved['15'].inputs.unet_name=values.MODEL_NAME;if(values.clip&&resolved['16']?.inputs?.clip_name)resolved['16'].inputs.clip_name=values.clip;if(values.vae&&resolved['17']?.inputs?.vae_name)resolved['17'].inputs.vae_name=values.vae;if(refs.length&&resolved['31']?.inputs?.unet_name==='SilvermoonMix-Anima29B-Evolved-V2.3.safetensors')Object.assign(inputs,{reference_steps:values.steps,reference_cfg:values.cfg_scale,reference_sampler:values.sampler_name,reference_scheduler:values.scheduler});}
    const portrait=height*100>=width*115,landscape=width*100>=height*115,canvas=Object.values(resolved).find(n=>n.class_type==='AnimadexIdentityCanvas'),scaled=!!canvas,tablet=canvas?.inputs?.output_size==='tablet';
    const genParams={source:'ComfyUI',workflow:native.workerid||'',model:resolved[refs.length?'31':'15']?.inputs?.unet_name||values.MODEL_NAME,resolvedPrompt:values.prompt,negativePrompt:values.negative_prompt,seed,
        width:scaled?(portrait?(tablet?704:880):landscape?(tablet?1152:1440):(tablet?896:1120)):width,height:scaled?(portrait?(tablet?1152:1440):landscape?(tablet?704:880):(tablet?896:1120)):height,
        steps:modelNode?.inputs?.[refs.length?'reference_steps':'main_steps']??values.steps,cfgScale:modelNode?.inputs?.[refs.length?'reference_cfg':'main_cfg']??values.cfg_scale,
        sampler:modelNode?.inputs?.[refs.length?'reference_sampler':'main_sampler']??values.sampler_name,scheduler:modelNode?.inputs?.[refs.length?'reference_scheduler':'main_scheduler']??values.scheduler,referenceFiles:[...refs]};
    return {graph:resolved,genParams};
}
const delay=(ms,signal)=>new Promise((resolve,reject)=>{signal.throwIfAborted();const stopped=()=>{clearTimeout(timer);reject(signal.reason);},timer=setTimeout(()=>{signal.removeEventListener('abort',stopped);resolve();},ms);signal.addEventListener('abort',stopped,{once:true});});
async function dataUrl(blob){if(typeof FileReader!=='undefined')return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败。'));reader.readAsDataURL(blob);});const bytes=new Uint8Array(await blob.arrayBuffer());let text='';for(let at=0;at<bytes.length;at+=8192)text+=String.fromCharCode(...bytes.subarray(at,at+8192));return 'data:'+(blob.type||'image/png')+';base64,'+btoa(text);}
export function createComfyRenderer({getSettings,fetcher=fetch,pollMs=1000,timeoutMs=600000}={}){
    return async request=>{
        const native=structuredClone(getSettings()),config=inspectRenderConfig(native),{graph,genParams}=buildComfyRequest(native,request),signal=AbortSignal.timeout(timeoutMs);
        const stale=request.animadexValidate?.();if(stale)throw new Error(stale);
        const call=async(path,options={})=>{let response;try{response=await fetcher(config.url+path,{...options,signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});}catch{throw new Error(signal.aborted?'绘图等待超时，请检查 ComfyUI 任务。':'ComfyUI 无法连接，请检查绘图地址与网络。');}if(!response.ok)throw new Error('ComfyUI 请求失败（HTTP '+response.status+'）。');return response;};
        const submitted=await(await call('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,client_id:'animadex-'+crypto.randomUUID()})})).json();
        if(submitted.error||!submitted.prompt_id)throw new Error('ComfyUI 拒绝当前工作流，请检查模型和节点。');
        const promptId=String(submitted.prompt_id);let result;
        while(!result){if(signal.aborted)throw new Error('绘图等待超时，请检查 ComfyUI 任务。');const history=await(await call('/history/'+encodeURIComponent(promptId))).json(),entry=history[promptId];
            if(entry?.status?.status_str==='error')throw new Error('ComfyUI 执行失败，请检查工作流节点和模型。');
            const outputs=entry?.outputs?Object.values(entry.outputs).flatMap(v=>v.images||[]).filter(v=>v?.filename):[];
            if(outputs.length){result=outputs.find(v=>v.type==='output')||outputs[0];break;}
            if(entry?.status?.completed)throw new Error('ComfyUI 已完成任务，但没有返回图片。请检查保存图片节点。');
            try{await delay(pollMs,signal);}catch{throw new Error('绘图等待超时，请检查 ComfyUI 任务。');}
        }
        const query=new URLSearchParams({filename:result.filename,subfolder:result.subfolder||'',type:result.type||'output'}),response=await call('/view?'+query);
        const blob=await response.blob();if(!blob.type.startsWith('image/')||blob.size===0)throw new Error('ComfyUI 返回的不是有效图片。');
        return {id:request.id,success:true,imageData:await dataUrl(blob),genParams,prompt:request.prompt};
    };
}
