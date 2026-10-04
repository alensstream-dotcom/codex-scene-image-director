import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateStudioState} from './studio-migration.mjs';
import {createStudioPersistence,hostChatKey} from './studio-persistence.mjs';
import {prepareScenes} from './scene-session.mjs';
import {validatePlan,readSceneControl,scenePrompt} from './scene-planner.mjs';
const fixture=()=>({version:1,scope:'scope-one',people:{a:{person:'Alice',scope:'scope-one',chosen_appearance_tags:['black hair'],wardrobe:{description:'grey shirt'},style:'painterly'}}});
test('one-time native migration preserves source assets, media and other-chat scope',()=>{
    const native={characterPresets:{manual:{nameCN:'Beth',nameEN:'Beth',characterTraits:'1girl, brown hair',facialFeatures:'green eyes',outfits:['dress'],photoMedia:[{id:'keep'}]},'Animadex·Else·different':{nameCN:'Else',characterTraits:'pink hair'}},characterEnablePresetId:'list',characterEnablePresets:{list:{characters:['manual','Animadex·Else·different']}},outfitEnablePresetId:'list',outfitEnablePresets:{list:{outfits:['dress']}},outfitPresets:{dress:{owner:'Beth',upperBody:'ivory blouse',fullBody:'navy skirt'}}};
    const before=structuredClone(native),migrated=migrateStudioState(fixture(),native);
    assert.deepEqual(native,before);assert.equal(Object.values(migrated.state.people).length,2);
    const beth=Object.values(migrated.state.people).find(p=>p.person==='Beth');assert.equal(beth.wardrobe.description,'ivory blouse, navy skirt');
    beth.chosen_appearance_tags=['red hair'];native.characterPresets.manual.characterTraits='blue hair';
    const again=migrateStudioState(migrated.state,native);assert.equal(again.changed,false);assert.deepEqual(Object.values(again.state.people).find(p=>p.person==='Beth').chosen_appearance_tags,['red hair']);
});
test('scene resolver cannot erase migrated authority metadata',async()=>{
    const state=fixture();state.studio_migration={version:1,authority:'studio'};
    const raw='Alice sits at the window.',planned=validatePlan({scenes:[{anchor:raw,people:['Alice']}]},raw);
    const result=await prepareScenes(planned,{chat:[{mes:raw}],messageId:0,state,resolver:{resolvePrompt(_p,s){return {state:{version:s.version,scope:s.scope,people:s.people}};}},fetcher:async()=>new Response(JSON.stringify({people:[{person:'Alice',clothing:{action:'keep'}}]}))});
    assert.deepEqual(result.state.studio_migration,state.studio_migration);
});
const host=id=>({characterId:0,chatId:id,characters:[{name:'Alice Card',avatar:'card.png'}],chatMetadata:{unrelated:{keep:true},lastInContextMessageId:2},chat:[{mes:'Original',swipe_id:0,swipes:['Original']}]});
test('one queued save pins target, metadata, body and active swipe together',async()=>{
    let ctx=host('one'),saved;const persist=createStudioPersistence({getContext:()=>ctx,enqueue:fn=>fn(),saveCharacter:async value=>{saved=value;}});
    const result=await persist({expectedKey:hostChatKey(ctx),messageId:0,expectedRaw:'Original',nextMessage:'Changed',patchMetadata:{cast:{people:[]}}});
    assert(result.sameChat);assert.equal(saved.fileName,'one');assert.equal(saved.avatarUrl,'card.png');assert.equal(saved.payload[1].swipes[0],'Changed');assert.deepEqual(saved.payload[0].chat_metadata.unrelated,{keep:true});assert(!('lastInContextMessageId' in saved.payload[0].chat_metadata));
});
test('queued work rejects a switched chat before any disk write or mutation',async()=>{
    let ctx=host('one'),queued,writes=0;const old=ctx;
    const persist=createStudioPersistence({getContext:()=>ctx,enqueue:fn=>{queued=fn;return Promise.resolve();},saveCharacter:async()=>writes++});
    await persist({expectedKey:hostChatKey(ctx),patchMetadata:{cast:'bad'}});ctx=host('two');await assert.rejects(queued,/改变/);assert.equal(writes,0);assert(!('cast' in old.chatMetadata));assert(!('cast' in ctx.chatMetadata));
});
test('in-flight save stays pinned and failure restores only original objects',async()=>{
    let ctx=host('one'),release,started;const old=ctx;
    const pending=new Promise(resolve=>release=resolve);
    const persist=createStudioPersistence({getContext:()=>ctx,enqueue:fn=>fn(),saveCharacter:async value=>{started=value;await pending;throw Error('disk full');}});
    const result=persist({expectedKey:hostChatKey(ctx),messageId:0,expectedRaw:'Original',nextMessage:'Changed',patchMetadata:{cast:'draft'}});
    assert.equal(started.fileName,'one');ctx=host('two');release();await assert.rejects(result,/保存失败/);
    assert.equal(old.chat[0].mes,'Original');assert.equal(old.chat[0].swipes[0],'Original');assert(!('cast' in old.chatMetadata));assert(!('cast' in ctx.chatMetadata));
});
test('group chat saves use the group chat file and do not call character transport',async()=>{
    const ctx={...host('group-file'),groupId:'group-id'};let saved;
    const persist=createStudioPersistence({getContext:()=>ctx,enqueue:fn=>fn(),saveGroup:async value=>saved=value,saveCharacter:()=>assert.fail('wrong transport')});
    await persist({expectedKey:hostChatKey(ctx),patchMetadata:{cast:'owned'}});assert.equal(saved.id,'group-file');
});
test('control revisions are strict and environment fallback must be a boolean',()=>{
    assert.deepEqual(readSceneControl(scenePrompt('scene-one',2)),{id:'scene-one',revision:2});assert.equal(readSceneControl('ADSCENE{"id":"one","rev":0}END'),null);
    assert.throws(()=>validatePlan({scenes:[{anchor:'empty room',people:[],environment_only:'true'}]},'empty room'));
    assert.throws(()=>validatePlan({scenes:[{anchor:'Alice sits.',people:['Beth']}]},'Alice sits. Later Beth arrives.',{selected:{start:0,end:42}}));
});
