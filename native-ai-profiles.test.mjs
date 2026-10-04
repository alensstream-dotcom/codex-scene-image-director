import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { NATIVE_AI_PROFILES, installMissingNativeAIProfiles } from './native-ai-profiles.mjs';

const bundle=await fs.readFile(new URL('./fixtures/chatu8-parser.original.js',import.meta.url),'utf8');
function nativeFunction(name) {
    const start=bundle.indexOf(`function ${name}(`);
    assert(start>=0,`native function exists: ${name}`);
    const tail=bundle.slice(start),end=tail.slice(1).search(/^(?:function |async function |var )/m);
    return end<0?tail:tail.slice(0,end+1);
}

test('empty native role contexts are repaired without changing a working image profile or API credentials',()=>{
    const native={
        test_context_profiles:{'默认':{entries:[]},images:{entries:[{enabled:true,role:'system',content:'working image preset'}]}},
        llm_request_type_configs:{image_gen:{api_profile:'User API',context_profile:'images'},char_design:{api_profile:'User API',context_profile:'默认'},char_display:{api_profile:'Other API',context_profile:'默认'},char_modify:{api_profile:'User API',context_profile:'默认'}},
        llm_profiles:{'User API':{api_key:'synthetic-credential',model:'fixture'}},
    };
    const image=JSON.stringify(native.llm_request_type_configs.image_gen),api=JSON.stringify(native.llm_profiles);
    const result=installMissingNativeAIProfiles(native);
    assert.deepEqual(result.selected,['char_design','char_modify','char_display']);
    assert.equal(JSON.stringify(native.llm_request_type_configs.image_gen),image);
    assert.equal(JSON.stringify(native.llm_profiles),api);
    assert.equal(native.llm_request_type_configs.char_display.api_profile,'Other API');
    assert.equal(installMissingNativeAIProfiles(native).changed,false);
    const empty={};installMissingNativeAIProfiles(empty);
    for(const [kind,preset] of Object.entries(NATIVE_AI_PROFILES)) assert.equal(empty.llm_request_type_configs[kind].context_profile,preset.name);
});

test('existing native role prompts are preserved and generated schema matches the real native parser',async()=>{
    const native={test_context_profiles:{custom:{entries:[{enabled:true,content:'user design'}]}},llm_request_type_configs:{char_design:{api_profile:'User API',context_profile:'custom'}}};
    installMissingNativeAIProfiles(native);assert.equal(native.llm_request_type_configs.char_design.context_profile,'custom');
    const context=vm.createContext({console:{log(){}}});
    vm.runInContext(['preprocessTagContent3','parseCharacterData2','parseOutfitData3','extractCharacterAndOutfitTags2'].map(nativeFunction).join('\n'),context);
    context.input=NATIVE_AI_PROFILES.char_design.data.entries[0].content;
    const extracted=vm.runInContext('extractCharacterAndOutfitTags2(input)',context);
    assert.equal(extracted.characters.length,1);assert.equal(extracted.characters[0].matchedOutfits.length,1);
    assert(extracted.characters[0].characterTraits);assert(extracted.characters[0].facialFeatures);
    assert(extracted.characters[0].fullBodySFW);assert(extracted.characters[0].matchedOutfits[0].fullBody);
    const design=NATIVE_AI_PROFILES.char_design.data.entries[1].content;
    assert(design.includes('{{正文}}'));assert(!design.includes('{{世界书触发}}'));assert(!design.includes('{{角色启用列表}}'));
    vm.runInContext(nativeFunction('detectImportFormat'),context);
    context.imported=JSON.parse(await fs.readFile(new URL('./fixtures/native-ai-context-presets.json',import.meta.url),'utf8'));
    assert.equal(vm.runInContext('detectImportFormat(imported)',context),'standard');
});

test('live synthetic native prompt responses can be parsed and expanded by the installed bundle',async()=>{
    const artifact=new URL('../native-ai-live-results.json',import.meta.url);
    let report;try{report=JSON.parse(await fs.readFile(artifact,'utf8'));}catch{return;}
    const context=vm.createContext({console:{log(){}}});
    vm.runInContext(['preprocessTagContent3','parseCharacterData2','parseOutfitData3','extractCharacterAndOutfitTags2'].map(nativeFunction).join('\n'),context);
    for(const key of ['design','modify']) {
        context.input=report[key].text;
        const parsed=vm.runInContext('extractCharacterAndOutfitTags2(input)',context);
        assert.equal(parsed.characters.length,1);
        assert.equal(parsed.characters[0].nameEN,'Rina_Synthetic');
        if(key==='modify') {
            assert(parsed.characters[0].characterTraits.includes('black hair'));
            assert(parsed.characters[0].characterTraits.includes('bun'));
            assert(parsed.characters[0].facialFeatures.includes('green eyes'));
        }
    }
    const {syncNativeManagers}=await import('./native-manager.mjs');
    const state={version:1,scope:'fixture',people:{rina:{person:'Rina',scope:'fixture',chosen_appearance_tags:['1girl','black hair','hair bun','green eyes'],wardrobe:{description:'navy silk blouse, black skirt',tags:[]}}}};
    const native={};const selected=syncNativeManagers(state,native,{}).selected[0];
    native.characterPresets[selected.character].nameEN='Rina_Synthetic';
    native.outfitPresets[selected.outfit].nameEN='Rina_Outfit';
    native.outfitPresets[selected.outfit].owner='Rina_Synthetic';
    const expander=vm.createContext({extensionName:'st-chatu8',extension_settings29:{'st-chatu8':native},window:{},addLog(){},console:{log(){},error(){}}});
    const functions=['getBaseTag','hasWeight','deduplicateTags','parsePromptStringWithCoordinates','centersToCoordinates','normalizeName','calculateMatchScore','collectCharacterCandidates','collectOutfitCandidates','findBestCharacterMatch','findBestOutfitMatch','collectNegativeToGlobal','processCharacterPrompt','processMultiCharacterPrompt','reconstructPromptString'];
    vm.runInContext(functions.map(nativeFunction).join('\n'),expander);expander.input=report.display.text;
    const output=vm.runInContext('processCharacterPrompt(input)',expander);
    assert(!output.includes('$'));assert(output.includes('black hair'));assert(output.includes('navy silk blouse'));
});
