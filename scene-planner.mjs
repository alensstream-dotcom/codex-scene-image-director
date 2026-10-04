/** Paragraph-bound illustrations. IDs and wardrobe snapshots survive regeneration. */
import {usesPrototypeTrigger} from './identity.mjs';
import {artistTags} from './character-tools.mjs';
export const SCENE_KEY='animadex_scenes_v1';
export const sceneMarker=(id,revision=1)=>'ADSCENE'+JSON.stringify({id,rev:revision})+'END';
export const scenePrompt=(id,revision=1)=>sceneMarker(id,revision)+';';
export function readSceneControl(text) {
    const m=String(text).match(/ADSCENE\s*(\{[^{}]*\})END/);if(!m)return null;
    try{const value=JSON.parse(m[1]);return typeof value.id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)&&Object.keys(value).every(k=>['id','rev'].includes(k))&&Number.isInteger(value.rev??1)&&(value.rev??1)>0?{id:value.id,revision:value.rev??1}:null;}catch{return null;}
}
export function readSceneMarker(text) {
    return readSceneControl(text)?.id || null;
}
export function proseOf(text,{legacyOrder=false}={}) {
    const raw=String(text||''),reasoning=/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
    return (legacyOrder?raw:raw.replace(reasoning,'')).replace(/image###[\s\S]*?###/g,'')
        .replace(/<!--\s*ADMEM[\s\S]*?END\s*-->/g,'')
        .replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
        .replace(/<details\b[\s\S]*?<\/details>/gi,'')
        .replace(/\{\{\s*(?:思考内容|正文内容)\s*\}\}/g,'')
        .replace(/☆\s*插图规划[\s\S]*/g,'')
        .replace(/<(?:AVS|Status_?Block|status)\b[\s\S]*$/gi,'');
}
const fingerprint=text=>{let hash=2166136261;for(const c of text)hash=Math.imul(hash^c.charCodeAt(0),16777619);return (hash>>>0).toString(16);};
export const sourceHash=text=>fingerprint(proseOf(text).replace(/\s/g,''));
export const legacySourceHash=text=>fingerprint(proseOf(text,{legacyOrder:true}).replace(/\s/g,''));
/** Restored library revisions must match existing buttons in the unchanged reply. */
export function restoredSceneMessages(story,chat){
    const changes=[];
    for(const [messageId,message]of chat.entries()){
        if(message.is_user||message.is_system)continue;
        const raw=String(message.mes||''),hash=sourceHash(raw),swipe=message.swipe_id??0;
        const nextMessage=raw.replace(/image###([\s\S]*?)###/g,(block,content)=>{
            const control=readSceneControl(content),scene=control&&story.scenes[control.id];
            if(!scene||scene.message_id!==messageId||scene.swipe_id!==swipe||scene.source_hash!==hash||control.revision===scene.revision)return block;
            return 'image###'+scenePrompt(scene.id,scene.revision)+'###';
        });
        if(nextMessage!==raw)changes.push({messageId,raw,nextMessage});
    }
    return changes;
}
export function proseRange(raw,start,end) {
    const masked=String(raw).replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,m=>' '.repeat(m.length))
        .replace(/image###[\s\S]*?###/g,m=>' '.repeat(m.length))
        .replace(/<!--\s*ADMEM[\s\S]*?END\s*-->/g,m=>' '.repeat(m.length))
        .replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,m=>' '.repeat(m.length))
        .replace(/<details\b[\s\S]*?<\/details>/gi,m=>' '.repeat(m.length))
        .replace(/\{\{\s*(?:思考内容|正文内容)\s*\}\}/g,m=>' '.repeat(m.length))
        .replace(/☆\s*插图规划[\s\S]*/g,m=>' '.repeat(m.length))
        .replace(/<(?:AVS|Status_?Block|status)\b[\s\S]*$/gi,m=>' '.repeat(m.length));
    return masked.slice(start,end)===String(raw).slice(start,end)&&masked.slice(start,end).trim().length>0;
}
export function locateExcerpt(raw,quote,{prefix=''}={}) {
    if(!quote || !String(quote).trim())throw new Error('请先选中剧情文字。');
    const all=[];let from=0,index;
    while((index=raw.indexOf(quote,from))>=0){all.push(index);from=index+quote.length;}
    if(all.length===1)return {start:all[0],end:all[0]+quote.length};
    if(all.length>1){const hit=all.find(i=>prefix&&raw.slice(Math.max(0,i-prefix.length),i).endsWith(prefix));if(hit!==undefined)return {start:hit,end:hit+quote.length};throw new Error('这段文字重复出现，请扩大选段，包含一句前后文。');}
    // Rendering may remove Markdown or HTML. Map normalized visible characters
    // back to source offsets, rather than silently selecting the whole reply.
    const chars=[],offsets=[];let inTag=false;
    for(let i=0;i<raw.length;i++){
        const c=raw[i];if(c==='<'){inTag=true;continue;}if(inTag){if(c==='>')inTag=false;continue;}
        if(/\s|[*_`#]/.test(c))continue;chars.push(c);offsets.push(i);
    }
    const target=String(quote).replace(/\s|[*_`#]/g,'');const normalized=chars.join('');
    if(!target)throw new Error('请选择含有剧情文字的段落。');
    const hit=normalized.indexOf(target);
    if(hit<0||normalized.indexOf(target,hit+1)>=0)throw new Error('无法唯一定位选中的段落，请改选一整段正文。');
    return {start:offsets[hit],end:offsets[hit+target.length-1]+1};
}
export function contextAt(chat,messageId,end) {
    const recent=chat.slice(Math.max(0,messageId-2),messageId).map(m=>proseOf(m.mes));
    recent.push(proseOf(String(chat[messageId]?.mes || '').slice(0,end)));
    return recent.join('\n').slice(-8500);
}
export function validatePlan(response,raw,{selected=null,maxScenes=3}={}) {
    if(!Array.isArray(response?.scenes))throw new Error('场景规划没有返回图片节点。');
    const accepted=[],seen=new Set();
    for(const candidate of response.scenes.slice(0,8)) {
        if(candidate?.renderable===false)continue;
        if(typeof candidate?.anchor!=='string'||!candidate.anchor.trim())continue;
        let location;
        try{location=selected?locateExcerpt(raw.slice(selected.start,selected.end),candidate.anchor):locateExcerpt(raw,candidate.anchor);if(selected){location.start+=selected.start;location.end+=selected.start;}}catch{continue;}
        if(!proseRange(raw,location.start,location.end))continue;
        const names=[...new Set((Array.isArray(candidate.people)?candidate.people:[]).filter(n=>typeof n==='string'&&n.trim()&&proseOf(raw.slice(0,location.end)).includes(n.trim())).map(n=>n.trim()))].slice(0,4);
        if(!names.length&&candidate.environment_only!==true)continue;
        const key=location.end;
        if(seen.has(key))continue;seen.add(key);
        const floor=selected?.start??0;
        const boundary=raw.lastIndexOf('\n\n',location.start);
        let start=Math.max(floor,boundary<0?0:boundary+2);
        if(typeof candidate.start_quote==='string'&&candidate.start_quote.trim()){
            try{const found=locateExcerpt(raw.slice(floor,location.end),candidate.start_quote);start=floor+found.start;if(!proseRange(raw,start,floor+found.end))continue;}catch{continue;}
        }
        if(location.end-start>2000)start=Math.max(floor,location.start);
        const end=location.end;
        accepted.push({anchor:candidate.anchor,start,end,insertAt:location.end,excerpt:proseOf(raw.slice(start,end)),people:candidate.environment_only===true?[]:names,composition:String(candidate.composition || '').slice(0,700),reason:String(candidate.reason || '').slice(0,80),environment_only:candidate.environment_only===true});
    }
    accepted.sort((a,b)=>a.insertAt-b.insertAt);
    if(!accepted.length)throw new Error('未找到能准确定位的可绘制片段；请选择具体人物动作或环境段落。');
    return accepted.slice(0,Math.max(1,Math.min(4,maxScenes)));
}
export async function planScenes(raw,{selected=null,maxScenes=3,fetcher=fetch,signal}={}) {
    const text=selected?raw.slice(selected.start,selected.end):proseOf(raw);
    if(text.length>8500)throw new Error('本条正文超过 8500 字，请用选段生图。');
    const response=await fetcher('http://127.0.0.1:8189/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene:text,story:'',max_scenes:selected?1:maxScenes,manual:!!selected}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('场景规划 HTTP '+response.status);
    const data=await response.json();
    return {scenes:validatePlan(data,raw,{selected,maxScenes:selected?1:maxScenes}),meta:data.meta};
}
export function insertSceneButtons(raw,scenes) {
    let result=raw;
    for(const scene of [...scenes].sort((a,b)=>b.insertAt-a.insertAt)) {
        result=result.slice(0,scene.insertAt)+'\n\nimage###'+scenePrompt(scene.id,scene.revision)+'###\n\n'+result.slice(scene.insertAt);
    }
    return result;
}

export function validateConfirmedPrompt(value){
    if(typeof value!=='string'||!value.trim()||value.length>16000)throw new Error('请填写 16000 字以内的图片 tags。');
    const text=value.trim();
    if(!text.endsWith(';'))throw new Error('请保留每段 tags 末尾的分号，智绘姬需要它识别人物。');
    if(/###|\b(?:ADEX|ADSCENE)\b|[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))throw new Error('图片 tags 不能包含按钮或人物控制代码。');
    if(!/^Scene Composition\s*:/i.test(text))throw new Error('请保留开头的 Scene Composition: 格式。');
    const parts=text.split(';').map(p=>p.trim()).filter(Boolean);
    if(!parts.length||!/^Scene Composition\s*:\s*\S/i.test(parts[0]))throw new Error('镜头与环境 tags 不能为空。');
    for(let i=1;i<parts.length;i++)if(!new RegExp('^Character '+i+' Prompt:\\s*\\S','i').test(parts[i])||i>4)throw new Error('人物 tags 请使用连续的 Character 1 Prompt: 格式，并保留分号。');
    return text;
}
import {compactTags,compactActor,bindActorAppearance} from './compact-prompt.mjs';
export function compileScene(scene,state,{style}={}) {
    if(scene.manual&&scene.confirmed_prompt!==undefined)return validateConfirmedPrompt(scene.confirmed_prompt);
    const clean=value=>String(value || '').replace(/[;$@{}<>]/g,' ').replace(/\s+/g,' ').trim();
    const permanent=/^(?:(?:very|absurdly)\s+)?(?:(?:long|short|medium|black|white|blonde|brown|red|green|blue|purple|silver|pink|grey|gray|aqua|orange)\s+){1,3}(?:hair|eyes)$|^(?:small|medium|large|huge) breasts$|^(?:ponytail|twintails|bob cut|hair bun|slender|muscular)$/i;
    const transient=value=>clean(value).split(',').map(t=>t.trim()).filter(t=>!permanent.test(t)).join(', ');
    const concise=scene.actors?.some(a=>a.person_snapshot?.story_appearance)||Object.values(state.people||{}).some(p=>p.story_appearance);
    const rawComposition=(scene.actors?.length?transient:clean)(scene.composition || 'story illustration, soft natural lighting');
    const composition=concise?compactTags(rawComposition,{kind:'scene',limit:8}):rawComposition;
    const bindPair=scene.actors?.length===2&&scene.actors.every(a=>!a.partner_rendering||a.partner_rendering.visibility==='full');
    const actors=(scene.actors || []).map((actor,index)=>{
        const person=Object.values(state.people || {}).find(p=>p.person===actor.person&&p.scope===state.scope);
        if(!person)throw new Error('场景人物没有已保存的形象：'+actor.person);
        const back=/from (?:behind|back)|back view/.test(actor.angle || scene.composition || '');
        const partial=actor.partner_rendering&&actor.partner_rendering.visibility!=='full';
        const tags=[...(partial?(person.chosen_appearance_tags||[]).filter(t=>/^(?:1boy|1girl|adult|male|female|man|woman)$/.test(t)):person.chosen_appearance_tags || []),person.age_description,partial||back||person.story_appearance&&!person.face_explicit?'':person.face_description];
        if(usesPrototypeTrigger(person)&&person.prototype_trigger&&!person.chosen_appearance_tags?.includes('1boy'))tags.unshift(person.prototype_trigger);
        const wardrobe=actor.wardrobe;
        let clothing=[wardrobe?.description,...(wardrobe?.tags || [])].filter(Boolean);if(partial)clothing=clothing.flatMap(t=>String(t).split(',')).filter(t=>! /\b(?:trousers|pants|jeans|skirt|shoes|boots|socks|legwear|shorts)\b/i.test(t));
        const action=transient(actor.action_prompt).split(',').filter(t=>!actor.interaction_prompt||! /\b(?:hugging (?:her|him)self|self.hugging|embracing (?:her|him)self|holding (?:her|his|their) own hand|hands clasped together|solo)\b/i.test(t)).join(', '),rendering=actor.partner_rendering;
        const visible=rendering?(rendering.view==='pov'?'first person viewer, ':'supporting partner, ')+({hands:'only hands visible',arms:'only arms and hands visible',torso:'arms and clothed torso visible',full:'full supporting figure visible'}[rendering.visibility]||'')+(rendering.hide_face?', face out of frame':''):'';
        return {person,prompt:person.story_appearance?(bindPair?bindActorAppearance(person,tags.filter(Boolean),clothing,action,actor.interaction_prompt,{position:index===0?'left':'right'}):compactActor(tags.filter(Boolean),clothing,action,actor.interaction_prompt,visible)):[...new Set([...tags,...clothing,action,actor.interaction_prompt,visible].filter(Boolean).map(clean))].join(', ')};
    });
    const chosen=style || scene.style || actors[0]?.person.style || 'model_default';
    const safeStyle=['model_default','painterly','mikko','bluearchive','rdbt','pc98'].includes(chosen)?chosen:'model_default';
    const dimensions=['704x1152','896x896','1152x704'].includes(scene.dimensions)?scene.dimensions:'704x1152';
    const character=actors.length===1&&actors[0].person.exact_id&&actors[0].person.prototype_id==='nilou_(genshin_impact)'?'@character:Nilou':'';
    // Already expanded before transport. No native role/outfit manager is needed.
    const artists=artistTags([...new Set(actors.flatMap(a=>a.person.artist_tags||[]))]);
    return 'Scene Composition: '+['SFW',composition,...artists,'@style:'+safeStyle,character,dimensions].filter(Boolean).join(', ')+'; '+actors.map((actor,i)=>`Character ${i+1} Prompt: ${actor.prompt};`).join(' ');
}
