/** Adapt catalog controls to the plugin's own role/outfit trigger syntax.
 * The native plugin, not this module, expands the saved preset fields.
 */
import { readIdentityControls } from './identity.mjs';
import { characterIdFor, outfitFor } from './native-manager.mjs';
const garment=/\b(?:dress|gown|shirt|t-shirt|blouse|sweater|jacket|coat|cardigan|robe|skirt|shorts|pants|trousers|jeans|leggings|tights|stockings|shoes|heels|boots|sandals|sneakers|uniform|swimsuit|bikini)\b/i;
const identity=/\b(?:hair|breasts|bust|skin|chin|eyebrows|braids?|ponytail|bangs|animal ears|tail|horns|(?:black|blue|green|purple|brown|red|pink|grey|gray|aqua|almond|round|narrow) eyes|(?:oval|round|long|square|heart-shaped) face)\b/i;
const clean=value=>typeof value==='string'?value.replace(/image###|###/g,'').replace(/[;$]/g,',').replace(/\|centers:[^,]*/g,'').replace(/\s+/g,' ').trim():'';
export function transientDescription(value,{stripOutfit=true}={}) {
    // Never repeat permanent appearance from scene prose alongside native tags.
    return clean(value).replace(/\b(?:wearing|dressed in|clad in|changed into|changes into)\s+[^.,;]+/gi,'')
        .replace(/\bin\s+([^.,]+)/gi,(match,phrase)=>stripOutfit&&garment.test(phrase)?'':match)
        .split(/[,.]/).map(x=>x.trim()).filter(x=>x&&!identity.test(x)&&(!stripOutfit||!garment.test(x)))
        .join(', ');
}
export function hasNativeTriggers(source) { return /\$\s*\{[^$]*"name"\s*:/.test(source); }
export function hasUnresolvedNativeRoles(source,native) {
    return [...source.matchAll(/\$([^$]+)\$/g)].some(m=>{
        try {
            const value=JSON.parse(m[1]);
            return 'angle' in value&&!Object.values(native.characterPresets || {}).some(p=>[p.nameCN,p.nameEN].some(names=>String(names || '').split('|').some(n=>n.trim()===value.name)));
        } catch{return false;}
    });
}
export function sanitizeNativePrompt(source,state,native) {
    const people=[];
    let text=source.replace(/Character ([1-4]) Prompt:([\s\S]*?);/g,(full,n,body)=>{
        const tokens=[...body.matchAll(/\$([^$]+)\$/g)].map(m=>{try {return {raw:m[0],value:JSON.parse(m[1])};}catch{return {raw:m[0]};}});
        const role=tokens.find(t=>t.value&&'angle' in t.value);
        if (!role) return full;
        const person=Object.values(state.people || {}).find(p=>p.scope===state.scope&&[native.characterPresets?.[characterIdFor(p,state.scope)]?.nameEN,native.characterPresets?.[characterIdFor(p,state.scope)]?.nameCN].some(v=>String(v || '').split('|').includes(role.value.name)));
        if (!person) return full;
        const outfit=native.outfitPresets?.[outfitFor(person.person,state.scope)];
        const description=transientDescription(body.replace(/\$[^$]+\$/g,''),{stripOutfit:!!outfit});
        for (const token of tokens) if (outfit&&token.value&&!('angle' in token.value)) token.raw='$'+JSON.stringify({...token.value,name:outfit.nameEN || outfit.nameCN})+'$';
        if (outfit&&!tokens.some(t=>t.value&&!('angle' in t.value))) tokens.push({raw:'$'+JSON.stringify({name:outfit.nameEN || outfit.nameCN,upperBody:role.value.upperBody==='hidden'?'hidden':'visible',lowerBody:role.value.lowerBody==='hidden'?'hidden':'visible'})+'$'});
        people.push(person.person);
        return `Character ${n} Prompt: ${[...tokens.map(t=>t.raw),description].filter(Boolean).join(', ')};`;
    });
    if (people.length) text=text.replace(/Scene Composition:([^;]*);/,(_all,composition)=>'Scene Composition: '+transientDescription(composition)+';');
    return {text,people,native:true};
}
export function nativePrompt(source,state,native,{visual={}}={}) {
    const markers=readIdentityControls(source);
    if (!markers.length) return sanitizeNativePrompt(source,state,native);
    const proposals=new Map((visual.people || []).map(x=>[x.person,x]));
    const actors=[];
    for (const [i,m] of markers.entries()) {
        if (actors.some(a=>a.person===m.spec.person)) continue;
        const person=Object.values(state.people || {}).find(p=>p.scope===state.scope&&p.person===m.spec.person);
        if (!person) continue;
        const id=characterIdFor(person,state.scope), preset=native.characterPresets?.[id];
        if (!preset) continue;
        const ai=proposals.get(person.person) || {};
        const following=source.slice(m.end,markers[i+1]?.start).replace(/;?###\s*$/,'').split(/;\s*Character \d (?:Prompt|UC):/)[0];
        const pose=transientDescription(ai.action_prompt || following,{stripOutfit:!!person.wardrobe});
        const back=/\b(?:from (?:side )?behind|back view|rear view)\b/i.test(ai.angle || source);
        const close=/\b(?:portrait|close[ -]up|upper body|bust shot|headshot)\b/i.test(ai.framing || source)&&! /\b(?:full body|medium-full|cowboy shot)\b/i.test(ai.framing || source);
        const role='$'+JSON.stringify({name:preset.nameEN || preset.nameCN,angle:back?'from behind':'front',upperBody:'sfw',lowerBody:close?'hidden':'sfw'})+'$';
        const outfit=native.outfitPresets?.[outfitFor(person.person,state.scope)];
        const clothes=outfit?'$'+JSON.stringify({name:outfit.nameEN || outfit.nameCN,upperBody:'visible',lowerBody:close?'hidden':'visible'})+'$':'';
        actors.push({person:person.person,prompt:[role,clothes,pose].filter(Boolean).join(', '),style:person.style,exact:person.exact_id,id:person.prototype_id});
    }
    if (!actors.length) return {text:source,people:[],native:false};
    if (actors.length>4) throw new Error('原生分角色格式最多支持 4 位人物，请减少本图人物数量。');
    const prefix=source.slice(0,markers[0].start).split(/;\s*Character \d Prompt:/)[0].replace(/^\s*(?:image###)?\s*Scene Composition\s*:/i,'');
    const composition=transientDescription(visual.scene_composition || prefix).replace(/@(?:style:)?(?:painterly|mikko|bluearchive|rdbt|pc98)\b/gi,'') || 'SFW, story illustration';
    const dimensions=source.match(/\b\d{2,4}x\d{2,4}\b/g)?.at(-1);
    const explicitStyle=source.match(/@(?:style:)?(painterly|mikko|bluearchive|rdbt|pc98)\b/gi)?.at(-1)?.replace(/^@(?:style:)?/i,'').toLowerCase();
    const focus=markers.map(x=>x.spec.style).filter(Boolean).at(-1) || explicitStyle || actors.at(-1).style || 'painterly';
    const style=`@style:${focus}`;
    const lora=actors.length===1&&actors[0].exact&&actors[0].id==='nilou_(genshin_impact)'?'@character:Nilou':'';
    const text=`Scene Composition: ${[composition,style,lora,dimensions].filter(Boolean).join(', ')}; `+actors.map((a,i)=>`Character ${i+1} Prompt: ${a.prompt};`).join(' ');
    return {text,people:actors.map(a=>a.person),native:true};
}
