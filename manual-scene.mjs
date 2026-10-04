import {mergeFlashControls} from './flash-assistant.mjs';
import {wardrobeText} from './wardrobe.mjs';
import {proseOf,proseRange,contextAt,sourceHash,compileScene} from './scene-planner.mjs';
import {applyOutfit,outfitText,legacyOutfit} from './wardrobe-state.mjs';
import {chooseStyle} from './automatic-scene.mjs';
import {findPerson,narrativeGender} from './character-tools.mjs';
import {focusFrame} from './render-policy.mjs';
import {reconcileStoryAppearance,narrativeAppearance,storyContext} from './narrative-appearance.mjs';
import {normalizeManualResult} from './manual-result.mjs';

export async function requestManualFlash(payload,{fetcher=fetch,signal,requester}={}){
    if(requester)return requester(payload,{signal});
    let response;
    try{response=await fetcher('http://127.0.0.1:8189/manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});}
    catch(error){if(signal?.aborted)throw error;throw new Error(error.name==='TimeoutError'?'选段整理超时，请稍后点击重新生成。':'选段助手未连接，请运行「启动绘图助手」后点击重新生成。');}
    if(!response.ok)throw new Error(response.status===404?'选段助手尚未更新，请重启助手后重试。':response.status===429?'选段助手正在处理上一段，请稍后点击重新生成。':'选段整理失败（HTTP '+response.status+'），原有 tags 已保留，请点击重新生成。');
    return response.json();
}

/** The user's selection is the scene. One model call, then local catalog expansion. */
export async function prepareManualScene(snapshot,{chat,state,resolver,fetcher=fetch,requester,signal,wardrobeSchema=1,correction='',priorOutfits={}}={}){
    signal?.throwIfAborted();
    const {raw,selected,messageId}=snapshot;
    if(!selected||!proseRange(raw,selected.start,selected.end))throw new Error('请选择同一条消息里的剧情正文。');
    const excerpt=proseOf(raw.slice(selected.start,selected.end)).trim();
    if(!excerpt||excerpt.length>6000)throw new Error('请选择 6000 字以内的一段剧情。');
    const before=contextAt(chat,messageId,selected.start).slice(-2200);
    const current_people=Object.values(state.people || {}).filter(p=>p.scope===state.scope&&(before+'\n'+excerpt).includes(p.person)).slice(0,8)
        .map(p=>({person:p.person,appearance:p.chosen_appearance_tags,face_description:p.face_description || '',current_outfit:wardrobeText(p.wardrobe),...(wardrobeSchema===2&&priorOutfits[p.person]?{outfit:priorOutfits[p.person]}:{})}));
    const value=await requestManualFlash({scene:excerpt,story:before,current_people,...(wardrobeSchema===2?{wardrobe_schema:2,correction}:{})},{fetcher,requester,signal});signal?.throwIfAborted();
    const data=normalizeManualResult(value,{excerpt});
    const allowedText=before+'\n'+excerpt,depicted=[],seen=new Set();
    const appearanceContext=storyContext(chat,messageId,selected.end,proseOf);
    for(const actor of data.people){
        if(!actor||typeof actor.person!=='string'||!actor.person.trim()||actor.person.length>120||!allowedText.includes(actor.person)||['__proto__','constructor','prototype'].includes(actor.person)||/[;{}@$<>]/.test(actor.person))throw new Error('无法确认画面人物，请把姓名或此前一句一起选中。');
        if(seen.has(actor.person))throw new Error('选段接口重复返回了同一人物，请重新生成。');
        seen.add(actor.person);depicted.push(actor);
        const gender=narrativeGender(actor.person,allowedText);if(gender)actor.required={...actor.required,gender:[gender]};
    }
    if(!depicted.length&&data.environment_only!==true)throw new Error('没有确认画面人物，请扩大选段后重试。');
    let staged=structuredClone(state);
    const scene={id:'sc_'+crypto.randomUUID().replace(/-/g,''),revision:1,manual:true,start:selected.start,end:selected.end,insertAt:selected.end,anchor:raw.slice(selected.start,selected.end),excerpt,message_id:messageId,swipe_id:snapshot.swipeId??0,source_hash:sourceHash(raw),summary:data.summary.trim().slice(0,1000),composition:data.scene_composition.slice(0,700),interactions:data.interactions,actors:[],environment_only:data.environment_only===true,status:'draft',created_at:new Date().toISOString()};
    if(depicted.length){
        const markers=depicted.map(p=>'ADEX'+JSON.stringify({person:p.person})+'END').join(' ');
        for(const p of depicted){const facts=narrativeAppearance({person:p.person},appearanceContext,resolver.catalog||null,depicted.map(a=>a.person));p.required={...p.required,...facts.traits};if(facts.age)p.age=parseInt(facts.age);}
        const merged=mergeFlashControls(markers,{people:depicted},staged);
        const result=resolver.resolvePrompt(merged.text,staged,{scope:staged.scope});
        staged={...staged,...result.state,scope:staged.scope};
        for(const actor of depicted){
            const person=findPerson(staged.people,actor.person,staged.scope)?.[1];
            if(!person)throw new Error('人物形象未能准备：'+actor.person);
            reconcileStoryAppearance(person,{text:appearanceContext,catalog:resolver.catalog,names:depicted.map(a=>a.person),spec:actor});
            if(wardrobeSchema===2&&!person.style_chosen){person.style=chooseStyle(person);person.style_chosen=true;}
            const outfit=wardrobeSchema===2?applyOutfit(priorOutfits[actor.person]||legacyOutfit(person.wardrobe),actor.outfit):null;
            scene.actors.push({person:person.person,source_name:actor.person,person_snapshot:structuredClone(person),action_prompt:String(actor.action_prompt || '').slice(0,700),angle:actor.angle,wardrobe:outfit?{description:outfitText(outfit),tags:[]}:structuredClone(person.wardrobe),...(outfit?{outfit}:{})});
        }
    }
    scene.style=scene.actors.length?Object.values(staged.people).find(p=>p.person===scene.actors[0].person&&p.scope===staged.scope)?.style || 'model_default':'model_default';
    const focused=focusFrame(scene);focused.appearance_contract_version=1;focused.actor_binding_version=1;focused.confirmed_prompt=compileScene(focused,staged);
    return {scene:focused,state:staged,meta:data.meta};
}
