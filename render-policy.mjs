import {actorGender as gender,frameInteractions} from './interaction-frame.mjs';
export {RENDER_POLICY} from './drawing-policy.mjs';
export function focusFrame(scene,options={}){
    const next=structuredClone(scene),actors=next.actors||next.people||[],isScene=!!next.actors;
    const directed=frameInteractions(next,actors,options);
    const legacyRomantic=/\bkissing\b|接吻/i.test([next.composition,next.scene,next.summary,...actors.map(a=>a.action_prompt||a.action)].join(' '));
    const interaction=directed.relations.length>0||legacyRomantic;
    const women=actors.filter(a=>gender(a)!=='male');
    const kept=women.length?actors.filter(a=>gender(a)!=='male'||directed.involved.has(a.person||a.name)||legacyRomantic):[];
    kept.sort((a,b)=>(gender(a)==='male')-(gender(b)==='male'));
    if(isScene)next.actors=kept;else next.people=kept;
    const input=String(next.composition??next.scene??''),base=next.render_policy?.composition_output===input?next.render_policy.composition_base:input;
    const oldCamera=/\b(?:first[- ]?person|pov|third[- ]?person|viewer face|(?:arms|hands) entering frame)\b|(?:woman|man) facing the viewer|partner's .+visible in foreground|第一人称|第三人称|主观视角/i;
    let text=(directed.relations.length?base.split(',').filter(p=>!oldCamera.test(p)).join(','):base).replace(/\b\d+\s*(?:girls?|boys?|people|persons?)\b/gi,'').replace(/\b(?:solo|couple)\b/gi,'').replace(/,+/g,',').trim();
    if(options.interactionView==='third_person')for(const actor of actors)for(const key of['action','action_prompt'])if(actor[key])actor[key]=actor[key].split(',').filter(p=>!oldCamera.test(p)&&!(actor.partner_rendering?.visibility==='full'&&/face out of frame/i.test(p))).join(', ');
    if(kept.length<actors.length){text=text.split(',').filter(p=>! /\b(?:man|male|boy|men|boys)\b/i.test(p)).join(', ');for(const actor of kept)for(const key of['action','action_prompt'])if(actor[key])actor[key]=actor[key].replace(/\b(?:standing|walking) (?:alongside|beside) (?:the )?(?:boy|man)\b/gi,'standing').replace(/\b(?:boy|man|male)\b/gi,'off-screen companion');}
    if(kept.length)text+=(text?', ':'')+(women.length+'girl'+(women.length>1?'s':'')+(kept.length>women.length?', '+(kept.length-women.length)+'boy':'')+(kept.length===1?', solo':'')+', female subject in center, focus on female subject');
    if(kept.length&&directed.viewTags.length)text+=', '+directed.viewTags.join(', ');
    if(isScene)next.composition=text;else next.scene=text;
    next.interactions=kept.length?directed.relations:[];next.render_policy={version:2,female_focus:true,male_interaction:interaction&&kept.some(a=>gender(a)==='male'),omitted_male:actors.length-kept.length,directed_interactions:next.interactions.length,composition_base:base,composition_output:text};return next;
}
