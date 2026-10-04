/** User-authorized limited extraction; catalog and API credential stay local. */
import { readIdentityControls } from './identity.mjs';
import { wardrobeText } from './wardrobe.mjs';
const FIELDS=new Set(['gender','height','age_group','hair_color','hair_length','hair_style','eye_color','skin','build','bust','species','ears']);
const clean = value => typeof value==='string' && value.length<=700 && !/[;{}@<>]/.test(value) ? value.replace(/\s+/g,' ').trim() : '';
function facets(value) {
    if (!value || typeof value!=='object' || Array.isArray(value)) return {};
    const aliases={violet:'purple',hazel:'brown',gray:'grey',turquoise:'aqua',auburn:'brown'};
    return Object.fromEntries(Object.entries(value).map(([key,raw])=>[key,typeof raw==='string'?[raw]:raw])
        .filter(([key,list])=>FIELDS.has(key)&&Array.isArray(list)&&list.length<=6&&list.every(x=>typeof x==='string'&&clean(x)))
        .map(([key,list])=>[key,list.map(x=>{const v=clean(x).toLowerCase();return ['eye_color','hair_color'].includes(key)?aliases[v]||v:v;})]));
}
export function storyExcerpt(chat) {
    return (chat || []).slice(-3).map(m=>String(m.mes||'')
        .replace(/image###[\s\S]*?;###/g,'')
        .replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
        .replace(/<details\b[\s\S]*?<\/details>/gi,'')
        .replace(/☆\s*插图规划[\s\S]*/g,'')
        .replace(/<(?:AVS|Status_?Block|status)\b[\s\S]*$/gi,''))
        .join('\n').slice(-8500);
}
export function mergeFlashControls(source, response, state) {
    const proposals=new Map((response?.people || []).filter(x=>x && typeof x.person==='string').map(x=>[x.person,x]));
    let out='',cursor=0,count=0;
    for (const marker of readIdentityControls(source)) {
        const spec=structuredClone(marker.spec), ai=proposals.get(spec.person);
        if (!ai) continue;
        const existing=Object.values(state.people || {}).find(p=>p.person===spec.person&&p.scope===state.scope);
        if (!existing) {
            spec.required={...facets(ai.required),...(spec.required||{})};
            spec.preferred={...facets(ai.preferred),...(spec.preferred||{})};
            if (!spec.age && (typeof ai.age==='string'||typeof ai.age==='number')) spec.age=ai.age;
        }
        if(existing){spec.required={...facets(ai.required),...(spec.required||{})};if(!spec.age&&(typeof ai.age==='string'||typeof ai.age==='number'))spec.age=ai.age;}
        // Colors are bound through facets, not competing prose color adjectives.
        const face=clean(ai.face_description)?.replace(/\b(?:black|white|blonde|red|brown|blue|green|purple|pink|gr[ae]y|aqua|violet|hazel|turquoise)\b/gi,'').replace(/\s+/g,' ').trim();
        if (face && !existing?.face_description && !existing?.native_prompt_fields && !spec.id && !existing?.exact_id) spec.face_description=face;
        const clothing=ai.clothing;
        if (clothing && ['keep','initial','change'].includes(clothing.action)) {
            const description=clean(clothing.description);
            if (clothing.action==='keep' && existing?.wardrobe) {
                spec.clothing={action:'keep'};
                delete spec.outfit;
            } else if (description) spec.clothing={action:clothing.action,description};
        }
        out+=source.slice(cursor,marker.start)+'ADEX'+JSON.stringify(spec)+'END';cursor=marker.end;count++;
    }
    return {text:out+source.slice(cursor),count};
}
export async function enhanceWithFlash(source,state,chat,{fetcher=fetch,url='http://127.0.0.1:8189'}={}) {
    const controls=readIdentityControls(source).map(m=>m.spec);
    if (!controls.length) return {text:source,count:0,skipped:true};
    const names=new Set(controls.map(p=>p.person));
    const current_people=Object.values(state.people||{}).filter(p=>p.scope===state.scope&&names.has(p.person)).map(p=>({person:p.person,appearance:p.chosen_appearance_tags,face_description:p.face_description || '',current_outfit:wardrobeText(p.wardrobe)}));
    const response=await fetcher(url+'/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene:source.slice(0,16000),story:storyExcerpt(chat),controls,current_people}),signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error('Flash helper HTTP '+response.status);
    const value=await response.json();
    return {...mergeFlashControls(source,value,state),meta:value.meta,visual:value};
}

export async function discoverWithFlash(source,chat,{fetcher=fetch,url='http://127.0.0.1:8189'}={}) {
    const story=storyExcerpt(chat);
    const response=await fetcher(url+'/discover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene:source.slice(0,16000),story,controls:[],current_people:[]}),signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error('Flash discovery HTTP '+response.status);
    const value=await response.json(), seen=new Set(), people=[];
    for (const p of value.people || []) {
        const name=clean(p.person);
        if (!name || seen.has(name) || !(source+'\n'+story).includes(name)) continue;
        seen.add(name);
        people.push({person:name,required:facets(p.required),preferred:facets(p.preferred),...(p.age!==undefined?{age:p.age}:{})});
    }
    if (!people.length) throw new Error('无法确定本图人物姓名，保留原提示词并等待明确人物信息。');
    const controls=people.map(p=>'ADEX'+JSON.stringify(p)+'END').join(' ');
    return {...mergeFlashControls(controls+' '+source,value,{scope:'',people:{}}),meta:value.meta,visual:value,discovered:true};
}
