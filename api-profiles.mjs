/** Plugin-owned LLM settings. Migration copies permitted settings, never edits another extension. */
export const API_FORMAT='animadex-api-profiles-v1';
const copy=structuredClone;
const id=()=>globalThis.crypto.randomUUID();
export function apiBase(value){
    let url;try{url=new URL(String(value||'').trim());}catch{throw new Error('请填写有效的 API Base URL。');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('API 地址需要使用 HTTP/HTTPS，不能包含密钥、查询参数或片段。');
    return url.href.replace(/\/+$/,'').replace(/\/(?:chat\/completions|models)$/,'');
}
export function normalizeApiProfile(raw={}, {complete=false}={}){
    const name=String(raw.name||'默认').trim();if(!name||name.length>80)throw new Error('配置名称需为 1～80 个字符。');
    const api_url=String(raw.api_url||'').trim(),api_key=String(raw.api_key||'').trim(),model=String(raw.model||'').trim();
    if(api_url)apiBase(api_url);if(api_key.length>8192||/[\r\n]/.test(api_key))throw new Error('API Key 格式无效。');
    if(model.length>300||/[\r\n]/.test(model))throw new Error('模型名称格式无效。');
    if(complete&&(!api_url||!api_key||!model))throw new Error('请在剧情绘图的 API 配置中填写地址、密钥和模型，并保存。');
    const timeout=Number(raw.timeout_seconds??60);if(!Number.isInteger(timeout)||timeout<10||timeout>300)throw new Error('请求超时需为 10～300 秒。');
    return {id:typeof raw.id==='string'&&raw.id.length<=100?raw.id:id(),name,api_url,api_key,model,bypass_proxy:raw.bypass_proxy===true,timeout_seconds:timeout,
        enable_custom_headers:raw.enable_custom_headers===true,custom_headers:String(raw.custom_headers||'').slice(0,8000),
        models:[...new Set((Array.isArray(raw.models)?raw.models:[]).filter(x=>typeof x==='string'&&x.length<=300&&!/[\r\n]/.test(x)))].slice(0,5000)};
}
export function ensureApiProfiles(settings,native={}){
    if(settings.api_profiles?.version===1&&Array.isArray(settings.api_profiles.profiles)&&settings.api_profiles.profiles.length)return settings.api_profiles;
    const selected=settings.manual_api_profile||native.llm_request_type_configs?.image_gen?.api_profile||native.current_llm_profile||'默认',source=native.llm_profiles?.[selected];
    let migrated;try{migrated=source?normalizeApiProfile({...source,name:selected}):normalizeApiProfile({name:'默认'});}catch{migrated=normalizeApiProfile({name:selected});}
    settings.api_profiles={version:1,activeId:migrated.id,profiles:[migrated],migrated_from:source?'智绘姬配置副本':''};
    if(settings.manual_transport!=='helper')settings.manual_transport='plugin';
    return settings.api_profiles;
}
export function activeApiProfile(settings){const store=settings.api_profiles;return store?.profiles?.find(p=>p.id===store.activeId)||store?.profiles?.[0];}
export function createApiProfileStore({setting,native=()=>({}),save=()=>{}}){
    const store=()=>ensureApiProfiles(setting(),native());
    function list(){const s=store();return s.profiles.map(p=>({...copy(p),active:p.id===s.activeId}));}
    function put(raw){const s=store(),profile=normalizeApiProfile(raw),existing=s.profiles.findIndex(p=>p.id===profile.id);if(s.profiles.some(p=>p.id!==profile.id&&p.name===profile.name))throw new Error('配置名称已存在，请换一个名称。');if(existing<0)s.profiles.push(profile);else s.profiles[existing]=profile;s.activeId=profile.id;setting().manual_transport='plugin';save();return copy(profile);}
    function use(profileId){const s=store();if(!s.profiles.some(p=>p.id===profileId))throw new Error('API 配置不存在。');s.activeId=profileId;setting().manual_transport='plugin';save();return copy(activeApiProfile(setting()));}
    function remove(profileId){const s=store();if(s.profiles.length<=1)throw new Error('至少保留一套 API 配置。');if(!s.profiles.some(p=>p.id===profileId))throw new Error('API 配置不存在。');s.profiles=s.profiles.filter(p=>p.id!==profileId);if(s.activeId===profileId)s.activeId=s.profiles[0].id;save();return list();}
    function exportData({includeKey=false}={}){const s=store();return {format:API_FORMAT,version:1,activeName:activeApiProfile(setting()).name,profiles:s.profiles.map(p=>{const value=copy(p);delete value.id;if(!includeKey){delete value.api_key;delete value.custom_headers;}return value;})};}
    function importData(data){if(data?.format!==API_FORMAT||!Array.isArray(data.profiles)||!data.profiles.length||data.profiles.length>100)throw new Error('不是有效的剧情绘图 API 配置文件。');const prepared=data.profiles.map(p=>normalizeApiProfile({...p,id:id()})),s=store(),names=new Set(s.profiles.map(p=>p.name));for(const p of prepared){const original=p.name;let n=2;while(names.has(p.name))p.name=original+' ('+n+++')';names.add(p.name);}s.profiles.push(...prepared);save();return copy(prepared);}
    return {listApiProfiles:list,saveApiProfile:put,useApiProfile:use,deleteApiProfile:remove,exportApiProfiles:exportData,importApiProfiles:importData};
}
export function apiRequestHeaders(profile){
    const headers={Authorization:'Bearer '+profile.api_key};
    if(profile.enable_custom_headers)for(const line of profile.custom_headers.split('\n')){const match=line.match(/^\s*([^:]+):\s*(.*?)\s*$/);if(!match)continue;const key=match[1].trim(),value=match[2].replace(/^(["'])(.*)\1$/,'$2');if(!/^[\w-]+$/.test(key)||/[\r\n]/.test(value))throw new Error('自定义请求头格式无效。');headers[key]=value;}
    return headers;
}
export function proxyApiHeaders(profile){return Object.entries(apiRequestHeaders(profile)).map(([k,v])=>k+': '+JSON.stringify(v)).join('\n');}
export async function fetchApiModels(raw,{getContext,fetcher=fetch,signal}={}){
    const profile=normalizeApiProfile(raw),base=apiBase(profile.api_url);if(!profile.api_key)throw new Error('请填写 API Key 后获取模型。');
    const timeout=AbortSignal.timeout(20000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    let response;try{response=await fetcher(profile.bypass_proxy?base+'/models':'/api/backends/chat-completions/status',profile.bypass_proxy?
        {headers:apiRequestHeaders(profile),signal:combined}:{method:'POST',headers:{...getContext().getRequestHeaders?.(),'Content-Type':'application/json'},body:JSON.stringify({chat_completion_source:'custom',custom_url:base,custom_include_headers:proxyApiHeaders(profile)}),signal:combined});}
    catch(error){if(signal?.aborted)throw error;throw new Error(error.name==='TimeoutError'?'获取模型超时，请检查 API 地址。':'获取模型失败，请检查地址、网络及直连选项。');}
    if(!response.ok)throw new Error(response.status===401||response.status===403?'API 认证失败，请检查密钥。':'获取模型失败（HTTP '+response.status+'）。可手动填写模型。');
    let value;try{value=await response.json();}catch{throw new Error('模型列表没有返回有效 JSON。可手动填写模型。');}
    if(value?.error)throw new Error('接口拒绝返回模型列表。请检查配置，或手动填写模型。');
    const rows=Array.isArray(value)?value:Array.isArray(value?.data)?value.data:value?.models;
    const models=[...new Set((Array.isArray(rows)?rows:[]).map(p=>typeof p==='string'?p:p?.id||p?.name).filter(p=>typeof p==='string'&&p.trim()&&p.length<=300&&!/[\r\n]/.test(p)))].sort().slice(0,5000);
    if(!models.length)throw new Error('接口没有提供模型列表。可手动填写模型后测试。');return models;
}
