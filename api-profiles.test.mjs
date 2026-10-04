import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureApiProfiles,createApiProfileStore,apiBase,fetchApiModels} from './api-profiles.mjs';
import {manualConnection,createManualTransport} from './manual-transport.mjs';
const native=()=>({llm_profiles:{默认:{api_url:'https://old.example.test/v1',api_key:'old-test-key',model:'model-a'}},current_llm_profile:'默认'});
test('migration copies the selected drawing API once without changing native or primary settings',()=>{
    const original=native(),snapshot=structuredClone(original),settings={};const store=ensureApiProfiles(settings,original);
    assert.equal(settings.manual_transport,'plugin');assert.equal(store.profiles[0].api_key,'old-test-key');assert.deepEqual(original,snapshot);
    original.llm_profiles.默认.api_key='new-native-key';assert.equal(ensureApiProfiles(settings,original).profiles[0].api_key,'old-test-key');
});
test('explicit helper preference survives migration, blank new installation is configurable',()=>{
    const s={manual_transport:'helper'};ensureApiProfiles(s,{});assert.equal(s.manual_transport,'helper');assert.equal(s.api_profiles.profiles[0].api_url,'');
});
test('save and switch actually change the next request URL key and model',async()=>{
    const settings={},base=native(),store=createApiProfileStore({setting:()=>settings,native:()=>base});store.listApiProfiles();
    const ctx={extensionSettings:{'st-chatu8':base}},sent=[];const request=createManualTransport({getContext:()=>ctx,setting:()=>settings,fetcher:async(url,opts)=>{sent.push({url,headers:opts.headers,body:JSON.parse(opts.body)});return Response.json({choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}]});}});
    const original=store.listApiProfiles()[0],added=store.saveApiProfile({name:'备用',api_url:'https://new.example.test/v2',api_key:'new-test-key',model:'model-b',bypass_proxy:true});
    await request({test:true});assert.equal(sent[0].url,'https://new.example.test/v2/chat/completions');assert.equal(sent[0].headers.Authorization,'Bearer new-test-key');assert.equal(sent[0].body.model,'model-b');
    store.useApiProfile(original.id);await request({test:true});assert.equal(sent[1].url,'/api/backends/chat-completions/generate');assert.equal(sent[1].body.model,'model-a');assert.equal(sent[1].body.custom_url,'https://old.example.test/v1');assert.equal(manualConnection(ctx,settings).kind,'plugin');assert.notEqual(added.id,original.id);
});
test('profile names export import and deletion preserve a valid active profile and never export keys by default',()=>{
    const settings={},store=createApiProfileStore({setting:()=>settings,native});const first=store.listApiProfiles()[0];
    const second=store.saveApiProfile({name:'第二套',api_key:'private-test',api_url:'https://api.example.test/v1',model:'m',custom_headers:'Authorization: other-private-test'});
    const exported=store.exportApiProfiles();assert(!JSON.stringify(exported).includes('private-test'));assert(JSON.stringify(store.exportApiProfiles({includeKey:true})).includes('private-test'));
    const added=store.importApiProfiles(exported);assert.equal(added.length,2);assert.equal(store.listApiProfiles().find(p=>p.active).id,second.id);assert.equal(new Set(store.listApiProfiles().map(p=>p.name)).size,4);
    store.deleteApiProfile(second.id);assert(store.listApiProfiles().some(p=>p.active));assert.throws(()=>store.saveApiProfile({...first,id:undefined}),/名称已存在/);
});
test('URL validation normalizes endpoint suffixes without guessing versions and blocks credential URLs',()=>{
    assert.equal(apiBase('https://api.example.test/v2/chat/completions/'),'https://api.example.test/v2');assert.equal(apiBase('http://192.168.1.4:8000/models'),'http://192.168.1.4:8000');
    for(const value of ['file:///tmp/x','https://user:password@api.example.test/v1','https://api.example.test/v1?key=secret'])assert.throws(()=>apiBase(value));
});
test('model list uses the same selected profile and proxy headers without changing the typed model',async()=>{
    const p={...native().llm_profiles.默认,name:'默认',enable_custom_headers:true,custom_headers:'X-Client: test',model:'unlisted-custom'},before=structuredClone(p);
    const models=await fetchApiModels(p,{getContext:()=>({getRequestHeaders:()=>({'X-CSRF-Token':'csrf'})}),fetcher:async(url,opts)=>{assert.equal(url,'/api/backends/chat-completions/status');const body=JSON.parse(opts.body);assert.equal(body.custom_url,p.api_url);assert(body.custom_include_headers.includes('old-test-key'));assert(body.custom_include_headers.includes('X-Client'));return Response.json({data:[{id:'b'},{id:'a'},{id:'b'}]});}});
    assert.deepEqual(models,['a','b']);assert.deepEqual(p,before);
});
test('direct model list supports model names, clean error messages do not echo private upstream responses',async()=>{
    const p={...native().llm_profiles.默认,bypass_proxy:true};assert.deepEqual(await fetchApiModels(p,{fetcher:async(url,opts)=>{assert.equal(url,p.api_url+'/models');assert.equal(opts.headers.Authorization,'Bearer old-test-key');return Response.json({models:[{name:'custom'}]});}}),['custom']);
    await assert.rejects(fetchApiModels(p,{fetcher:async()=>Response.json({error:{message:'old-test-key'}},{status:401})}),e=>/认证失败/.test(e.message)&&!e.message.includes('old-test-key'));
});
