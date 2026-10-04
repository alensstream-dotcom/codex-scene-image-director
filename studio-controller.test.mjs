import test from 'node:test';
import assert from 'node:assert/strict';
import {installStoryStudio} from './story-studio.mjs';
import {createStudioPersistence} from './studio-persistence.mjs';
import {CAST_KEY} from './scene-session.mjs';
import {SCENE_KEY,scenePrompt} from './scene-planner.mjs';
globalThis.document={querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};
globalThis.window={getSelection:()=>null};globalThis.MutationObserver=class{observe(){}};
const story='Alice wears a grey shirt and sits by the window holding a teacup.\n\nLater Alice wears a navy dress and opens the garden gate.';
function fixture({fetcher,write,resolve,raw=story}={}){
    let ctx={characterId:0,chatId:'one',characters:[{name:'Card',avatar:'card.png'}],chat:[{mes:raw,swipe_id:0,swipes:[raw]}],chatMetadata:{[CAST_KEY]:{version:1,scope:'scope',studio_migration:{version:1,authority:'studio'},people:{alice:{person:'Alice',scope:'scope',chosen_appearance_tags:['black hair','hair bun','brown eyes'],face_description:'oval face',wardrobe:{description:'navy dress'},style:'painterly'}}}},saveSettingsDebounced(){},updateMessageBlock(){},eventSource:{async emit(_name,request){assert(studio.bridge(request));studio.returned({id:request.id,success:true});}}};
    let callbacks,model;const writes=[],settings={enabled:true,studio:{enabled:true,auto:true,maxScenes:3}};
    const mockedFetch=async(url,opts)=>{
        const data=JSON.parse(opts.body);
        if(url.endsWith('/plan'))return new Response(JSON.stringify({scenes:[{anchor:story.split('\n')[0],people:['Alice'],composition:'full body, sitting at the window'}]}));
        assert(!data.story.includes('garden gate'));return new Response(JSON.stringify({people:[{person:'Alice',clothing:{action:'change',description:'grey shirt, navy trousers'},action_prompt:'holding a teacup'}],scene_composition:'full body, sitting at the window'}));
    };
    const persist=createStudioPersistence({getContext:()=>ctx,enqueue:fn=>fn(),saveCharacter:async p=>{writes.push(p);await write?.(p);}});
    const resolver={resolvePrompt:resolve || ((prompt,state)=>{const next=structuredClone(state);next.people.alice.wardrobe={description:'grey shirt, navy trousers'};return {state:next};})};
    const studio=installStoryStudio({getContext:()=>ctx,getResolver:async()=>resolver,persist,setting:()=>settings,notify(){},diagnostics(){},fetcher:fetcher || mockedFetch,viewFactory:c=>{callbacks=c;return {open:m=>model=m,update:m=>Object.assign(model,m),close(){c.onClose?.();}};}});
    return {studio,writes,settings,get ctx(){return ctx;},set ctx(value){ctx=value;},get callbacks(){return callbacks;},get model(){return model;}};
}
test('automatic planning is idempotent and saves buttons without GPU submission',async()=>{
    const f=fixture();await f.studio.autoPlan();await f.studio.autoPlan();assert.equal(f.writes.length,1);assert.equal(Object.keys(f.ctx.chatMetadata[SCENE_KEY].scenes).length,1);assert(f.ctx.chat[0].mes.includes(scenePrompt(Object.keys(f.ctx.chatMetadata[SCENE_KEY].scenes)[0],1)));assert.equal(f.ctx.chatMetadata[CAST_KEY].studio_migration.authority,'studio');
});
test('optional automatic rendering submits each saved frame once through native bridge',async()=>{
    const f=fixture();f.settings.studio.autoGenerate=true;let requests=0;
    f.ctx.eventSource.emit=async(_name,request)=>{requests++;assert(f.studio.bridge(request));assert(request.animadexSceneReady);f.studio.returned({id:request.id,success:true});};
    await f.studio.autoPlan();await f.studio.autoPlan();assert.equal(requests,1);assert.equal(f.writes.length,1);
});
test('editing a saved frame creates a new cache revision with immutable outfit history',async()=>{
    const f=fixture();await f.studio.autoPlan();f.studio.open(0);const model=f.model,scene=model.scenes[0];assert.equal(scene.actors[0].wardrobe.description,'grey shirt, navy trousers');
    scene.actors[0].wardrobe.description='ivory blouse';scene.status='draft';const update=await f.callbacks.onSave(model);assert.equal(update.scenes[0].revision,2);
    const saved=f.ctx.chatMetadata[SCENE_KEY].scenes[scene.id];assert.equal(saved.history[0].actors[0].wardrobe.description,'grey shirt, navy trousers');assert(f.ctx.chat[0].mes.includes(scenePrompt(scene.id,2)));assert(!f.ctx.chat[0].mes.includes(scenePrompt(scene.id,1)));
    const oldRequest={id:'old',prompt:scenePrompt(scene.id,1)};f.studio.bridge(oldRequest);assert(oldRequest.animadexAbort);
});
test('native generation compiles clothes and action from the saved frame, not latest wardrobe',async()=>{
    const f=fixture();await f.studio.autoPlan();f.ctx.chatMetadata[CAST_KEY].people.alice.wardrobe.description='red dress';
    const scene=Object.values(f.ctx.chatMetadata[SCENE_KEY].scenes)[0],request={id:'test',prompt:scenePrompt(scene.id,1)};
    assert(f.studio.bridge(request));assert(request.animadexSceneReady);assert(request.change.includes('grey shirt'));assert(request.change.includes('holding a teacup'));assert(!request.change.includes('red dress'));
    f.ctx.chatId='two';assert(f.studio.bridge({prompt:scenePrompt(scene.id,1),id:'next'}));assert(request.animadexValidate().includes('切换'));
});
test('changing swipe or prose rejects previously prepared GPU work',async()=>{
    const f=fixture();await f.studio.autoPlan();const scene=Object.values(f.ctx.chatMetadata[SCENE_KEY].scenes)[0],request={id:'test',prompt:scenePrompt(scene.id,1)};f.studio.bridge(request);
    f.ctx.chat[0].swipe_id=1;assert(request.animadexValidate());f.ctx.chat[0].swipe_id=0;f.ctx.chat[0].mes+='Changed action.';assert(request.animadexValidate());
});
test('partial extraction and HTTP failure leave messages, cast and disk untouched',async()=>{
    for(const response of [new Response('{}',{status:429}),new Response(JSON.stringify({scenes:[]}))]){
        const f=fixture({fetcher:async()=>response});const before=structuredClone(f.ctx.chatMetadata);await f.studio.autoPlan();assert.equal(f.writes.length,0);assert.deepEqual(f.ctx.chatMetadata,before);assert.equal(f.ctx.chat[0].mes,story);
    }
});
test('chat switch cancels a pending planner before extraction or save',async()=>{
    let release,calls=0;const started=new Promise(resolve=>release=resolve),f=fixture({fetcher:async()=>{calls++;await started;return new Response(JSON.stringify({scenes:[{anchor:story.split('\n')[0],people:['Alice']}]}));}});
    const running=f.studio.autoPlan();await new Promise(resolve=>setImmediate(resolve));f.ctx.chatId='two';f.studio.onChatChanged();release();await running;assert.equal(calls,1);assert.equal(f.writes.length,0);
});
test('a failed persistence restores body, swipe, and cast as one operation',async()=>{
    const f=fixture({write:()=>{throw Error('disk full');}}),before=structuredClone(f.ctx.chatMetadata);await f.studio.autoPlan();assert.equal(f.ctx.chat[0].mes,story);assert.equal(f.ctx.chat[0].swipes[0],story);assert.deepEqual(f.ctx.chatMetadata,before);
});
test('clothing-only person edit retains named character identity and old snapshots',async()=>{
    const f=fixture();await f.studio.autoPlan();const person=f.ctx.chatMetadata[CAST_KEY].people.alice;person.exact_id=true;person.prototype_id='named';person.prototype_trigger='named character';f.studio.open(0,{tab:'people'});
    const changed=structuredClone(person);changed.wardrobe.description='green blouse';await f.callbacks.onPersonSave(changed);assert(f.ctx.chatMetadata[CAST_KEY].people.alice.exact_id);assert.equal(Object.values(f.ctx.chatMetadata[SCENE_KEY].scenes)[0].actors[0].wardrobe.description,'grey shirt, navy trousers');
});

test('excluded later frame cannot advance wardrobe or register unseen people',async()=>{
    const early=story.split('\n')[0],late='Later Alice wears a red coat and Beth arrives in a green dress.',raw=early+'\n\n'+late;let frame=0;
    const f=fixture({raw,fetcher:async(url,opts)=>url.endsWith('/plan')?new Response(JSON.stringify({scenes:[{anchor:early,people:['Alice']},{anchor:late,people:['Alice','Beth']}]})):new Response(JSON.stringify({people:JSON.parse(opts.body).controls.map(p=>({...p,action_prompt:'standing'}))})),resolve:(_p,state)=>{
        const next=structuredClone(state);next.people.alice.wardrobe={description:++frame===1?'grey shirt':'red coat'};
        if(frame===2)next.people.beth={...structuredClone(next.people.alice),person:'Beth',wardrobe:{description:'green dress'}};
        return {state:next};
    }});
    f.studio.open(0);Object.assign(f.model,await f.callbacks.onPlan(f.model));f.model.scenes[1].excluded=true;
    await f.callbacks.onSave(f.model);
    assert.equal(f.ctx.chatMetadata[CAST_KEY].people.alice.wardrobe.description,'grey shirt');
    assert(!Object.values(f.ctx.chatMetadata[CAST_KEY].people).some(p=>p.person==='Beth'));
    assert.equal(Object.keys(f.ctx.chatMetadata[SCENE_KEY].scenes).length,1);
});

test('editing a newly prepared person saves it without losing other staged people',async()=>{
    const raw='Alice and Beth sit by the window.';
    const f=fixture({raw,fetcher:async(url)=>new Response(JSON.stringify(url.endsWith('/plan')?{scenes:[{anchor:raw,people:['Alice','Beth']}]}:{people:[{person:'Alice',action_prompt:'sitting'},{person:'Beth',action_prompt:'sitting'}]})),resolve:(_p,state)=>{
        const next=structuredClone(state);for(const name of ['Alice','Beth'])next.people[name.toLowerCase()]={person:name,scope:state.scope,chosen_appearance_tags:['black hair'],face_description:'oval face',style:'painterly',wardrobe:{description:'grey shirt'}};return {state:next};
    }});f.ctx.chatMetadata[CAST_KEY].people={};
    f.studio.open(0);Object.assign(f.model,await f.callbacks.onPlan(f.model));
    const changed=structuredClone(f.model.people.find(p=>p.person==='Alice'));changed.face_description='almond eyes';
    await f.callbacks.onPersonSave(changed);assert.equal(f.ctx.chatMetadata[CAST_KEY].people.alice.face_description,'almond eyes');assert(!f.ctx.chatMetadata[CAST_KEY].people.beth);
    await f.callbacks.onSave(f.model);assert(f.ctx.chatMetadata[CAST_KEY].people.beth);assert.equal(f.ctx.chatMetadata[CAST_KEY].people.alice.face_description,'almond eyes');
});
