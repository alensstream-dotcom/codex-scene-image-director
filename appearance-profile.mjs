/** Match source evidence to narrative facts; unknown attributes never become invented facts. */
const core=new Set(['gender','bust','height','age_group','hair_color','hair_length','hair_style','eye_color']);
const physical=new Set(['gender','hair_color','hair_length','hair_style','hair_pattern','bangs','eye_color','eye_features','skin','build','bust','species','ears','horns','tail','wings','face','marks','anatomy','facial_hair','age_evidence']);
const norm=t=>String(t||'').normalize('NFKC').toLowerCase().replaceAll('_',' ').replace(/\s+/g,' ').trim();
const facetNames={hair_color:'发色',hair_length:'发长',eye_color:'瞳色',gender:'性别'};
const escape=t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const caches=new WeakMap();
function termsFor(catalog){
    if(caches.has(catalog))return caches.get(catalog);
    const terms=(catalog.appearanceTerms?.()||[]).filter(m=>physical.has(m.facet)&&m.facet!=='gender').flatMap(m=>[m.tag,...(m.aliases_zh||[])].filter(t=>t.length>=2).map(t=>({meta:m,term:norm(t),pattern:new RegExp(/[a-z]/i.test(t)?'(?<![a-z])'+escape(norm(t))+'(?![a-z])':escape(norm(t)),'gi')}))).sort((a,b)=>b.term.length-a.term.length);
    caches.set(catalog,terms);return terms;
}
export function extractAppearance(text,catalog){
    const value=norm(text),hits=[],used=[];
    for(const item of termsFor(catalog)){
        item.pattern.lastIndex=0;
        for(const match of value.matchAll(item.pattern)){
            const at=match.index,end=at+match[0].length;
            if(used.some(([a,b,f])=>f===item.meta.facet&&at>=a&&end<=b)||/(?:没有|并非|不是|不带|不像|无|not |no |without )\s*$/.test(value.slice(Math.max(0,at-12),at)))continue;
            hits.push(item.meta);used.push([at,end,item.meta.facet]);
        }
    }
    if(/黑长直/.test(value))for(const tag of ['black hair','long hair','straight hair']){const meta=catalog.tagInfo(tag);if(meta)hits.push({tag,...meta});}
    return [...new Map(hits.map(m=>[m.tag,m])).values()];
}
function namedDescription(old,text,others){
    const names=[old.person,...(old.aliases||[])].filter(Boolean),rivals=others.filter(n=>!names.includes(n));
    return String(text||'').slice(-16000).split(/[。！？!?\n]|\.(?=\s|$)/).flatMap(sentence=>{
        const at=names.map(n=>sentence.indexOf(n)).filter(i=>i>=0).sort((a,b)=>a-b)[0];if(at===undefined)return [];
        const tail=sentence.slice(at),stop=rivals.map(n=>tail.indexOf(n)).filter(i=>i>0).sort((a,b)=>a-b)[0];
        const matched=names.find(n=>sentence.indexOf(n)===at),following=tail.slice(matched.length).trim();
        // A named observer, quoted speaker or relative is not the described subject.
        if(/^(?:的(?:妈妈|母亲|父亲|姐姐|妹妹|朋友|同事)|['’]s\s+(?:mother|father|sister|brother|friend)|(?:看见|看着|见到|望着|望向|发现|说|问|告诉)|(?:saw|sees|said|says|asked|noticed|looks? at|looked at)\b)/i.test(following))return [];
        return [tail.slice(0,Math.min(stop??300,300))];
    }).join('\n');
}
export function actorMatchProfile(old,{catalog,text='',otherNames=[],filters}={}){
    const original=catalog.normalizeQuery({kind:'character',required:old.initial_query?.required||{},preferred:old.initial_query?.preferred||{},required_tags:old.initial_query?.required_tags||[],preferred_tags:old.initial_query?.preferred_tags||[],exclude_tags:old.initial_query?.exclude_tags||[],archetypes:old.initial_query?.archetypes||[],preferred_archetypes:old.initial_query?.preferred_archetypes||[]});
    const required={...structuredClone(original.required),...(old.story_appearance?.traits||{})},tags=[...original.required_tags],sources={},warnings=[...(old.story_appearance?.warnings||[])];
    for(const [f,v]of Object.entries(required))sources[f]='剧情原始条件';
    for(const [f,v]of Object.entries(original.preferred))if(!required[f]){required[f]=v;sources[f]='剧情外貌偏好';}
    tags.push(...original.preferred_tags.filter(t=>physical.has(catalog.tagInfo(t)?.facet)));
    // A bound prototype can fill only basic appearance missing from the story.
    // Its extra ornaments, clothes or fantasy anatomy do not become story requirements.
    for(const tag of old.chosen_appearance_tags||[]){const m=catalog.tagInfo(tag);if(core.has(m?.facet)&&!required[m.facet]){required[m.facet]=[m.value];sources[m.facet]='当前固定形象';}}
    const described=extractAppearance(namedDescription(old,text,otherNames)+'\n'+(old.face_description||''),catalog);
    const grouped=new Map();for(const m of described){if(!grouped.has(m.facet))grouped.set(m.facet,new Set());grouped.get(m.facet).add(m.value);}
    for(const [f,vs]of grouped){
        if(!core.has(f)){for(const m of described.filter(m=>m.facet===f)){tags.push(m.tag);sources[m.tag]='剧情明确描述';}}
        else if(vs.size===1){const fixed=(old.chosen_appearance_tags||[]).map(t=>catalog.tagInfo(t)).filter(m=>m?.facet===f).map(m=>m.value);if(fixed.length&&!fixed.some(v=>vs.has(v)))warnings.push('档案'+(facetNames[f]||f)+'与剧情描述不同，本次按剧情筛选。所选形象先试画，满意后保存才更新档案。');required[f]=[...vs];sources[f]='剧情明确描述';}
        else warnings.push('剧情中有多种'+(facetNames[f]||f)+'描述，沿用档案条件；可在外貌条件中修正。');
    }
    if(filters!==undefined){
        const selected=String(filters).split(/[,，\n]/).map(t=>t.trim()).filter(Boolean);tags.length=0;for(const f of Object.keys(required))if(f!=='gender')delete required[f];
        for(const token of selected){const tag=catalog.canonicalTag?.(token),meta=tag&&catalog.tagInfo(tag);if(!meta||!physical.has(meta.facet))throw new Error('外貌条件无法识别：'+token+'。请使用下方条件中的标签。');if(core.has(meta.facet)){required[meta.facet]=[...(required[meta.facet]||[]),meta.value];sources[meta.facet]='本次指定';}else{tags.push(tag);sources[tag]='本次指定';}}
    }
    required.gender??=['female'];
    const preferred={};for(const tag of old.chosen_appearance_tags||[]){const m=catalog.tagInfo(tag);if(physical.has(m?.facet)&&!required[m.facet])preferred[m.facet]=[...(preferred[m.facet]||[]),m.value];}
    const query={kind:'character',required,required_tags:[...new Set(tags)],preferred,exclude_tags:original.exclude_tags,archetypes:original.archetypes,preferred_archetypes:original.preferred_archetypes,include_limited:true};
    const criteria=Object.entries(required).map(([facet,values])=>{const entries=values.map(value=>(catalog.appearanceTerms?.()||[]).find(m=>m.facet===facet&&m.value===value));return {facet,values,tags:entries.map((m,i)=>m?.tag||values[i]),label:entries.map((m,i)=>m?.label_zh||values[i]).join(' / '),source:sources[facet]||'剧情条件'};});
    for(const tag of query.required_tags){const m=catalog.tagInfo(tag);if(!criteria.some(c=>c.tags.includes(tag)))criteria.push({tags:[tag],facet:m.facet,values:[m.value],label:m.label_zh||tag,source:sources[tag]||'剧情条件'});}
    if(old.face_description&&!extractAppearance(old.face_description,catalog).length)warnings.push('脸部描述已保留；源库缺少对应标签，无法据此确认脸型匹配。');
    return {query,criteria,warnings,filters:criteria.filter(c=>c.facet!=='gender').flatMap(c=>c.tags).join(', '),age:old.age_description||''};
}
export function candidateEvidence(record,profile,catalog){
    return profile.criteria.map(c=>({...c,matched:c.values.some(v=>(record.facets[c.facet]||[]).includes(v))||c.tags.some(t=>record.tags.includes(t)),actual:(record.facets[c.facet]||[]).map(v=>(catalog.appearanceTerms?.()||[]).find(m=>m.facet===c.facet&&m.value===v)?.label_zh||v)}));
}
