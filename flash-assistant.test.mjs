import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFlashControls, storyExcerpt, enhanceWithFlash } from './flash-assistant.mjs';
import { readIdentityControls } from './identity.mjs';
test('Flash cannot overwrite a bound identity; keep vetoes proposed outfit reroll',()=>{
 const source='image###Scene Composition:ADEX{"person":"林曼","required":{"hair_color":["black"]},"outfit":{"required":{"color":["white"]}},"clothing":{"action":"change","description":"white dress"}}END She sits in her dress;###';
 const state={scope:'scope',people:{one:{person:'林曼',scope:'scope',prototype_id:'old',face_description:'oval face',wardrobe:{description:'navy dress'}}}};
 const result=mergeFlashControls(source,{people:[{person:'林曼',required:{hair_color:['blonde']},face_description:'round face',clothing:{action:'keep',description:'navy dress'}}]},state);
 const spec=readIdentityControls(result.text)[0].spec;
 assert.deepEqual(spec.required.hair_color,['black']);assert(!spec.face_description);assert(!spec.outfit);assert.deepEqual(spec.clothing,{action:'keep'});
 assert(result.text.includes('She sits in her dress'));assert.equal(state.people.one.prototype_id,'old');
});
test('new adult face design and missing conditions are added; explicit conditions win',()=>{
 const source='ADEX{"person":"新角色","required":{"hair_color":["black"]}}END scene';
 const result=mergeFlashControls(source,{people:[{person:'新角色',required:{hair_color:['red'],eye_color:['brown']},face_description:'mature oval face, narrow almond eyes',clothing:{action:'initial',description:'navy silk blouse, black skirt'}}]},{scope:'s',people:{}});
 const spec=readIdentityControls(result.text)[0].spec;
 assert.deepEqual(spec.required.hair_color,['black']);assert.deepEqual(spec.required.eye_color,['brown']);assert(spec.face_description.includes('almond'));assert.equal(spec.clothing.action,'initial');
});

test('scalar color facets normalize; face prose cannot contradict bound colors',()=>{
 const result=mergeFlashControls('ADEX{"person":"New"}END scene',{people:[{person:'New',required:{hair_color:'auburn',eye_color:'violet'},face_description:'mature oval face, green almond eyes, fine brows'}]},{scope:'s',people:{}});
 const spec=readIdentityControls(result.text)[0].spec;
 assert.deepEqual(spec.required.hair_color,['brown']);assert.deepEqual(spec.required.eye_color,['purple']);
 assert(!spec.face_description.includes('green'));assert(spec.face_description.includes('almond eyes'));
});
test('last-three bounded excerpt excludes image controls and planning',()=>{
 const value=storyExcerpt([{mes:'old private text'},{mes:'first prose image###ADEX{}END test;###'},{mes:'second prose ☆插图规划\nsecret drafts'},{mes:'third prose <details>hidden</details>'}]);
 assert(!value.includes('old private'));assert(!value.includes('ADEX'));assert(!value.includes('drafts'));assert(value.includes('third prose'));
 assert(storyExcerpt([{mes:'a'.repeat(15000)}]).length<=8500);
 assert.equal(storyExcerpt([{mes:'<thinking>private draft</thinking>visible prose'}]),'visible prose');
});
test('only pictured saved people are sent; native cache input stays untouched',async()=>{
 const source='ADEX{"person":"one"}END body';let payload;
 const state={scope:'s',people:{one:{person:'one',scope:'s',chosen_appearance_tags:['black hair'],wardrobe:{description:'blue dress'}},two:{person:'two',scope:'s',chosen_appearance_tags:['private unrelated']}}};
 const result=await enhanceWithFlash(source,state,[],{fetcher:async(_url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({people:[{person:'one',clothing:{action:'keep'}}],meta:{model:'deepseek-flash'}}));}});
 assert.equal(payload.current_people.length,1);assert.equal(payload.current_people[0].person,'one');assert.equal(result.meta.model,'deepseek-flash');assert.equal(source,'ADEX{"person":"one"}END body');
});
