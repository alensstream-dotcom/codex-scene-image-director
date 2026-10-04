import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareManualScene} from './manual-scene.mjs';
import {createManualController} from './manual-controller.mjs';
import {compileScene,validateConfirmedPrompt} from './scene-planner.mjs';
const early='Alice wears a grey shirt and sits by the window holding a teacup.',later='Later Alice wears a red dress and opens a gate.',raw=early+'\n\n'+later;
const state=()=>({scope:'one',version:1,people:{a:{person:'Alice',scope:'one',chosen_appearance_tags:['black hair'],face_description:'oval face',style:'mikko',wardrobe:{description:'red dress'}}}});
const snapshot=()=>({chatKey:'0::chat',messageId:0,raw,swipeId:0,selected:{start:0,end:early.length}});
const response={summary:'Alice 穿灰色上衣，坐在窗边捧着茶杯。',scene_composition:'sitting by a window, soft daylight',people:[{person:'Alice',clothing:{action:'change',description:'grey shirt'},action_prompt:'holding a teacup'}]};
const resolver={resolvePrompt(_p,s){const next=structuredClone(s);next.people.a.wardrobe={description:'grey shirt'};return {state:next};}};
test('manual selection needs one Flash call and excludes future story and offscreen cast',async()=>{
    const original=state();original.people.b={...structuredClone(original.people.a),person:'Beth'};let calls=0;
    const result=await prepareManualScene(snapshot(),{chat:[{mes:raw}],state:original,resolver,fetcher:async(url,opts)=>{
        calls++;assert(url.endsWith('/manual'));const p=JSON.parse(opts.body);assert.equal(p.scene,early);assert(!p.story.includes(later));assert.deepEqual(p.current_people.map(p=>p.person),['Alice']);return new Response(JSON.stringify(response));
    }});
    assert.equal(calls,1);assert.equal(original.people.a.wardrobe.description,'red dress');assert.equal(result.scene.insertAt,early.length);assert(result.scene.confirmed_prompt.includes('grey shirt'));assert.equal(result.scene.style,'mikko');
});
test('confirmed manual tags are authoritative across later cast changes',async()=>{
    const result=await prepareManualScene(snapshot(),{chat:[{mes:raw}],state:state(),resolver,fetcher:async()=>new Response(JSON.stringify(response))});
    const edited='Scene Composition: SFW, garden, @style:rdbt, 704x1152; Character 1 Prompt: black hair, green blouse, holding a book;';
    result.scene.confirmed_prompt=edited;result.state.people.a.chosen_appearance_tags=['pink hair'];result.state.people.a.wardrobe.description='blue dress';
    assert.equal(compileScene(result.scene,result.state),edited);
    assert.throws(()=>validateConfirmedPrompt('image###bad###'));
    assert.throws(()=>validateConfirmedPrompt('Scene Composition: room; Character 2 Prompt: sitting;'));
    assert.throws(()=>validateConfirmedPrompt('Scene Composition: room; Character 1 Prompt: sitting'));
});
test('malformed or unrelated manual response stops before local identity resolution',async()=>{
    for(const data of [{...response,people:[{person:'Unknown'}]},{...response,scene_composition:''},{...response,people:[]},{...response,people:[response.people[0],response.people[0]]}]){
        await assert.rejects(prepareManualScene(snapshot(),{chat:[{mes:raw}],state:state(),resolver:{resolvePrompt(){assert.fail('should not resolve');}},fetcher:async()=>new Response(JSON.stringify(data))}));
    }
});
test('already cancelled manual request never calls Flash',async()=>{
    const controller=new AbortController();controller.abort();await assert.rejects(prepareManualScene(snapshot(),{chat:[{mes:raw}],state:state(),resolver,signal:controller.signal,fetcher:()=>assert.fail('should not call')}));
});
function controllerFixture({fetcher}={}){
    let ctx={characterId:0,chatId:'chat',chat:[{mes:raw,swipe_id:0}],chatMetadata:{}},cast=state(),callbacks;const saves=[];
    const manual=createManualController({getContext:()=>ctx,getState:()=>cast,getResolver:async()=>resolver,fetcher:fetcher || (async()=>new Response(JSON.stringify(response))),save:async(target,next,scenes)=>saves.push({target,next,scenes}),viewFactory:c=>{callbacks=c;return {open:()=>c.onPrepare(),close(){c.onClose();}};}});
    return {manual,saves,get callbacks(){return callbacks;},get ctx(){return ctx;},set ctx(v){ctx=v;}};
}
test('manual preparation is staged and only explicit confirmation saves tags',async()=>{
    const f=controllerFixture(),result=await f.manual.open(snapshot());assert.equal(f.saves.length,0);
    result.scene.confirmed_prompt='Scene Composition: SFW, by a window; Character 1 Prompt: black hair, grey shirt, waving;';await f.callbacks.onConfirm(result);
    assert.equal(f.saves.length,1);assert.equal(f.saves[0].scenes[0].confirmed_prompt,result.scene.confirmed_prompt);
});
test('chat and swipe changes reject manual confirmation without writes',async()=>{
    for(const change of [ctx=>ctx.chatId='other',ctx=>ctx.chat[0].swipe_id=1,ctx=>ctx.chat[0].mes+=' changed']){
        const f=controllerFixture(),result=await f.manual.open(snapshot());change(f.ctx);await assert.rejects(f.callbacks.onConfirm(result),/改变/);assert.equal(f.saves.length,0);
    }
});
test('closing pending manual preparation cancels its late result',async()=>{
    let release;const hold=new Promise(r=>release=r),f=controllerFixture({fetcher:async()=>{await hold;return new Response(JSON.stringify(response));}});
    const pending=f.manual.open(snapshot());await new Promise(r=>setImmediate(r));f.manual.close();release();await assert.rejects(pending);assert.equal(f.saves.length,0);
});
test('failed regeneration still allows confirming the previous edited tags',async()=>{
    let fail=false;const f=controllerFixture({fetcher:async()=>fail?new Response('{}',{status:429}):new Response(JSON.stringify(response))});
    const previous=await f.manual.open(snapshot());previous.scene.confirmed_prompt='Scene Composition: SFW, window; Character 1 Prompt: black hair, green blouse, waving;';
    fail=true;await assert.rejects(f.callbacks.onPrepare(),/正在处理上一段/);await f.callbacks.onConfirm(previous);assert.equal(f.saves[0].scenes[0].confirmed_prompt,previous.scene.confirmed_prompt);
});
test('offline manual service gives a recoverable Chinese error after one request',async()=>{
    let calls=0;const original=state();
    await assert.rejects(prepareManualScene(snapshot(),{chat:[{mes:raw}],state:original,resolver,fetcher:async()=>{calls++;throw new TypeError('Failed to fetch');}}),/助手未连接.*启动绘图助手.*重新生成/);
    assert.equal(calls,1);assert.deepEqual(original,state());
});
