/** Use the existing drawing API on every device. No dependency on a Windows process. */
import {MANUAL_INSTRUCTION} from './manual-instruction.mjs';
export function manualConnection(ctx,settings={}){
    const native=ctx.extensionSettings?.['st-chatu8']||{},profiles=native.llm_profiles||{};
    const name=settings.manual_api_profile||native.llm_request_type_configs?.image_gen?.api_profile||native.current_llm_profile||'默认';
    const profile=profiles[name];
    const complete=!!(profile?.api_url?.trim()&&profile?.api_key?.trim()&&profile?.model?.trim());
    const mode=settings.manual_transport||'auto';
    if(!['auto','native','helper'].includes(mode))throw new Error('选段连接方式无效，请在选段连接中重新选择。');
    if(mode==='auto'&&!complete&&!settings.manual_helper_url&&globalThis.location?.hostname==='tauri.localhost')throw new Error('请在智绘姬的 LLM API 设置中配置选段使用的接口、密钥和模型。');
    if(mode==='native'||mode==='auto'&&complete){
        if(!complete)throw new Error('请在智绘姬的 LLM API 设置中配置选段使用的接口、密钥和模型。');
        return {kind:'native',name,model:profile.model.trim(),profile};
    }
    let url=settings.manual_helper_url?.trim();
    if(!url){const hostname=globalThis.location?.hostname||'127.0.0.1';url='http://'+(['tauri.localhost','localhost','127.0.0.1',''].includes(hostname)?'127.0.0.1':hostname)+':8189';}
    const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('选段助手地址必须是 HTTP 或 HTTPS 地址。');
    return {kind:'helper',url:url.replace(/\/+$/,'')};
}
function customHeaders(profile){
    const headers={};if(!profile.enable_custom_headers)return headers;
    for(const line of String(profile.custom_headers||'').split('\n')){const m=line.match(/^\s*([^:]+):\s*(.*?)\s*$/);if(m)headers[m[1].trim()]=m[2].replace(/^(["'])(.*)\1$/,'$2');}
    return headers;
}
function requestFailure(status,value){
    const code=String(value?.error?.code||value?.code||'').toLowerCase();
    if(code==='network.timeout')return '选段接口请求超时，请稍后重新生成。';
    if(code==='network.body_interrupted')return '选段接口的回复中断，请重新生成。';
    if(code.startsWith('network.'))return '选段接口无法连接，请检查智绘姬的 API 地址、网络与代理。';
    return status===429?'选段接口繁忙，请稍后重新生成。':status===401||status===403?'选段接口认证失败，请检查智绘姬的 API 配置。':'选段整理失败（HTTP '+status+'），请重新生成。';
}
export function createManualTransport({getContext,setting=()=>({}),fetcher=fetch,onRequest}){
    return async(payload,{signal}={})=>{
        const ctx=getContext(),connection=manualConnection(ctx,setting());
        let url,headers,body;
        if(connection.kind==='helper'){url=connection.url+'/manual';headers={'Content-Type':'application/json'};body=payload;}
        else{
            const profile=connection.profile,base=profile.api_url.trim().replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
            body={model:connection.model,messages:[{role:'system',content:MANUAL_INSTRUCTION},{role:'user',content:JSON.stringify(payload)}],stream:false,max_tokens:3000,temperature:.1,response_format:{type:'json_object'},tool_choice:'none'};
            if(/deepseek/i.test(connection.model))body.thinking={type:'disabled'};
            const extras=customHeaders(profile);
            if(profile.bypass_proxy){url=base+'/chat/completions';headers={'Content-Type':'application/json',Authorization:'Bearer '+profile.api_key.trim(),...extras};}
            else{
                url='/api/backends/chat-completions/generate';headers={...ctx.getRequestHeaders?.(),'Content-Type':'application/json'};
                const passthrough={response_format:body.response_format,tool_choice:'none',...(body.thinking?{thinking:body.thinking}:{})};
                body={...body,type:'quiet',chat_completion_source:'custom',custom_url:base,custom_include_body:JSON.stringify(passthrough),custom_include_headers:Object.entries({Authorization:'Bearer '+profile.api_key.trim(),...extras}).map(([k,v])=>k+': '+JSON.stringify(v)).join('\n')};
            }
        }
        const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);
        signal?.throwIfAborted();signal?.addEventListener('abort',cancel,{once:true});
        let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},60000);
        try{
            onRequest?.({transport:connection.kind,model:connection.model||'helper'});
            const response=await fetcher(url,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal});
            if(!response.ok){let failure;try{failure=await response.json();}catch{}throw new Error(requestFailure(response.status,failure));}
            let value;try{value=await response.json();}catch{throw new Error('选段接口未返回有效 JSON 数据，请检查接口后重新生成。');}
            if(value?.error)throw new Error(requestFailure(response.status,value));
            if(connection.kind==='helper')return value;
            const choice=value.choices?.[0];if(choice?.finish_reason&&choice.finish_reason!=='stop')throw new Error('选段标签返回不完整，请重新生成。');
            const content=choice?.message?.content;if(typeof content!=='string')throw new Error('选段接口未返回文字，请检查模型配置。');
            if(/^\s*\[API\s*(?:错误|Error)\]/i.test(content))throw new Error(/请求超时|timed?\s*out|timeout/i.test(content)?'选段接口请求超时，请稍后重新生成。':'选段接口请求失败，请检查智绘姬的 API 配置后重新生成。');
            try{return JSON.parse(content.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,''));}catch{throw new Error('选段接口没有返回有效 JSON，请重新生成。');}
        }catch(error){
            if(signal?.aborted)throw error;
            if(timedOut)throw new Error('选段整理超过 60 秒，请稍后重新生成。');
            if(error instanceof TypeError)throw new Error(connection.kind==='helper'?'选段助手未连接。请配置智绘姬 LLM API，或在选段连接中填写电脑上的助手地址。':'选段接口无法连接，请检查智绘姬的 API 地址与网络。');
            throw error;
        }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
    };
}
