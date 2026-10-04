import {actorMatchProfile,candidateEvidence} from './appearance-profile.mjs';
const norm=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim();
export function findPerson(people,name,scope){
    const entries=Object.entries(people||{}).filter(([,p])=>scope===undefined||p.scope===scope),n=norm(name);
    const exact=entries.filter(([,p])=>[p.person,...(p.aliases||[])].map(norm).includes(n));
    if(exact.length===1)return exact[0];
    if(exact.length>1)return entries.find(([,p])=>norm(p.person)===n)||null;
    // A unique abbreviated Chinese name can reuse a full name; ambiguous names never merge.
    if(!/^[\p{Script=Han}]{2,8}$/u.test(n))return null;
    const matches=entries.filter(([,p])=>[p.person,...(p.aliases||[])].some(v=>/^[\p{Script=Han}]{2,8}$/u.test(norm(v))&&(norm(v).endsWith(n)||n.endsWith(norm(v)))));
    return matches.length===1?matches[0]:null;
}
export function artistTags(values=[]){
    if(!Array.isArray(values)||values.length>8)throw new Error('画师标签最多 8 个。');
    return [...new Set(values.map(v=>{const t=norm(String(v??'').replace(/[\u200b\u2060\ufeff]/g,''));if(!/^@[\p{L}\p{N}_ .()\-]{1,90}$/u.test(t)||/^@(style|character)\b/i.test(t))throw new Error('画师格式请使用 @画师名，不能包含控制标签或路径。');return t;}))];
}
export function narrativeGender(name,text){
    for(const sentence of String(text||'').split(/[。！？!?;\n]/)){
        const at=sentence.indexOf(name);if(at<0)continue;const after=sentence.slice(at+name.length).trim();
        if(!/^(?:是|为|作为|is\b)/i.test(after))continue;
        const definition=after.split(/[,，]/)[0].slice(0,60),female=/女性|女人|女孩|女子|女同事|女朋友|\b(?:female|woman|girl)\b/i.test(definition),male=/男性|男人|男孩|男子|男同事|男朋友|\b(?:male|man|boy)\b/i.test(definition);
        if(female!==male)return female?'female':'male';
    }return null;
}
export function splitCharacterTags(value,catalog){
    if(typeof value!=='string'||value.length>6000||/[;{}$<>\x00-\x1f]/.test(value)||/\b(?:ADEX|ADSCENE|ADCAP)\b/.test(value))throw new Error('请粘贴纯人物 tags，不能包含图片按钮或控制代码。');
    const tags=[...new Set(value.split(',').map(norm).filter(Boolean))],appearance=[],outfit=[],trigger=[],artists=[];
    for(const tag of tags){const meta=catalog.tagInfo(tag);if(tag.startsWith('@'))artists.push(tag);else if(meta?.section==='outfit'||meta?.section==='accessory')outfit.push(tag);else if(meta?.section==='appearance'||meta?.facet==='gender'||meta?.facet==='species')appearance.push(tag);else trigger.push(tag);}
    if(!appearance.length)throw new Error('人物串需要头发、眼睛等外貌标签；可直接复制 Animadex 的完整串。');
    return {tags,appearance,outfit,trigger:trigger.join(', '),artists:artistTags(artists)};
}
export function listActorCandidates(old,{catalog,state,query='',relax=false,seed='picker',offset=0,limit=24,text='',filters}={}){
    if(old.chosen_appearance_tags?.includes('1boy'))throw new Error('男性配角使用剧情外貌，不从女性原型库重抽；可在人物档案编辑。');
    const other=Object.values(state.people||{}).filter(p=>p.person!==old.person).map(p=>p.prototype_id).filter(Boolean);
    const profile=actorMatchProfile(old,{catalog,text,otherNames:Object.values(state.people||{}).map(p=>p.person),filters});
    const base={...profile.query,seed,exclude_ids:other,include_limited:true,strict_appearance:!!old.story_appearance&&!relax};
    let mode='strict',notice='全部剧情外貌条件取交集；符合条件的角色全部可翻页查看，相似度优先。',result;
    if(relax){base.preferred={...base.preferred,...base.required};base.required={gender:'female'};base.preferred_tags=[...(base.preferred_tags||[]),...(base.required_tags||[])];base.required_tags=[];base.preferred_archetypes=[...(base.preferred_archetypes||[]),...(base.archetypes||[])];base.archetypes=[];mode='broader';notice='已按你的选择扩大到女性库；原外貌条件作为偏好，选中后会更换形象。';}
    const words=norm(query).toLowerCase();
    if(words){const remaining=[];for(const word of words.split(/[,，]/).map(w=>w.trim()).filter(Boolean)){const tag=catalog.canonicalTag(word);if(tag)base.required_tags=[...(base.required_tags||[]),tag];else remaining.push(word);}if(remaining.length)base.text=remaining.join(', ');}result=catalog.matches(base,{offset,limit});
    const candidates=result.results.map(r=>{const record=catalog.get(r.id),evidence=candidateEvidence(record,profile,catalog);return {id:r.id,name:r.name||r.id,series:r.series||'',tags:record.source_tag_string||[r.prepared?.prototype_trigger,...record.tags].filter(Boolean).join(', '),match:r.matched_preferences,evidence,score:r.score,source_ambiguity:r.source_ambiguity,current:r.id===old.prototype_id,relaxed:relax,preview:record.preview_url||null,preview_full:record.preview_full_url||record.preview_url||null,popularity:record.source_count||0};});
    if(!candidates.length)notice=words?'没有匹配的搜索结果；可修改关键词或粘贴自己的完整人物串。':'当前条件只有原形象或没有其它匹配；可以明确扩大范围，或粘贴自己的完整人物串。';
    return {candidates,mode,notice,canRelax:!relax,required:base.required,candidate_count:result.total,total:result.total,offset:result.offset,limit:result.limit,has_more:result.has_more,profile};
}
export function sanitizeAppearanceText(text,person,catalog){
    const locked=new Set(person.chosen_appearance_tags||[]);
    return String(text||'').split(',').map(t=>t.trim()).filter(t=>{const info=catalog?.tagInfo(t);return !info||!['hair_color','hair_length','hair_style','eye_color','build','bust','skin'].includes(info.facet)||locked.has(t);}).join(', ');
}
