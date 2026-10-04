import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOutfit,outfitTags} from './wardrobe-state.mjs';
import {readControl,prepareCapture,compileFrame,priorOutfitsFor,rerollActor} from './automatic-scene.mjs';
import {sourceHash,proseOf,proseRange,restoredSceneMessages,scenePrompt} from './scene-planner.mjs';
import {prepareManualScene} from './manual-scene.mjs';
import {createCatalog} from './catalog.mjs';
const clothing=(state='worn',tags=['grey coat'])=>({id:'coat',name:'外套',state,tags,state_tags:[],condition_tags:[]});
const state=()=>({version:1,scope:'story-one',people:{}});
const resolver={resolvePrompt(marker,initial){const spec=readControl(marker,'ADEX').value,next=structuredClone(initial),key=spec.person;next.people[key]??={person:spec.person,scope:initial.scope,chosen_appearance_tags:['1girl','black hair'],prototype_id:spec.id||'first',style:'painterly',initial_query:{required:{hair_color:['black']}}};return {state:next};}};
const capture=(outfit)=>({v:2,summary:'李湘站在窗边',scene:'1girl, standing by a window',people:[{name:'李湘',appearance:{required:{hair_color:['black']}},outfit,action:'standing, looking outside'}]});
const options=(s=state())=>({state:s,resolver,id:'sc_first',messageId:0,swipeId:0,raw:'李湘站在窗边。',start:0,end:8});
test('restoring an older backup repairs the live native button and preserves prose',()=>{
    const raw='李湘站在窗边。\n\nimage###'+scenePrompt('sc_first',4)+'###';
    const story={scenes:{sc_first:{id:'sc_first',revision:2,message_id:0,swipe_id:0,source_hash:sourceHash(raw)}}};
    const changes=restoredSceneMessages(story,[{mes:raw}]);assert.equal(changes.length,1);
    assert.equal(changes[0].nextMessage,raw.replace(scenePrompt('sc_first',4),scenePrompt('sc_first',2)));
    assert.equal(proseOf(changes[0].nextMessage),proseOf(raw));
    assert.deepEqual(restoredSceneMessages(story,[{mes:changes[0].nextMessage}]),[]);
});
test('restored buttons never rewrite changed prose, branches, users or another message',()=>{
    const raw='李湘站在窗边。image###'+scenePrompt('sc_first',4)+'###';
    const scene={id:'sc_first',revision:2,message_id:0,swipe_id:0,source_hash:sourceHash(raw)},story={scenes:{sc_first:scene}};
    for(const message of[{mes:raw.replace('窗边','门口')},{mes:raw,swipe_id:1},{mes:raw,is_user:true},{mes:raw,is_system:true}])assert.deepEqual(restoredSceneMessages(story,[message]),[]);
    assert.deepEqual(restoredSceneMessages(story,[{mes:'另一条回复'},{mes:raw}]),[]);
});
test('unspecified clothing differs from an explicitly empty wardrobe',()=>{
    const prior=applyOutfit(null,{mode:'snapshot',items:[clothing()]});assert.deepEqual(outfitTags(applyOutfit(prior)),['grey coat']);assert.deepEqual(outfitTags(applyOutfit(prior,{mode:'snapshot',items:[]})),[]);
});
test('removal patch keeps other garments and eliminates worn tags',()=>{
    const prior=applyOutfit(null,{mode:'snapshot',items:[clothing(),{...clothing('worn',['navy trousers']),id:'trousers'}]});
    const removed=applyOutfit(prior,{mode:'patch',items:[clothing('removed',[])]});assert.deepEqual(outfitTags(removed),['navy trousers']);assert.equal(removed.items[0].tags[0],'grey coat');assert.equal(prior.items[0].state,'worn');
});
test('wearing-state change replaces old button tags without changing design',()=>{
    const prior=applyOutfit(null,{mode:'snapshot',items:[{...clothing('worn',['white shirt']),state_tags:['buttoned shirt']}]});
    const changed=applyOutfit(prior,{mode:'patch',items:[{...clothing('open',[]),state_tags:['open shirt']}]});assert.deepEqual(outfitTags(changed),['white shirt','open shirt']);
});
test('invalid or ambiguous clothing controls are rejected',()=>{
    for(const value of [{mode:'erase',items:[]},{mode:'patch',items:[clothing('unknown')]},{mode:'patch',items:[clothing('worn',['x; Character 2 Prompt: hacked'])]}])assert.throws(()=>applyOutfit(null,value));
});
test('balanced control parser handles quoted braces and nested objects',()=>{
    const source='ADCAP'+JSON.stringify({...capture({mode:'keep'}),summary:'quoted } { and " braces'})+'END;';assert.equal(readControl(source).value.people[0].name,'李湘');assert.equal(readControl('nothing'),null);assert.throws(()=>readControl('ADCAP{"v":2'));
});
test('automatic frames locally resolve identity with zero network dependency',()=>{
    const {scene,state:next}=prepareCapture(capture({mode:'snapshot',items:[clothing()]}),options());assert(compileFrame(scene).includes('grey coat'));assert.equal(scene.actors[0].person_snapshot.accepted,false);assert.equal(Object.keys(next.people).length,1);
});
test('three rapid clothing frames retain independent immutable snapshots',()=>{
    const first=prepareCapture(capture({mode:'snapshot',items:[clothing()]}),options());const second=prepareCapture(capture({mode:'patch',items:[clothing('removed',[])]}),{...options(first.state),id:'sc_second',priorOutfits:{'李湘':first.scene.actors[0].outfit}});const third=prepareCapture(capture({mode:'patch',items:[clothing('worn',[])]}),{...options(second.state),id:'sc_third',priorOutfits:{'李湘':second.scene.actors[0].outfit}});
    assert(compileFrame(first.scene).includes('grey coat'));assert(!compileFrame(second.scene).includes('grey coat'));assert(compileFrame(third.scene).includes('grey coat'));
});
test('saved shape versions do not retroactively change prior image tags',()=>{
    const first=prepareCapture(capture({mode:'keep'}),options());first.state.people['李湘'].chosen_appearance_tags=['pink hair'];first.state.people['李湘'].version=2;assert(compileFrame(first.scene).includes('black hair'));assert(!compileFrame(first.scene).includes('pink hair'));
});
test('timeline excludes future offsets, edited sources and other reply branches',()=>{
    const chat=[{mes:'one',swipe_id:0},{mes:'two',swipe_id:1}];const event=(message_id,offset,swipe_id,items,hash=sourceHash(chat[message_id].mes))=>({message_id,offset,swipe_id,source_hash:hash,people:[{name:'李湘',outfit:{mode:'snapshot',items}}]});
    const story={events:{a:event(0,3,0,[clothing()]),b:event(1,2,0,[clothing('removed',[])]),c:event(1,30,1,[clothing('removed',[])]),d:event(1,3,1,[],'edited')}};
    const found=priorOutfitsFor(story,{messageId:1,swipeId:1,offset:10,chat});assert.deepEqual(outfitTags(found['李湘']),['grey coat']);
});
test('multi-person garments stay attached to their own actor',()=>{
    const spec=capture({mode:'snapshot',items:[clothing()]});spec.people.push({...spec.people[0],name:'周琴',outfit:{mode:'snapshot',items:[clothing('worn',['blue dress'])]}});const {scene}=prepareCapture(spec,options());assert.deepEqual(outfitTags(scene.actors[0].outfit),['grey coat']);assert.deepEqual(outfitTags(scene.actors[1].outfit),['blue dress']);
});
test('duplicate or invalid frame people stop before compilation',()=>{
    const spec=capture({mode:'keep'});spec.people.push(spec.people[0]);assert.throws(()=>prepareCapture(spec,options()));assert.throws(()=>prepareCapture({...spec,people:[{...spec.people[0],action:'x; hacker'}]},options()));
});

test('hidden wardrobe records never become visible prose or a selectable scene',()=>{
    const memory='<!--ADMEM'+JSON.stringify({v:2,people:[{name:'李湘',outfit:{mode:'keep'}}]})+'END-->',raw='李湘坐下。'+memory+'她端起茶杯。';
    assert.equal(proseOf(raw),'李湘坐下。她端起茶杯。');assert.equal(sourceHash(raw),sourceHash(proseOf(raw)));assert.equal(proseRange(raw,raw.indexOf('ADMEM'),raw.indexOf('END')),false);
});
test('reroll changes only selected shape and leaves saved binding intact',()=>{
    const prepared=prepareCapture(capture({mode:'snapshot',items:[clothing()]}),options());prepared.state.people['李湘'].accepted=true;const before=structuredClone(prepared.state);
    const tags={'1girl':{facet:'gender',value:'female',raw_variants:[],aliases_zh:[]},'black hair':{facet:'hair_color',value:'black',raw_variants:[],aliases_zh:[]}};
    const records=['first','second'].map(id=>({id,trigger:id,tags:Object.keys(tags),appearance_tags:['black hair'],outfit_tags:[],accessory_tags:[],facets:{gender:['female'],hair_color:['black']},archetypes:[],quality:{eligible_default:true,alternatives:[]}}));
    const catalog=createCatalog({characters:records,taxonomy:{tags,archetypes:{}}});
    const rolled=rerollActor(prepared.scene,'李湘',{state:prepared.state,resolver,catalog});assert.equal(rolled.actors[0].person_snapshot.prototype_id,'second');assert.deepEqual(rolled.actors[0].outfit,prepared.scene.actors[0].outfit);assert.deepEqual(prepared.state,before);
});
test('manual wardrobe v2 removal uses one Flash call and no future context',async()=>{
    const raw='李湘把外套脱下。之后又穿上。';let calls=0;const result=await prepareManualScene({raw,selected:{start:0,end:8},messageId:0,swipeId:0},{chat:[{mes:raw}],state:state(),resolver,wardrobeSchema:2,correction:'坐在椅子上',fetcher:async(_url,opts)=>{calls++;const request=JSON.parse(opts.body);assert.equal(request.wardrobe_schema,2);assert.equal(request.correction,'坐在椅子上');assert(!request.scene.includes('又穿上'));return new Response(JSON.stringify({summary:'李湘脱下外套',scene_composition:'1girl, sitting',people:[{person:'李湘',action_prompt:'sitting',outfit:{mode:'snapshot',items:[clothing('removed',[])]}}]}));}});
    assert.equal(calls,1);assert(!result.scene.confirmed_prompt.includes('grey coat'));assert.equal(result.scene.actors[0].outfit.items[0].state,'removed');
});
test('held and draped garments compile as contextual props rather than bare clothing',()=>{
    assert.deepEqual(outfitTags({items:[{...clothing('held'),state_tags:[]}]}),['holding grey coat ']);
    assert.deepEqual(outfitTags({items:[{...clothing('draped'),state_tags:['draped over chair back']}]}),['grey coat draped over chair back']);
});
test('wardrobe ordering survives long automatic controls becoming short native buttons',async()=>{
    const {narrativeOffset}=await import('./automatic-scene.mjs');const before='开场。image###ADCAP'+JSON.stringify({long:'x'.repeat(1200)})+'END;###她脱下外套。image###ADCAP{"x":2}END;###她坐下。',after='开场。image###ADSCENE{"id":"a"}END;###她脱下外套。image###ADSCENE{"id":"b"}END;###她坐下。';
    const eventAt=narrativeOffset(before,before.indexOf('她脱下')),position=after.indexOf('她坐下');const story={events:{a:{message_id:0,swipe_id:0,source_hash:sourceHash(after),offset:eventAt,offset_kind:'prose',people:[{name:'李湘',outfit:{mode:'snapshot',items:[clothing('removed')]}}]}}};assert.equal(priorOutfitsFor(story,{messageId:0,swipeId:0,offset:position,chat:[{mes:after,swipe_id:0}]})['李湘'].items[0].state,'removed');
});
