export const ruleMeta=entry=>entry?.extensions?.animadex_drawing||{};
export const ruleScope=entry=>['automatic','manual','both','reference'].includes(ruleMeta(entry).scope)?ruleMeta(entry).scope:'both';
export const ruleKind=entry=>ruleMeta(entry).kind||'guide';
export const isProtectionEntry=entry=>ruleKind(entry)==='safety'||ruleMeta(entry).id==='engine.reference'||ruleMeta(entry).group==='content_boundaries';
export function orderedWorldbookEntries(data){
    const rank=e=>ruleKind(e)==='safety'?0:isProtectionEntry(e)?1:2;
    return Object.entries(data?.entries||{}).sort(([ka,a],[kb,b])=>rank(a)-rank(b)||Number(b.order??100)-Number(a.order??100)||String(ka).localeCompare(String(kb)));
}
export function protectionWorldbook(data){
    const copy=structuredClone(data);copy.entries=Object.fromEntries(orderedWorldbookEntries(copy).filter(([,e])=>isProtectionEntry(e)));return copy;
}
export function scopedEntries(data,scope,{contextOnly=false}={}){
    return Object.entries(data?.entries||{}).filter(([,e])=>!e.disable&&e.content?.trim()&&['both',scope].includes(ruleScope(e))&&(!contextOnly||ruleKind(e)==='context')).sort(([ka,a],[kb,b])=>Number(b.order??100)-Number(a.order??100)||String(ka).localeCompare(String(kb)));
}
export function renderWorldbookRules(data,scope,variables={},options={}){
    return scopedEntries(data,scope,options).filter(([,e])=>!ruleMeta(e).when||variables[ruleMeta(e).when]?.length).map(([,e])=>e.content.replace(/\{\{(ad_confirmed_people|ad_current_outfits)\}\}/g,(_,key)=>JSON.stringify(variables[key==='ad_confirmed_people'?'people':'outfits']||[]))).join('\n\n');
}
export function minimalWorldbook(data){
    const copy=structuredClone(data);copy.entries=Object.fromEntries(Object.entries(copy.entries).filter(([,e])=>['required','safety','context'].includes(ruleKind(e))));return copy;
}
const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
function fingerprint(value){let hash=2166136261;for(const c of JSON.stringify(canonical(value)))hash=Math.imul(hash^c.charCodeAt(0),16777619);return(hash>>>0).toString(16);}
function extensions(owner){if(!owner.extensions||typeof owner.extensions!=='object'||Array.isArray(owner.extensions)){const previous=owner.extensions;owner.extensions={};if(previous!==undefined)owner.extensions.animadex_original_extensions=previous;}return owner.extensions;}
function nextId(data){const used=new Set([...Object.keys(data.entries),...Object.values(data.entries).map(e=>String(e.uid))]);let next=0;return()=>{while(used.has(String(next)))next++;used.add(String(next));return next++;};}
/** Build a new file. The old book and all original unknown fields stay intact. */
export function upgradedRuleBook(oldData,defaults){
    if(fingerprint(oldData)===defaults.extensions?.animadex_drawing?.legacy_default_signature)return structuredClone(defaults);
    const copy=structuredClone(oldData);extensions(copy).animadex_drawing={...(copy.extensions.animadex_drawing||{}),version:2};
    for(const e of Object.values(copy.entries)){extensions(e).animadex_drawing={...ruleMeta(e),scope:ruleMeta(e).scope||'automatic'};}
    const allocate=nextId(copy);
    for(const e of Object.values(defaults.entries))if(ruleScope(e)==='manual'||ruleKind(e)==='context'||ruleKind(e)==='reference'){
        const item=structuredClone(e),id=allocate();item.uid=id;item.displayIndex=id;copy.entries[String(id)]=item;
    }
    return copy;
}
/** Append an external book without overwriting current entries or editing its original file. */
export function appendWorldbookEntries(target,incoming,{scope='both',name='外部世界书'}={}){
    if(!['automatic','manual','both','preserve'].includes(scope))throw new Error('追加条目适用阶段无效。');
    const copy=structuredClone(target),source=structuredClone(incoming),map={},allocate=nextId(copy);
    for(const[id,e]of Object.entries(source.entries)){const next=allocate(),stage=scope==='preserve'?ruleScope(e):scope;extensions(e).animadex_drawing={...ruleMeta(e),scope:stage,source_book:name,source_id:id,source_uid:e.uid};e.uid=next;e.displayIndex=next;copy.entries[String(next)]=e;map[id]=String(next);}
    const {entries,...sourceMetadata}=incoming;extensions(copy).animadex_drawing??={};copy.extensions.animadex_drawing.imports??=[];copy.extensions.animadex_drawing.imports.push({name,metadata:structuredClone(sourceMetadata),entry_ids:map});return copy;
}
/** Keep executable protocols and automatic rules; preserve replaced guides as disabled entries. */
export function manualGuideWorldbook(data,guide){
    const copy=structuredClone(data);
    for(const entry of Object.values(copy.entries))if(ruleScope(entry)==='manual'&&ruleKind(entry)==='guide')entry.disable=true;
    return appendWorldbookEntries(copy,guide,{scope:'manual',name:'选段中文调整模板'});
}
