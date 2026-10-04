import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { syncNativeManagers, applyNativeEdits } from './native-manager.mjs';
import { nativePrompt, hasUnresolvedNativeRoles } from './native-prompt.mjs';
import { discoverWithFlash, enhanceWithFlash } from './flash-assistant.mjs';
const bundle=await fs.readFile(new URL('./fixtures/chatu8-parser.original.js',import.meta.url),'utf8');
function nativeFunction(name) {
    const start=bundle.indexOf(`function ${name}(`);
    assert(start>=0,`native function exists: ${name}`);
    const tail=bundle.slice(start), end=tail.slice(1).search(/^(?:function |async function |var )/m);
    return end<0?tail:tail.slice(0,end+1);
}
export function nativeExpand(prompt,native) {
    const functions=['getBaseTag','hasWeight','deduplicateTags','parsePromptStringWithCoordinates','centersToCoordinates','normalizeName','calculateMatchScore','collectCharacterCandidates','collectOutfitCandidates','findBestCharacterMatch','findBestOutfitMatch','collectNegativeToGlobal','processCharacterPrompt','processMultiCharacterPrompt','reconstructPromptString'];
    const context=vm.createContext({extensionName:'st-chatu8',extension_settings29:{'st-chatu8':native},window:{},addLog(){},console:{log(){},error(){}}});
    vm.runInContext(functions.map(nativeFunction).join('\n'),context);
    context.input=prompt;
    return vm.runInContext('processCharacterPrompt(input)',context);
}
const fixture=(scope='scope')=>({version:1,scope,people:{alice:{person:'Alice',scope,chosen_appearance_tags:['1girl','black hair','ponytail','purple eyes'],style:'painterly',age_description:'35 years old',wardrobe:{description:'navy silk blouse, black skirt, black heels',tags:[]}}}});

test('saved roles and outfits are enabled per chat; manual entries and media survive',()=>{
    const native={characterPresets:{Manual:{nameCN:'Manual'}},outfitPresets:{manual:{}},characterEnablePresetId:'old',characterEnablePresets:{old:{characters:[{characterPresetName:'Manual',imageFileId:'keep-photo',imageDescription:'portrait'}]}},outfitEnablePresetId:'old',outfitEnablePresets:{old:{outfits:['manual']}}};
    const first=syncNativeManagers(fixture(),native,{}), roles=native.characterEnablePresets[first.listId].characters;
    assert.equal(roles.length,2);assert.equal(roles[0].imageFileId,'keep-photo');
    assert.equal(native.outfitEnablePresets[first.listId].outfits.length,2);
    const second=syncNativeManagers(fixture('other'),native,{});
    assert.notEqual(first.listId,second.listId);assert(native.characterEnablePresets[first.listId].characters.some(x=>x.characterPresetName===first.selected[0].character));
    assert(!native.characterEnablePresets[second.listId].characters.some(x=>x.characterPresetName===first.selected[0].character));
});
test('real native parser expands current appearance and clothes; conflicting scene prose cannot override',()=>{
    const state=fixture(), native={}, synced=syncNativeManagers(state,native,{});
    const source='image###Scene Composition:1girl, solo, full body, garden. ADEX{"person":"Alice"}END She sits on a bench, blonde hair, blue eyes, wearing a white dress, white shoes, holding a book, 704x1152;###';
    const prepared=nativePrompt(source,state,native);
    assert(prepared.text.includes('Character 1 Prompt:'));assert(prepared.text.includes('$'));
    const output=nativeExpand(prepared.text,native);
    assert(!output.includes('$'));assert(output.includes('black hair'));assert(output.includes('ponytail'));assert(output.includes('purple eyes'));
    assert(output.includes('navy silk blouse'));assert(output.includes('black skirt'));assert(output.includes('black heels'));assert(output.includes('35 years old'));
    assert(!/blonde hair|blue eyes|white dress|white shoes/.test(output));assert(output.includes('sits'));assert(output.includes('holding a book'));
    native.characterPresets[synced.selected[0].character].characterTraits='1girl, red hair, long hair';
    const edited=applyNativeEdits(state,native,synced.links).state;
    const updated=nativeExpand(nativePrompt(source,edited,native).text,native);
    assert(updated.includes('red hair'));assert(!updated.includes('black hair'));
});
test('back camera uses native back fields and hides lower garments in portrait',()=>{
    const state=fixture(),native={}, selected=syncNativeManagers(state,native,{}).selected[0];
    native.characterPresets[selected.character].facialFeaturesBack='profile silhouette';
    native.outfitPresets[selected.outfit].upperBodyBack='navy blouse back seam';
    const output=nativeExpand(nativePrompt('Scene Composition:portrait, from behind; ADEX{"person":"Alice"}END looking over her shoulder;',state,native).text,native);
    assert(output.includes('profile silhouette'));assert(output.includes('navy blouse back seam'));assert(!output.includes('black skirt'));
});
test('existing native references also remove conflicting prose and retain original visibility',()=>{
    const state=fixture(),native={};syncNativeManagers(state,native,{});
    const valid=nativePrompt('Scene Composition:1girl, garden, full body; ADEX{"person":"Alice"}END sitting on a bench;',state,native).text;
    const polluted=valid.replace('sitting on a bench','sitting on a bench, blonde hair, blue eyes, white dress, holding a phone');
    const clean=nativePrompt(polluted,state,native);
    const output=nativeExpand(clean.text,native);
    assert(!/blonde hair|blue eyes|white dress/.test(output));assert(output.includes('navy silk blouse'));assert(output.includes('holding a phone'));
    assert(clean.text.includes('"lowerBody":"sfw"'));
    assert.equal(hasUnresolvedNativeRoles(clean.text,native),false);
    assert.equal(hasUnresolvedNativeRoles(clean.text.replace('"angle":"front"','"angle":"front"').replace(/"name":"Animadex·Alice·scope"/,'"name":"New Person"'),native),true);
});
test('manual preset with exact name is adopted rather than duplicated',()=>{
    const state=fixture(),native={characterPresets:{MyAlice:{nameCN:'Alice',nameEN:'My Alice',characterTraits:'1girl, silver hair',facialFeatures:'green eyes',photoMedia:[{id:'user-photo'}],outfits:[]}}};
    syncNativeManagers(state,native,{});
    assert.equal(Object.keys(native.characterPresets).length,1);assert.equal(state.people.alice.native_character_id,'MyAlice');
    assert(state.people.alice.chosen_appearance_tags.includes('silver hair'));assert.equal(native.characterPresets.MyAlice.photoMedia[0].id,'user-photo');
});
test('missing ADEX discovery sends no saved cast; extraction sends only discovered pictured people',async()=>{
    const state=fixture(),source='Scene Composition:Alice reading in the garden;',chat=[{mes:'Alice goes to the garden.'}],payloads=[];
    const fetcher=async(url,options)=>{payloads.push({url,payload:JSON.parse(options.body)});return new Response(JSON.stringify({scene_composition:'1girl, garden, soft light',people:[{person:'Alice',required:{hair_color:['blonde']},action_prompt:'reading a book',clothing:{action:url.endsWith('/discover')?'initial':'keep',description:'white dress'}}],meta:{model:'deepseek-flash'}}));};
    const found=await discoverWithFlash(source,chat,{fetcher});assert(found.text.includes('ADEX'));
    const extracted=await enhanceWithFlash(found.text,state,chat,{fetcher});
    assert.deepEqual(payloads[0].payload.current_people,[]);assert.equal(payloads[1].payload.current_people.length,1);
    assert(extracted.text.includes('"action":"keep"'));assert(!extracted.text.includes('white dress'));
});
