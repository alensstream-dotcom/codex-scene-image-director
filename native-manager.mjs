import { garmentFields, wardrobeText } from './wardrobe.mjs';
import {NATIVE_SFW_FIELDS,emptyNativeBodyFields} from './drawing-policy.mjs';
export const aliasFor = (person, scope) => `Animadex·${person}·${scope.slice(0, 8)}`;
export const outfitFor = (person, scope) => `Animadex·${person}·当前衣装·${scope.slice(0, 8)}`;
export const characterIdFor = (person, scope) => person.native_character_id || aliasFor(person.person, scope);
const signature = values => JSON.stringify(values);
const appearanceFields = preset => [preset.characterTraits || '', preset.facialFeatures || ''];
const bodyFields = preset => Object.fromEntries(NATIVE_SFW_FIELDS.map(key => [key, preset[key] || '']));
const characterSignature = preset => signature([appearanceFields(preset), bodyFields(preset)]);
const outfitFields = preset => [preset.upperBody || '', preset.fullBody || '', preset.upperBodyBack || '', preset.fullBodyBack || ''];

export function applyNativeEdits(state, native, links = {}) {
    const next = structuredClone(state);
    let changed = false;
    for (const person of Object.values(next.people || {})) {
        if (person.scope !== next.scope) continue;
        const alias = characterIdFor(person, next.scope), link = links[alias];
        if (!link) continue;
        const character = native.characterPresets?.[alias];
        if (character && characterSignature(character) !== link.appearance) {
            const tags = [...new Set(appearanceFields(character).join(', ').split(/[,，\n]/).map(value => value.trim()).filter(Boolean))];
            if (tags.length) { person.chosen_appearance_tags = tags; person.face_description=''; changed = true; }
            person.native_prompt_fields = bodyFields(character);
            changed = true;
            link.appearance = characterSignature(character);
        }
        const outfit = native.outfitPresets?.[outfitFor(person.person, next.scope)];
        if (outfit && signature(outfitFields(outfit)) !== link.outfit) {
            const description = [...new Set(outfitFields(outfit).slice(0, 2).filter(Boolean))].join(', ');
            if (description) { person.wardrobe = { version:1, description, tags:[], outfit_id:null, source:'manager', manager_fields:Object.fromEntries(['upperBody','fullBody','upperBodyBack','fullBodyBack'].map(key => [key,outfit[key] || ''])) }; changed = true; }
            link.outfit = signature(outfitFields(outfit));
        }
    }
    return { state:next, changed };
}

export function syncNativeManagers(state, native, links = {}, taxonomy = {}) {
    const before=JSON.stringify(state.people);
    native.characterPresets ??= {};
    native.outfitPresets ??= {};
    const selected = [];
    for (const person of Object.values(state.people || {})) {
        if (person.scope !== state.scope) continue;
        // Reuse a user-created preset with an exact name. Never use fuzzy names
        // for identity storage, and never adopt another chat's generated preset.
        if (!person.native_character_id && !native.characterPresets[aliasFor(person.person,state.scope)]) {
            const existing = Object.entries(native.characterPresets).find(([id,p]) => !id.startsWith('Animadex·') && [p.nameCN,p.nameEN].some(names => String(names || '').split('|').some(n => n.trim()===person.person)));
            if (existing) {
                person.native_character_id=existing[0];
                person.chosen_appearance_tags=appearanceFields(existing[1]).join(', ').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean);
                person.face_description='';person.native_prompt_fields=bodyFields(existing[1]);
            }
        }
        const alias = characterIdFor(person, state.scope), outfitAlias = outfitFor(person.person, state.scope);
        const face = tag => ['eye_color', 'eye_features', 'face', 'facial_hair'].includes(taxonomy[tag]?.facet);
        if (!native.characterPresets[alias]) {
            native.characterPresets[alias] = {
                nameCN:person.person, nameEN:alias,
                characterTraits:[person.exact_id ? person.prototype_trigger : '',...person.chosen_appearance_tags.filter(tag => !face(tag)),person.age_description].filter(Boolean).join(', '),
                facialFeatures:[...person.chosen_appearance_tags.filter(face), person.face_description].filter(Boolean).join(', '),
                facialFeaturesBack:'', ...emptyNativeBodyFields(),
                generationContext:'', generationVariables:{}, generationWorldBook:'',
                mediaSchemaVersion:2, photoMedia:[], audioMedia:[], photoImageIds:[],
                selectedAudioId:null, selectedPhotoId:null, selectedPhotoIndex:0,
                sendAudio:false, sendPhoto:false, photoPrompt:'', outfits:[],
            };
        }
        const character = native.characterPresets[alias];
        if (character.nameCN === alias) character.nameCN = person.person;
        // Generated EN names are scope-specific; CN labels remain readable.
        if (alias.startsWith('Animadex·') && [alias,person.person].includes(character.nameEN)) character.nameEN=alias;
        const old = links[alias];
        if (alias.startsWith('Animadex·')&&(!old||characterSignature(character)===old.appearance)) {
            const wanted=person.initial_query?.required?.hair_style || person.initial_query?.preferred?.hair_style;
            if (!person.exact_id&&!person.native_prompt_fields&&wanted?.length) {
                const tags=person.chosen_appearance_tags.filter(tag=>taxonomy[tag]?.facet!=='hair_style'||wanted.includes(taxonomy[tag].value));
                if (tags.length!==person.chosen_appearance_tags.length) {
                    person.chosen_appearance_tags=tags;
                    character.characterTraits=[...tags.filter(tag=>!face(tag)),person.age_description].filter(Boolean).join(', ');
                }
            }
            if (person.age_description&&!character.characterTraits.includes(person.age_description)) character.characterTraits=[character.characterTraits,person.age_description].filter(Boolean).join(', ');
        }
        if (person.face_description && !character.facialFeatures.includes(person.face_description)
            && (!old || characterSignature(character) === old.appearance)) {
            character.facialFeatures=[character.facialFeatures,person.face_description].filter(Boolean).join(', ');
        }
        if (wardrobeText(person.wardrobe)) {
            const fields = garmentFields(person.wardrobe);
            const existing = native.outfitPresets[outfitAlias];
            const newText = [...new Set([fields.upperBody, fields.fullBody].filter(Boolean))].join(', ');
            const oldText = existing ? [...new Set([existing.upperBody, existing.fullBody].filter(Boolean))].join(', ') : '';
            if (!existing) native.outfitPresets[outfitAlias] = { nameCN:`${person.person}·当前衣装`, nameEN:outfitAlias, owner:character.nameEN || person.person, ...fields, photoImageIds:[], selectedPhotoIndex:0, photoPrompt:'', sendPhoto:false };
            else if (oldText !== newText) Object.assign(existing, fields);
            native.outfitPresets[outfitAlias].nameEN=outfitAlias;
            native.outfitPresets[outfitAlias].owner=character.nameEN || person.person;
            character.outfits = [...new Set([...(character.outfits || []), outfitAlias])];
        }
        links[alias] = { appearance:characterSignature(character), outfit:signature(outfitFields(native.outfitPresets[outfitAlias] || {})) };
        selected.push({ person:person.person, character:alias, outfit:native.outfitPresets[outfitAlias] ? outfitAlias : null });
    }
    const listId=`Animadex·本聊天·${state.scope.slice(0,8)}`;
    native.characterEnablePresets ??= {};
    native.outfitEnablePresets ??= {};
    const priorRoles=native.characterEnablePresets[listId]?.characters || native.characterEnablePresets[native.characterEnablePresetId]?.characters || [];
    const priorOutfits=native.outfitEnablePresets[listId]?.outfits || native.outfitEnablePresets[native.outfitEnablePresetId]?.outfits || [];
    const roleId=x=>typeof x==='string'?x:x?.characterPresetName;
    const keepRole=x=>!String(roleId(x) || '').startsWith('Animadex·') || selected.some(p=>p.character===roleId(x));
    const roles=priorRoles.filter(keepRole).map(x=>typeof x==='string'?{characterPresetName:x,imageFileId:null,audioFileId:null,imageDescription:'',audioDescription:''}:x);
    for (const p of selected) if (!roles.some(x=>roleId(x)===p.character)) roles.push({characterPresetName:p.character,imageFileId:null,audioFileId:null,imageDescription:'',audioDescription:''});
    native.characterEnablePresets[listId]={...(native.characterEnablePresets[listId] || {}),characters:roles,mediaSchemaVersion:2};
    native.outfitEnablePresets[listId]={...(native.outfitEnablePresets[listId] || {}),outfits:[...new Set([...priorOutfits.filter(id=>!id.startsWith('Animadex·') || selected.some(p=>p.outfit===id)),...selected.map(p=>p.outfit).filter(Boolean)])]};
    native.characterEnablePresetId=listId;
    native.outfitEnablePresetId=listId;
    return { links, selected, listId, stateChanged:before!==JSON.stringify(state.people) };
}
