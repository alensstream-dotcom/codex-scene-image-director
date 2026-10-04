import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePlan,locateExcerpt,contextAt,sourceHash,insertSceneButtons,compileScene,planScenes,proseRange}from './scene-planner.mjs';
import {prepareScenes,commitState,sceneIsCurrent}from './scene-session.mjs';

const story='周琴穿灰色短袖坐在窗边，捧着茶杯。\n\n稍后周琴换上藏蓝连衣裙，走到院里。';
const candidate={anchor:'周琴穿灰色短袖坐在窗边，捧着茶杯。',people:['周琴'],composition:'sitting on a chair'};
const state={version:1,scope:'chat-one',people:{one:{person:'周琴',scope:'chat-one',chosen_appearance_tags:['black hair','hair bun','brown eyes'],face_description:'oval face',wardrobe:{description:'grey shirt, navy trousers'},style:'painterly'},offscreen:{person:'场外人物',scope:'chat-one',chosen_appearance_tags:['red hair']}}};
test('selected duplicate text resolves inside selected range',()=>{
    const raw='周琴坐下。\n周琴坐下。',start=raw.lastIndexOf('周琴');
    assert.throws(()=>locateExcerpt(raw,'周琴坐下。'));
    const result=validatePlan({scenes:[{anchor:'周琴坐下。',people:['周琴']}]},raw,{selected:{start,end:raw.length}});
    assert.equal(result[0].start,start);assert.equal(result[0].insertAt,raw.length);
});
test('future wardrobe is excluded from target context',()=>{
    const end=story.indexOf('\n');const context=contextAt([{mes:'上次见面。'},{mes:story}],1,end);
    assert(context.includes('灰色'));assert(!context.includes('连衣裙'));
});
test('inserting buttons preserves prose fingerprint and scene validity',()=>{
    const scenes=validatePlan({scenes:[candidate]},story);scenes[0].id='one';scenes[0].source_hash=sourceHash(story);
    const changed=insertSceneButtons(story,scenes);
    assert.equal(sourceHash(changed),sourceHash(story));assert(sceneIsCurrent(scenes[0],{mes:changed}));
    assert(!sceneIsCurrent(scenes[0],{mes:story.replace('茶杯','手机')}));
});
test('thoughts and status cannot become scene anchors or a manual selection',()=>{
    const raw='<think>周琴正在跑步。</think>\n周琴坐下。<status>周琴在换装。</status>';
    assert.throws(()=>validatePlan({scenes:[{anchor:'周琴正在跑步。',people:['周琴']}]},raw));
    assert(!proseRange(raw,raw.indexOf('周琴在换装'),raw.indexOf('周琴在换装')+6));
});
test('unknown, future and offscreen names do not create cast records',()=>{
    const result=validatePlan({scenes:[{...candidate,people:['周琴','不存在','稍后才出现']}]},story);
    assert.deepEqual(result[0].people,['周琴']);
});
test('immutable frame clothing and gestures survive later changes',()=>{
    const scene={composition:'sitting at the window',actors:[{person:'周琴',wardrobe:{description:'grey T-shirt'},action_prompt:'adjusting her collar, holding a teacup'}],style:'rdbt'};
    const later=structuredClone(state);later.people.one.wardrobe={description:'navy dress'};
    const text=compileScene(scene,later);assert(text.includes('grey T-shirt'));assert(!text.includes('navy dress'));assert(text.includes('adjusting her collar'));assert(text.includes('hair bun'));assert(!text.includes('ADEX'));assert(!text.includes('$'));
});
test('only pictured saved people are sent and snapshot preparation never mutates source state',async()=>{
    let request;
    const resolver={resolvePrompt(_source,before){return {state:structuredClone(before)};}};
    const planned=validatePlan({scenes:[candidate]},story);
    const result=await prepareScenes(planned,{chat:[{mes:story}],messageId:0,state,resolver,fetcher:async(_url,opts)=>{
        request=JSON.parse(opts.body);return new Response(JSON.stringify({people:[{person:'周琴',clothing:{action:'keep'},action_prompt:'holding a cup'}],scene_composition:'sitting at the window'}));
    }});
    assert.deepEqual(request.current_people.map(p=>p.person),['周琴']);assert(!request.story.includes('连衣裙'));assert(request.scene_bound);
    assert.equal(result.scenes[0].actors[0].wardrobe.description,'grey shirt, navy trousers');
    result.scenes[0].actors[0].wardrobe.description='changed';assert.equal(state.people.one.wardrobe.description,'grey shirt, navy trousers');
});
test('manual historical preparation preserves current outfit but can add a new person',()=>{
    const previous=structuredClone(state),staged=structuredClone(state);staged.people.one.wardrobe.description='old outfit';staged.people.new={person:'新人物',wardrobe:{description:'new shirt'}};
    const result=commitState(previous,staged,{historical:true});assert.equal(result.people.one.wardrobe.description,previous.people.one.wardrobe.description);assert(result.people.new);
});
test('malformed API response and 429 stop before identities are resolved',async()=>{
    let calls=0;const resolver={resolvePrompt(){calls++;}};
    const args={chat:[{mes:story}],messageId:0,state,resolver};
    await assert.rejects(()=>prepareScenes([candidate],{...args,fetcher:async()=>new Response('{}',{status:429})}),/429/);
    await assert.rejects(()=>prepareScenes([candidate],{...args,fetcher:async()=>new Response('{}')}),/格式/);assert.equal(calls,0);
    await assert.rejects(()=>planScenes(story,{fetcher:async()=>new Response('{"scenes":[]}')}),/未找到/);
});
test('cancelled requests never begin extraction',async()=>{
    const controller=new AbortController();controller.abort();let calls=0;
    await assert.rejects(()=>prepareScenes([candidate],{chat:[{mes:story}],messageId:0,state,resolver:{},signal:controller.signal,fetcher:async()=>{calls++;}}));assert.equal(calls,0);
});
