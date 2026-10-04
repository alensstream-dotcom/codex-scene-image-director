import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createCatalog}from './catalog.mjs';
import {createIdentityResolver,usesPrototypeTrigger,usesImageReference,migrateIdentityFlags}from './identity.mjs';
import {prepareCapture,rerollActor,compileFrame}from './automatic-scene.mjs';
import {compileScene,sourceHash,scenePrompt}from './scene-planner.mjs';
import {createStoryApp}from './story-app.mjs';

const read=async p=>JSON.parse(await fs.readFile(new URL(p,import.meta.url),'utf8'));
const[characters,taxonomy,index]=await Promise.all([read('./data/characters.browser.json'),read('./data/taxonomy.json'),read('./indexes/character-index.json')]);
const catalog=createCatalog({characters,taxonomy,index});
const isolated={...catalog,retrieve:query=>catalog.retrieve({...query,exclude_ids:characters.filter(r=>r.id!=='nico_robin').map(r=>r.id),limit:1})};
const resolver=createIdentityResolver(isolated,{taxonomy});
const scope='identity-preference-tests';
const bind=()=>resolver.resolvePrompt('ADEX'+JSON.stringify({person:'李湘',age:30,required:{gender:'female',hair_color:'black',hair_length:'long',eye_color:'blue'},face_description:'mature oval face, gently arched eyebrows'})+'END',{version:1,scope,people:{}},{scope});
const options=state=>({state,resolver,id:'sc_test',messageId:0,swipeId:0,raw:'李湘在图书馆站着。',start:0,end:10});
const capture=appearance=>({v:2,summary:'李湘在图书馆站着',scene:'1girl, solo, adult woman, library',people:[{name:'李湘',appearance,action:'standing',outfit:{mode:'snapshot',items:[]}}]});

test('ordinary candidate metadata is retained but narrative frames omit the franchise trigger',()=>{
 const first=bind(),p=Object.values(first.state.people)[0];
 assert.equal(p.prototype_id,'nico_robin');assert.equal(p.prototype_trigger,'nico robin, one piece');assert.equal(p.exact_id,false);assert.equal(p.trigger_enabled,true);assert.equal(p.reference_enabled,false);
 assert(first.text.includes('nico robin, one piece'));assert.equal(first.bindings[0].trigger_included,true);assert(!first.text.includes('@character:'));
 const scene=prepareCapture(capture({}),options({...first.state,scope})).scene;assert(!compileFrame(scene).includes('nico robin, one piece'));assert.equal(scene.actors[0].person_snapshot.trigger_enabled,false);assert(!compileFrame(scene).includes('@character:'));
});

test('saved style survives a conflicting later automatic appearance block',()=>{
 const first=bind(),state={...first.state,scope},p=Object.values(state.people)[0];p.style='painterly';p.style_chosen=true;
 const next=prepareCapture(capture({style:'bluearchive',required:{hair_color:['blonde']}}),options(state));
 assert.equal(next.scene.style,'painterly');assert(next.scene.actors[0].person_snapshot.chosen_appearance_tags.includes('black hair'));assert(!next.scene.actors[0].person_snapshot.chosen_appearance_tags.includes('blonde hair'));assert(next.scene.actors[0].person_snapshot.chosen_appearance_tags.includes('long hair'));assert.equal(next.scene.actors[0].person_snapshot.prototype_trigger,p.prototype_trigger);
});

test('reroll retains age, new face hints, disabled automatic-trigger policy and locked style while leaving accepted person unchanged',()=>{
 const first=bind(),state={...first.state,scope},p=Object.values(state.people)[0];p.style='painterly';p.style_chosen=true;p.style_explicit=true;p.accepted=true;p.reference_enabled=true;p.reference_ids=['img_'+ '1'.repeat(64)];
 const prepared=prepareCapture(capture({}),options(state)),before=structuredClone(state),ordinaryResolver=createIdentityResolver(catalog,{taxonomy});
 assert.throws(()=>rerollActor(prepared.scene,'李湘',{state,catalog,resolver:ordinaryResolver}),/没有其它精确匹配/);
 const next=rerollActor(prepared.scene,'李湘',{state,catalog,resolver:ordinaryResolver,relax:true}),candidate=next.actors[0].person_snapshot;
 assert.notEqual(candidate.prototype_id,p.prototype_id);assert.equal(candidate.age_description,'30 years old');assert.equal(candidate.face_description,'');assert.equal(candidate.style,'painterly');assert.equal(candidate.trigger_enabled,false);assert.equal(candidate.exact_id,false);assert.equal(candidate.reference_enabled,true);assert(!candidate.reference_ids);assert.deepEqual(state,before);assert(!compileFrame(next).includes('@character:'));
});

test('legacy migration preserves old trigger and reference choices and all visual data',()=>{
 const p=Object.values(bind().state.people)[0],legacy={one:{...p,trigger_enabled:undefined,reference_enabled:undefined,exact_id:false,prototype_trigger:null,reference_ids:['img_'+ '2'.repeat(64)]},two:{...p,trigger_enabled:false,reference_enabled:false,exact_id:true,reference_ids:['img_'+ '3'.repeat(64)]}};
 const prior=structuredClone(legacy);assert.equal(migrateIdentityFlags(legacy,catalog),true);assert.equal(legacy.one.trigger_enabled,false);assert.equal(legacy.one.reference_enabled,true);assert.equal(legacy.one.prototype_trigger,'nico robin, one piece');assert.equal(legacy.two.trigger_enabled,false);assert.equal(legacy.two.reference_enabled,false);assert.deepEqual(legacy.one.chosen_appearance_tags,prior.one.chosen_appearance_tags);assert.deepEqual(legacy.one.reference_ids,prior.one.reference_ids);assert.equal(legacy.one.face_description,prior.one.face_description);assert.equal(legacy.one.age_description,prior.one.age_description);assert.equal(migrateIdentityFlags(legacy,catalog),false);
 assert.equal(usesPrototypeTrigger({exact_id:true}),true);assert.equal(usesImageReference({reference_ids:['old']}),true);
});

function appFixture({referenceEnabled=false}={}){
 globalThis.window={dispatchEvent(){}};globalThis.document={querySelectorAll(){return[];}};globalThis.CustomEvent=class{constructor(type,options){this.type=type;this.detail=options?.detail;}};
 const p=Object.values(bind().state.people)[0];p.style_chosen=true;p.exact_id=true;p.trigger_source='user';p.reference_enabled=referenceEnabled;p.reference_ids=['img_'+ '4'.repeat(64)];
 const state={version:1,scope,people:{p}},scene=prepareCapture(capture({}),options(state)).scene;scene.source_hash=sourceHash('李湘在图书馆站着。');
 let stored={id:'0::preferences',version:2,revision:1,cast:state,scenes:{[scene.id]:scene},events:{},processed:{}};let uploads=0;
 const context={characterId:0,chatId:'preferences',chat:[{mes:'李湘在图书馆站着。',swipe_id:0}],chatMetadata:{},setExtensionPrompt(){},extensionSettings:{'st-chatu8':{comfyuiUrl:'http://127.0.0.1:8188',worker:JSON.stringify({'1':{class_type:'AnimadexIdentityReference',inputs:{}}})}}};
 const data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
 const library={async getStory(){return structuredClone(stored);},async saveStory(value){stored={...structuredClone(value),revision:stored.revision+1};return structuredClone(stored);},async getAsset(){return{id:p.reference_ids[0],data};}};
 const fetcher=async(url,opts)=>{if(String(url).endsWith('/upload/image')){uploads++;return new Response(JSON.stringify({subfolder:'AnimadexIdentity',name:opts.body.get('image').name}));}return fetch(url,opts);};
 const app=createStoryApp({getContext:()=>context,getTools:async()=>({catalog,resolver}),persist:async()=>{},setting:()=>({enabled:true}),notify(){},library,fetcher});
 return{app,p,scene,get uploads(){return uploads;}};
}

test('unchanged person save and style-only edits retain explicit trigger, separate face and age fields',async()=>{
 const f=appFixture();await f.app.load();const before=Object.values(f.app.getStory().cast.people)[0];
 await f.app.updatePerson('李湘',{tags:[...before.chosen_appearance_tags],style:'mikko',age_description:before.age_description,face_description:before.face_description,trigger_enabled:before.trigger_enabled,reference_enabled:before.reference_enabled});
 const after=Object.values(f.app.getStory().cast.people)[0];assert.equal(after.prototype_trigger,before.prototype_trigger);assert.equal(after.exact_id,true);assert.equal(after.trigger_enabled,true);assert.equal(after.face_description,before.face_description);assert.equal(after.age_description,'30 years old');assert.equal(after.style,'mikko');assert.deepEqual(after.reference_ids,before.reference_ids);
 const scene={style:after.style,actors:[{person:'李湘',action_prompt:'standing',wardrobe:{description:'white buttoned shirt, navy trousers'}}]};assert(compileScene(scene,{scope,people:{p:after}}).includes('nico robin, one piece'));
});

test('stored reference asset is retained but omitted from transport when enhancement is disabled',async()=>{
 const f=appFixture();await f.app.load();const request={id:'reference_off',prompt:scenePrompt(f.scene.id,1)};await f.app.bridge(request);assert(!request.animadexAbort,request.animadexAbort);assert.deepEqual(request.animadexReferenceFiles,[]);assert.equal(f.uploads,0);assert.deepEqual(Object.values(f.app.getStory().cast.people)[0].reference_ids,f.p.reference_ids);
});

test('explicit image-reference enhancement reaches native transport with the owned asset',async()=>{
 const f=appFixture({referenceEnabled:true});await f.app.load();const request={id:'reference_on',prompt:scenePrompt(f.scene.id,1)};await f.app.bridge(request);assert(!request.animadexAbort,request.animadexAbort);assert.equal(request.animadexReferenceFiles.length,1);assert.equal(f.uploads,1);assert(request.animadexReferenceFiles[0].includes(f.p.reference_ids[0]));
});
