import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ageGroup,isMinorAppearance,protectStoryTraits,protectIdentityTags,isYouthAppearance,nativeBodyVisibility,nativeBodyField,emptyNativeBodyFields,CATALOG_PREVIEW_POLICY} from './drawing-policy.mjs';
test('central age classification preserves appearance groups without treating young as minor',()=>{
    for(const [age,expected]of [['12','child'],['13','young'],['17','young'],['18','young'],['29','young'],['30','mature'],['未知',''],['少女','young'],['少妇','mature']])assert.equal(ageGroup(age),expected);
    assert.equal(isMinorAppearance('18 years old',{group:'young'}),false);
    assert.equal(isMinorAppearance('17 years old',{group:'young'}),true);
});
test('age predicates preserve both existing caller semantics',()=>{
    for(const age of ['', 'child','teenage','17 years old','18 years old','30 years old','Teenage','17岁'])for(const group of ['','child','young','mature']){
        const old=group==='child'||/^\d+ years old$/.test(age)&&parseInt(age)<18||/teenage|child/i.test(age);
        assert.equal(isMinorAppearance(age,{group,ignoreCase:true}),old);
    }
});
test('story age protection removes only the bust trait and retains appearance facts',()=>{
    const f={age_group:['young'],hair_color:['black'],bust:['large breasts'],build:['slender']};
    assert.equal(protectStoryTraits(f,'17 years old'),true);
    assert.deepEqual(f,{age_group:['young'],hair_color:['black'],build:['slender']});
    const adult={age_group:['young'],bust:['medium breasts']};assert.equal(protectStoryTraits(adult,'28 years old'),false);assert(adult.bust);
});
test('identity age protection preserves order and does not mutate tag arrays',()=>{
    const tags=['black hair','large breasts','slender','blue eyes'],info={'large breasts':{facet:'bust'},slender:{facet:'build'}};
    assert.deepEqual(protectIdentityTags(tags,'17 years old',info),['black hair','blue eyes']);
    assert.equal(tags.length,4);assert.strictEqual(protectIdentityTags(tags,'28 years old',info),tags);
});
test('caption age wording does not infer an unstated numerical age',()=>{
    assert.equal(isYouthAppearance({age_group:['young']},[]),false);
    assert.equal(isYouthAppearance({age_group:['child']},[]),true);
    assert.equal(isYouthAppearance({},['teenage']),true);
});
test('legacy SFW field names and visibility are exact schema values',()=>{
    assert.equal(nativeBodyVisibility(),'sfw');assert.equal(nativeBodyVisibility(false),'hidden');
    assert.equal(nativeBodyField({full:true,back:true}),'fullBodySFWBack');
    assert.equal(Object.keys(emptyNativeBodyFields()).length,8);assert(Object.values(emptyNativeBodyFields()).every(v=>v===''));
});
test('offline Python builder can read the same preview policy through Node',()=>{
    const result=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./drawing-policy.mjs',import.meta.url)),'--export-catalog-policy'],{encoding:'utf8'}));
    assert.deepEqual(result,CATALOG_PREVIEW_POLICY);assert.equal(result.knownChildIds.length,10);assert.equal(result.blockedTags.length,11);
});
