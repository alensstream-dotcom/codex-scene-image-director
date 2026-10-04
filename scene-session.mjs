/** Scene preparation is staged; callers commit only after checking the chat/message. */
import { mergeFlashControls } from './flash-assistant.mjs';
import { wardrobeText } from './wardrobe.mjs';
import { contextAt, sourceHash, compileScene, SCENE_KEY } from './scene-planner.mjs';
import { readDatabasePeople } from './database-bridge.mjs';

export const CAST_KEY='animadex_cast_v1';
export const STYLE_NAMES={painterly:'细腻插画',mikko:'柔和绘画',bluearchive:'清透动画',rdbt:'复古日漫',pc98:'像素复古'};
export function initializeScenes(metadata) {
    return metadata[SCENE_KEY]??={version:1,scenes:{},messages:{}};
}
export function sceneIsCurrent(scene,message) {
    return !!message&&sourceHash(message.mes)===scene.source_hash&&(scene.swipe_id??message.swipe_id??0)===(message.swipe_id??0);
}
export function sceneRevision(scene,revision=1){return scene?.revision===revision?scene:(scene?.history || []).find(s=>s.revision===revision);}
export function commitState(previous,staged,{historical=false,scenes}={}) {
    const next=structuredClone(staged);
    if(scenes){
        const included=new Set(scenes.flatMap(s=>(s.actors || []).map(a=>a.person)));
        for(const [id,person]of Object.entries(next.people || {})){
            const old=previous.people?.[id];
            if(!old&&!included.has(person.person)){delete next.people[id];continue;}
            if(old)person.wardrobe=structuredClone(old.wardrobe);
        }
        for(const scene of [...scenes].sort((a,b)=>a.insertAt-b.insertAt))for(const actor of scene.actors || []){
            const entry=Object.entries(next.people).find(([,p])=>p.person===actor.person&&p.scope===next.scope);
            if(entry&&(!historical||!previous.people?.[entry[0]]))entry[1].wardrobe=structuredClone(actor.wardrobe);
        }
        return next;
    }
    if(historical)for(const [key,old]of Object.entries(previous.people || {})){
        if(next.people[key])next.people[key].wardrobe=structuredClone(old.wardrobe);
    }
    return next;
}
export async function prepareScenes(planned,{chat,messageId,state,resolver,fetcher=fetch,signal,databaseReader=readDatabasePeople,historical=false}) {
    const raw=String(chat[messageId]?.mes || '');
    let staged=structuredClone(state);
    const scenes=[];
    for(const candidate of planned){
        signal?.throwIfAborted();
        const scene={...structuredClone(candidate),id:'sc_'+crypto.randomUUID().replace(/-/g,''),revision:1,swipe_id:chat[messageId]?.swipe_id??0,message_id:messageId,source_hash:sourceHash(raw),actors:[],status:'draft',created_at:new Date().toISOString()};
        if(!candidate.environment_only){
            const controls=candidate.people.map(person=>({person}));
            const names=new Set(candidate.people);
            const current_people=Object.values(staged.people || {}).filter(p=>p.scope===staged.scope&&names.has(p.person)).map(p=>({person:p.person,appearance:p.chosen_appearance_tags,face_description:p.face_description || '',current_outfit:wardrobeText(p.wardrobe)}));
            const unbound=controls.filter(c=>!current_people.some(p=>p.person===c.person)).map(c=>c.person);
            let reference={people:[],status:'unavailable'};
            try{reference=databaseReader(unbound,{historical});}catch{reference={people:[],status:'read_failed'};}
            const response=await fetcher('http://127.0.0.1:8189/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene:candidate.excerpt,story:contextAt(chat,messageId,candidate.end),controls,current_people,reference_people:reference.people,scene_bound:true}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
            if(!response.ok)throw new Error('人物抽取 HTTP '+response.status+'；选段已保留，可以重试。');
            const data=await response.json();
            if(!Array.isArray(data.people))throw new Error('人物抽取格式不正确，请重试。');
            const depicted=[...new Map(data.people.filter(p=>p&&names.has(p.person)).map(p=>[p.person,p])).values()];
            if(!depicted.length){if(data.environment_only!==true)throw new Error('没有确认画面人物；请缩小选段或重试。');scene.environment_only=true;scene.composition=String(data.scene_composition || 'empty room, neutral atmosphere');}
            else {
                if(depicted.length!==controls.length)throw new Error('画面人物抽取不完整，请缩小选段或重试。');
                const markers=controls.map(p=>'ADEX'+JSON.stringify(p)+'END').join(' ');
                const merged=mergeFlashControls(markers,{people:depicted},staged);
                const result=resolver.resolvePrompt(merged.text,staged,{scope:staged.scope});
                staged={...staged,...result.state,scope:staged.scope};
                for(const actor of depicted){
                    const person=Object.values(staged.people).find(p=>p.person===actor.person&&p.scope===staged.scope);
                    if(!person)throw new Error('人物形象未能保存：'+actor.person);
                    if(reference.people.some(p=>p.person===actor.person))person.reference_source='SP数据库';
                    scene.actors.push({person:actor.person,action_prompt:String(actor.action_prompt || '').slice(0,700),angle:actor.angle,wardrobe:structuredClone(person.wardrobe)});
                }
                scene.composition=String(data.scene_composition || scene.composition).slice(0,700);
            }
        }
        scene.style=scene.actors.length?Object.values(staged.people).find(p=>p.person===scene.actors[0].person&&p.scope===staged.scope)?.style || 'painterly':'painterly';
        // Compilation at this point checks missing records; it never sends a GPU job.
        scene.compiled_preview=compileScene(scene,staged);
        scenes.push(scene);
    }
    return {state:staged,scenes};
}
