/** Directed, non-explicit gestures. Appearance and clothing stay in their own snapshots. */
import {SUPPORTED_INTERACTIONS,INTERACTION_EVIDENCE} from './drawing-policy.mjs';
export const INTERACTION_KINDS=SUPPORTED_INTERACTIONS;
export const INTERACTION_VIEWS=['auto','pov','third_person'];
const parts=['hands','arms','torso','full'];
export function actorGender(actor){const p=actor.person_snapshot||actor,values=p.initial_query?.required?.gender||actor.appearance?.required?.gender||actor.required?.gender||[];return [values].flat().includes('male')||(p.chosen_appearance_tags||[]).includes('1boy')?'male':'female';}
const nameOf=a=>a.person||a.name;
const aliases=a=>[nameOf(a),a.source_name,...(a.person_snapshot?.aliases||[])].filter(Boolean);
const find=(actors,name)=>actors.find(a=>aliases(a).includes(name));
const safeKinds=INTERACTION_EVIDENCE;
export function normalizeInteractions(values,actors){
    if(values===undefined||values===null)return [];
    if(!Array.isArray(values)||values.length>3)throw new Error('互动关系最多 3 条。');
    return values.map(value=>{
        if(!value||!INTERACTION_KINDS.includes(value.kind)||Object.keys(value).some(k=>!['kind','initiator','recipient','view','pov_from','partner_visibility','source'].includes(k)))throw new Error('互动关系请使用拥抱、牵手、挽臂、共舞、搭肩或搀扶的结构。');
        const initiator=find(actors,value.initiator),recipient=find(actors,value.recipient);
        if(!initiator||!recipient||initiator===recipient)throw new Error('双人动作需要两个已列入画面且不同的人物，请补全互动对象。');
        const view=value.view||'auto',visibility=value.partner_visibility||'';if(!INTERACTION_VIEWS.includes(view)||(visibility&&!parts.includes(visibility)))throw new Error('互动镜头或对方可见部位无效。');
        const viewer=value.pov_from?find(actors,value.pov_from):null;if(value.pov_from&&viewer!==initiator&&viewer!==recipient)throw new Error('第一人称镜头需要来自这两位互动人物之一。');
        return {kind:value.kind,initiator:nameOf(initiator),recipient:nameOf(recipient),view,...(viewer?{pov_from:nameOf(viewer)}:{}),...(visibility?{partner_visibility:visibility}:{}),source:value.source==='inferred'?'inferred':'explicit'};
    });
}
export function inferInteractions(scene,actors){
    if(actors.length!==2)return [];
    const text=[scene.composition,scene.scene,scene.summary,...actors.map(a=>a.action_prompt||a.action)].join(' ');
    if(/\b(?:not hugging|no physical contact|without touching)\b|没有接触|没有拥抱/i.test(text))return [];
    const kind=INTERACTION_KINDS.find(k=>safeKinds[k].test(text));if(!kind)return [];
    // Active per-person gesture beats count words or a generic scene summary.
    const active=actors.find(a=>{const action=String(a.action_prompt||a.action||'');return safeKinds[kind].test(action)&&!/^\s*(?:being\b|被|受到)/i.test(action);});
    const initiator=active||actors.find(a=>actorGender(a)==='male')||actors[0],recipient=actors.find(a=>a!==initiator);
    return [{kind,initiator:nameOf(initiator),recipient:nameOf(recipient),view:/\bpov\b|first.person|第一人称|主观视角/i.test(text)?'pov':'auto',source:'inferred'}];
}
export function frameInteractions(scene,actors,{interactionView,partnerVisibility}={}){
    const relations=scene.interactions?.length?normalizeInteractions(scene.interactions,actors):inferInteractions(scene,actors);
    if(interactionView!==undefined&&!INTERACTION_VIEWS.includes(interactionView))throw new Error('互动镜头不存在。');
    if(partnerVisibility!==undefined&&!parts.includes(partnerVisibility))throw new Error('互动对方的入镜范围不存在。');
    const involved=new Set(relations.flatMap(r=>[r.initiator,r.recipient]));
    for(const a of actors){delete a.interaction_prompt;delete a.partner_rendering;}
    let viewTags=[];
    for(const relation of relations){
        if(partnerVisibility!==undefined)relation.partner_visibility=partnerVisibility;
        const initiator=find(actors,relation.initiator),recipient=find(actors,relation.recipient),ref=a=>actorGender(a)==='male'?'the man':'the woman';
        const to=ref(recipient),from=ref(initiator),gestures={
            hug:[`gently embracing ${to}`,`being embraced by ${from}`],
            holding_hands:[`holding hands with ${to}`,`holding hands with ${from}`],
            arm_in_arm:[`walking arm in arm with ${to}`,`walking arm in arm with ${from}`],
            dance:[`dancing with ${to}`,`dancing with ${from}`],
            hand_on_shoulder:[`placing a hand on ${to}'s shoulder`,`${from}'s hand resting on ${actorGender(recipient)==='female'?'her':'his'} shoulder`],
            helping_up:[`helping ${to} stand up`,`being helped to stand by ${from}`]
        }[relation.kind];
        for(const[a,prompt]of[[initiator,gestures[0]],[recipient,gestures[1]]])a.interaction_prompt=[a.interaction_prompt,prompt].filter(Boolean).join(', ');
        const requested=interactionView&&interactionView!=='auto'?interactionView:relation.view;
        if(requested==='pov'){
            const viewer=find(actors,relation.pov_from)||(actorGender(initiator)==='male'?initiator:actorGender(recipient)==='male'?recipient:initiator),subject=viewer===initiator?recipient:initiator,visibility=relation.partner_visibility==='full'?'torso':relation.partner_visibility||'arms';
            if(actorGender(subject)==='male'&&actors.some(a=>actorGender(a)==='female'))throw new Error('女性主体的第一人称互动，请将镜头来源设为男性配角。');
            viewer.partner_rendering={view:'pov',visibility,hide_face:true};relation.pov_from=nameOf(viewer);relation.view='pov';
            viewTags.push('first person perspective','POV',`${actorGender(subject)==='female'?'woman':'man'} facing the viewer`,`partner's ${visibility==='hands'?'hands':visibility==='torso'?'arms and clothed torso':'arms'} visible in foreground`,'viewer face out of frame','two-person interaction, clear contact between the two people');
        }else{
            relation.view='third_person';const partner=actors.find(a=>actorGender(a)==='male'&&involved.has(nameOf(a)));if(partner)partner.partner_rendering={view:'third_person',visibility:relation.partner_visibility||'torso',hide_face:relation.partner_visibility!=='full'};
            viewTags.push('two-person interaction, clear contact between the two people','supporting partner close to main subject');
        }
    }
    return {relations,involved,viewTags:[...new Set(viewTags)]};
}
