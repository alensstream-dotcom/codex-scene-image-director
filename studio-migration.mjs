import { applyNativeEdits, characterIdFor } from './native-manager.mjs';
import { wardrobeText } from './wardrobe.mjs';

/** One-time adoption; native user assets stay intact and are never written here. */
export function migrateStudioState(state,native={},links={}) {
    if(state?.studio_migration?.version===1)return {state,changed:false};
    let next=applyNativeEdits(state,native,structuredClone(links)).state;
    const scope=next.scope;
    const list=native.characterEnablePresets?.[native.characterEnablePresetId]?.characters || [];
    const enabled=list.map(x=>typeof x==='string'?x:x?.characterPresetName).filter(Boolean);
    const outfits=native.outfitEnablePresets?.[native.outfitEnablePresetId]?.outfits || [];
    for(const id of enabled){
        if(id.startsWith('Animadex·')&&!id.endsWith(scope.slice(0,8)))continue;
        const role=native.characterPresets?.[id];if(!role)continue;
        const name=String(role.nameCN || role.nameEN || '').split('|')[0].trim();if(!name)continue;
        if(Object.values(next.people).some(p=>p.person===name&&p.scope===scope))continue;
        const tags=[role.characterTraits,role.facialFeatures].filter(Boolean).join(', ').split(/[,，\n]/).map(t=>t.trim()).filter(Boolean);
        if(!tags.length)continue;
        next.people[JSON.stringify([scope,name])]={person:name,scope,chosen_appearance_tags:[...new Set(tags)],prototype_id:null,exact_id:false,style:'painterly',native_character_id:id,source:'native-migration'};
    }
    for(const person of Object.values(next.people)){
        if(person.scope!==scope)continue;
        if(wardrobeText(person.wardrobe))continue;
        const id=characterIdFor(person,scope),role=native.characterPresets?.[id];if(!role)continue;
        const outfitId=outfits.find(outfitId=>{
            const outfit=native.outfitPresets?.[outfitId];
            return outfit&&(role.outfits?.includes(outfitId)||String(outfit.owner || '')===String(role.nameEN || person.person));
        });
        const outfit=native.outfitPresets?.[outfitId];
        if(outfit){const description=[...new Set([outfit.upperBody,outfit.fullBody].filter(Boolean))].join(', ');if(description)person.wardrobe={version:1,description,tags:[],source:'native-migration'};}
    }
    next.studio_migration={version:1,authority:'studio',previous_authority:'native',time:new Date().toISOString()};
    return {state:next,changed:true};
}
