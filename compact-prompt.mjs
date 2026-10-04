import {isYouthAppearance} from './drawing-policy.mjs';
const norm=t=>t.toLowerCase().replace(/[_-]/g,' ').replace(/\s+/g,' ').trim();
export function compactTags(text,{kind='action',limit=8}={}){
    let parts=String(text||'').split(',').map(t=>t.replace(/[;$@{}<>]/g,' ').replace(/\s+/g,' ').trim()).filter(Boolean),seen=new Set(),out=[];
    for(let t of parts){
        if(/^(?:female subject in center|focus on female subject|solo|empty hallway|story illustration)$/i.test(t))continue;
        if(kind==='action'){
            if(/\b(?:hair|eyes|breasts|skin)\b/i.test(t)&&/\b(?:black|white|blonde|brown|red|green|blue|purple|silver|yellow|pink|grey|gray|aqua|long|short|large|small|medium|oval)\b/i.test(t))continue;
            if(/(?:skirt swaying|with each step|finely detailed|small straight nose|eyebrows|face outline|almond eyes|full lips)/i.test(t))continue;
            t=t.replace(/walking (?:lightly )?(?:forward )?(?:along|down|through) (?:the )[^,]+/i,'walking').replace(/holding (?:a |an )?(?:cold |iced )?coffee can(?: with a straw)?/i,'holding coffee can').replace(/with (?:an? )?(?:amused |teasing |gentle |relaxed )*smile/i,'smiling');
        }
        const key=kind==='scene'&&/\b(?:hallway|corridor)\b/i.test(t)?'corridor':kind==='scene'&&/\b(?:ambient light|sunlight|natural light)\b/i.test(t)?'lighting':norm(t);
        if(seen.has(key))continue;seen.add(key);out.push(t);
    }
    return out.slice(0,limit).join(', ');
}
export function compactActor(tags,clothing,action,interaction,visible){
    const fixed=compactTags(tags.join(', '),{kind:'identity',limit:12});
    const outfit=compactTags(clothing.join(', '),{kind:'outfit',limit:9});
    return compactTags([fixed,outfit,compactTags(action,{limit:6}),interaction,visible].filter(Boolean).join(', '),{kind:'identity',limit:32});
}
/** Bind a full visible subject's appearance and outfit in one short sentence.
 * A bare pipe-separated bag lets the image model assign either outfit to either
 * person. Explicit ownership and position survive native prompt flattening.
 */
export function bindActorAppearance(person,tags,clothing,action,interaction,{position}={}){
    const f=person.story_appearance?.traits||{},first=k=>f[k]?.[0]||'';
    const young=isYouthAppearance(f,tags);
    const gender=tags.includes('1boy')?(young?'boy':'man'):(young?'girl':'woman');
    const style=first('hair_style'),adjective=style.replace(/ hair$/,'');
    const simple=/^(?:straight|curly|wavy)$/.test(adjective),hair=[first('hair_length'),simple?adjective:'',first('hair_color'),'hair'].filter(Boolean).join(' ');
    const hairText=first('hair_color')||first('hair_length')?hair+(style&&!simple?' with '+style:''):style;
    const eyes=(f.eye_color||[]).map(v=>v+' eyes').join(' and ');
    const height=first('height')==='tall'?'tall':first('height')==='short'?'petite':'';
    const age=tags.includes('teenage')?'teenage':first('age_group')==='mature'?'mature':first('age_group')==='young'?'young':'';
    const owner=['the',height,age,gender].filter(Boolean).join(' ')+(first('height')==='average'?' of average height':'')+` on the ${position}`;
    const appearance=[hairText,eyes,tags.includes(first('bust'))?first('bust'):''].filter(Boolean).join(' and ');
    const outfit=compactTags(clothing.join(', '),{kind:'outfit',limit:9}).split(', ').filter(Boolean).join(' and ');
    const sentence=owner+(appearance?' has '+appearance:'')+(outfit?(appearance?' and wears ':' wears ')+outfit:'');
    const other=tags.filter(t=>!/(?: hair| eyes)$/.test(t)&&t!==style&&t!==first('bust')&&!/^(?:1girl|1boy|tall|petite|young woman|mature female|teenage|child)$/.test(t));
    return [tags.includes('1boy')?'1boy':'1girl',sentence,compactTags(other.join(', '),{kind:'identity',limit:8}),compactTags(action,{limit:6}),interaction].filter(Boolean).join(', ');
}
