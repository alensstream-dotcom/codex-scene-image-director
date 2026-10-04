import {applyOutfit,legacyOutfit,outfitTags} from './wardrobe-state.mjs';
import {usesPrototypeTrigger,usesImageReference} from './identity.mjs';
import {compileScene,validateConfirmedPrompt,sourceHash,proseOf} from './scene-planner.mjs';
import {findPerson,listActorCandidates,splitCharacterTags,sanitizeAppearanceText,narrativeGender} from './character-tools.mjs';
import {focusFrame} from './render-policy.mjs';
import {actorMatchProfile} from './appearance-profile.mjs';
import {separateRemovedProps} from './outfit-props.mjs';
import {reconcileStoryAppearance,narrativeAppearance} from './narrative-appearance.mjs';
export const narrativeOffset=(raw,at)=>proseOf(String(raw).slice(0,at)).replace(/\s+/g,' ').trim().length;
export const CAPTURE='ADCAP';
/** Keep source positions while excluding draft instructions and code examples. */
export function automaticSource(text){
    return String(text).replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,m=>' '.repeat(m.length))
        .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g,m=>' '.repeat(m.length));
}
export function readControl(text,kind=CAPTURE){
    const start=text.indexOf(kind);if(start<0)return null;let i=start+kind.length;while(/\s/.test(text[i]||'')&&i<text.length)i++;
    if(text[i]!=='{')return null;const begin=i;let depth=0,quoted=false,escaped=false;
    for(;i<text.length;i++){const c=text[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;continue;}if(c==='{')depth++;if(c==='}'&&--depth===0){const tail=text.slice(i+1).match(/^\s*END/);if(!tail)return null;return {value:JSON.parse(text.slice(begin,i+1)),start,end:i+1+tail[0].length};}}
    throw new Error('插图人物标记没有结束，请修正本图标签。');
}
export function validateCapture(value){
    if(value?.v!==2||typeof value.scene!=='string'||!value.scene.trim()||value.scene.length>1200||/[;{}$<>]/.test(value.scene)||!Array.isArray(value.people)||value.people.length>4)throw new Error('自动插图格式不完整。');
    const names=new Set();for(const actor of value.people){if(typeof actor?.name!=='string'||!actor.name.trim()||actor.name.length>120||/[;{}@$<>]/.test(actor.name)||['__proto__','constructor','prototype'].includes(actor.name)||names.has(actor.name))throw new Error('插图人物姓名无效或重复。');names.add(actor.name);if(typeof actor.action!=='string'||actor.action.length>1000||/[;{}@$<>]/.test(actor.action))throw new Error('人物动作标签无效。');}
    return value;
}
export function chooseStyle(person){
    return person.style_explicit?person.style:'model_default';
}
export function prepareCapture(capture,{state,resolver,catalog,id,messageId,swipeId=0,raw,start,end,priorOutfits={},appearanceContext}={}){
    validateCapture(capture);let staged=structuredClone(state);const actors=[],props=[];
    for(const actor of capture.people){
        const spec={person:actor.name,...actor.appearance};delete spec.clothing;delete spec.outfit;delete spec.id;
        const evidence=appearanceContext??proseOf(raw.slice(0,start)),names=capture.people.map(a=>a.name);
        const facts=narrativeAppearance({person:actor.name},evidence,catalog,names);spec.required={...spec.required,...facts.traits};if(facts.age)spec.age=parseInt(facts.age);
        const gender=narrativeGender(actor.name,proseOf(raw.slice(0,start)));if(gender&&!findPerson(staged.people,actor.name,staged.scope))spec.required={...spec.required,gender};
        const marker='ADEX'+JSON.stringify(spec)+'END';const result=resolver.resolvePrompt(marker,staged,{scope:staged.scope});staged={...staged,...result.state};
        const person=findPerson(staged.people,actor.name,staged.scope)?.[1];if(!person)throw new Error('人物形象未准备完成：'+actor.name);
        reconcileStoryAppearance(person,{text:evidence,catalog,names,spec});
        person.version??=1;person.accepted??=false;
        if(!person.style_chosen){person.style=chooseStyle(person);person.style_chosen=true;}
        const applied=applyOutfit(priorOutfits[person.person]||priorOutfits[actor.name]||legacyOutfit(person.wardrobe),actor.outfit),normalized=separateRemovedProps(applied,{person:actor.name,names:capture.people.map(a=>a.name),text:proseOf(raw.slice(0,start)).slice(-1800)}),outfit=normalized.outfit;props.push(...normalized.props);
        actors.push({person:person.person,source_name:actor.name,person_snapshot:structuredClone(person),outfit,wardrobe:{description:outfitTags(outfit).join(', '),tags:[]},action_prompt:sanitizeAppearanceText(actor.action,person,catalog),angle:actor.angle});
    }
    const scene=focusFrame({id,revision:1,message_id:messageId,swipe_id:swipeId,source_hash:sourceHash(raw),start,end,insertAt:end,excerpt:capture.summary||'',summary:capture.summary||capture.scene,composition:[capture.scene,...new Set(props)].join(', '),interactions:capture.interactions,actors,status:'saved',dimensions:capture.size||'704x1152',automatic:true,images:[],created_at:new Date().toISOString()});
    scene.appearance_contract_version=1;scene.actor_binding_version=1;scene.style=scene.actors[0]?.person_snapshot.style||'model_default';
    scene.confirmed_prompt=compileScene(scene,{...staged,people:Object.fromEntries(scene.actors.map(a=>[a.person,a.person_snapshot]))});
    validateConfirmedPrompt(scene.confirmed_prompt);return {scene,state:staged};
}
export function frameState(scene){return {version:1,scope:scene.actors[0]?.person_snapshot.scope||'',people:Object.fromEntries(scene.actors.map(a=>[a.person,a.person_snapshot]))};}
export function compileFrame(scene){return scene.confirmed_prompt?validateConfirmedPrompt(scene.confirmed_prompt):compileScene(scene,frameState(scene));}
/** Old presets can still emit native tags. Freeze those frames without another API call. */
export function prepareLegacyFrame(prompt,{state,id,messageId,swipeId=0,raw,start,end,priorOutfits={}}){
    const text=validateConfirmedPrompt(prompt),parts=text.split(';').map(p=>p.trim()).filter(Boolean);
    const excerpt=proseOf(raw.slice(0,start)).trim().slice(-1500);
    const names=Object.values(state.people||{}).filter(p=>p.scope===state.scope&&[p.person,...(p.aliases||[])].some(n=>excerpt.includes(n)));
    // A single bound person can be identified from surrounding prose. Ambiguous
    // legacy frames keep literal tags; no anonymous person is added to the cast.
    const actors=names.length===1?names.map(p=>{const outfit=priorOutfits[p.person]||legacyOutfit(p.wardrobe);return {person:p.person,source_name:p.person,person_snapshot:structuredClone(p),outfit,wardrobe:{description:outfitTags(outfit).join(', '),tags:[]},action_prompt:parts[1]?.replace(/^Character 1 Prompt\s*:\s*/i,'')||'visible posture and action described in scene'};}):[];
    const scene={id,revision:1,message_id:messageId,swipe_id:swipeId,source_hash:sourceHash(raw),start,end,insertAt:end,excerpt,summary:'兼容旧预设的剧情插图',composition:parts[0].replace(/^Scene Composition\s*:\s*/i,''),actors,status:'saved',dimensions:'704x1152',automatic:true,legacy_format:true,images:[],style:actors[0]?.person_snapshot.style||'model_default',created_at:new Date().toISOString()};
    scene.confirmed_prompt=actors.length?compileScene(scene,{...state,people:Object.fromEntries(actors.map(a=>[a.person,a.person_snapshot]))}):text;
    return {scene,state:structuredClone(state)};
}
export function priorOutfitsFor(story,{messageId,swipeId,offset,proseOffset,chat}){
    const position=proseOffset??narrativeOffset(chat?.[messageId]?.mes||'',offset);
    const hashes=new Map(),hash=id=>{if(!hashes.has(id))hashes.set(id,sourceHash(chat?.[id]?.mes||''));return hashes.get(id);};
    const events=Object.values(story.events||{}).filter(e=>e.message_id<=messageId&&e.swipe_id===(chat?.[e.message_id]?.swipe_id??(e.message_id===messageId?swipeId:0))&&e.source_hash===hash(e.message_id)&&(e.message_id<messageId||e.offset<=(e.offset_kind==='prose'?position:offset))).sort((a,b)=>a.message_id-b.message_id||a.offset-b.offset);
    const out={};for(const e of events)for(const actor of e.people)out[actor.name]=applyOutfit(out[actor.name],actor.outfit);return out;
}
export function rerollActor(scene,name,{resolver,catalog,state,candidateId,manualTags,relax=false,text='',filters}){
    const next=structuredClone(scene),index=next.actors.findIndex(a=>a.person===name);if(index<0)throw new Error('请选择本图人物。');
    const old=next.actors[index].person_snapshot,listed=listActorCandidates(old,{catalog,state,relax,text,filters,seed:crypto.randomUUID()});
    const record=candidateId&&candidateId!=='manual_tags'?catalog.get(candidateId):listed.candidates.find(c=>c.id!==old.prototype_id)&&catalog.get(listed.candidates.find(c=>c.id!==old.prototype_id).id);if(!manualTags&&!record)throw new Error('没有其它精确匹配。请在候选选择中扩大范围或导入自己的完整人物串。');
    if(record&&catalog.isExcluded?.(record.id))throw new Error('此形象已从你的角色库删除，请先恢复再选择。');
    if(record&&!record.facets?.gender?.includes('female')&&catalog.get?.(record.id)?.facets?.gender?.includes('male'))throw new Error('重抽形象使用女性人物库。');
    const profile=actorMatchProfile(old,{catalog,text,filters,otherNames:Object.values(state.people||{}).map(p=>p.person)});
    if(record&&!manualTags&&!relax&&!catalog.hasMatch(record.id,profile.query))throw new Error('所选角色不符合当前剧情外貌条件，请重新筛选，或明确扩大范围。');
    const draft=structuredClone(state);const key=Object.entries(draft.people).find(([,p])=>p.person===name)?.[0];if(key)delete draft.people[key];
    const required=relax?{gender:'female'}:profile.query.required,resolved=resolver.resolvePrompt('ADEX'+JSON.stringify({person:name,required,required_tags:relax?[]:profile.query.required_tags,...(record?{id:record.id}:{})})+'END',draft,{scope:draft.scope});
    const person=findPerson(resolved.state.people,name)?.[1];if(manualTags){const parsed=splitCharacterTags(manualTags,catalog);person.prototype_id=record?.id||null;person.prototype_trigger=parsed.trigger;person.chosen_appearance_tags=parsed.appearance;person.artist_tags=parsed.artists;person.source_tag_string=manualTags;person.trigger_enabled=!!parsed.trigger;}
    person.accepted=false;person.version=(old.version||1)+1;person.rejected_ids=[...(old.rejected_ids||[]),old.prototype_id].filter(Boolean).slice(-20);person.age_description=old.age_description;person.face_description='';person.trigger_enabled=manualTags?person.trigger_enabled:!!record;person.exact_id=false;person.reference_enabled=usesImageReference(old);person.style=old.style_explicit?old.style:'model_default';person.style_chosen=true;person.style_explicit=old.style_explicit;person.aliases=old.aliases||[];delete person.reference_ids;
    person.initial_query=structuredClone(profile.query);person.matching_profile=profile;reconcileStoryAppearance(person,{text,catalog,names:Object.values(state.people||{}).map(p=>p.person),spec:{required:profile.query.required}});next.actors[index].person_snapshot=person;next.style=next.actors[0]?.person_snapshot.style||next.style;delete next.confirmed_prompt;next.confirmed_prompt=compileScene(next,frameState(next));return next;
}
