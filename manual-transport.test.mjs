import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualTransport,manualConnection} from './manual-transport.mjs';
import {automaticPrompt} from './automatic-instruction.mjs';
const ctx=()=>({extensionSettings:{'st-chatu8':{llm_profiles:{默认:{api_url:'https://api.example.test/v1',api_key:'test-only',model:'deepseek-flash'}},llm_request_type_configs:{image_gen:{api_profile:'默认'}}}},chat:[{mes:'User story is unchanged'}],getRequestHeaders:()=>({'X-CSRF-Token':'test-csrf'})});
test('portable manual request uses drawing profile and never includes chat history or main settings',async()=>{
    const context=ctx(),original=structuredClone(context.extensionSettings),payload={scene:'Alice reads a book.',story:'Alice is a researcher.',current_people:[],wardrobe_schema:2};let calls=0;
    const request=createManualTransport({getContext:()=>context,fetcher:async(url,options)=>{calls++;assert.equal(url,'/api/backends/chat-completions/generate');const body=JSON.parse(options.body);assert.equal(body.model,'deepseek-flash');assert.equal(body.stream,false);assert.equal(body.thinking.type,'disabled');assert.equal(body.messages.length,2);assert.deepEqual(JSON.parse(body.messages[1].content),payload);assert(!options.body.includes(context.chat[0].mes));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Alice reads',people:[],scene_composition:'library'})}}]});}});
    assert.equal((await request(payload)).summary,'Alice reads');assert.equal(calls,1);assert.deepEqual(context.extensionSettings,original);assert.equal(context.chat[0].mes,'User story is unchanged');
    assert(!JSON.stringify(manualConnection(context)).includes('main_api'));
});
test('explicit helper setting works without Windows loopback and cancellation reaches fetch',async()=>{
    const context=ctx(),controller=new AbortController();let entered;const started=new Promise(resolve=>entered=resolve);
    const request=createManualTransport({getContext:()=>context,setting:()=>({manual_transport:'helper',manual_helper_url:'https://computer.example.test'}),fetcher:(url,options)=>new Promise((resolve,reject)=>{assert.equal(url,'https://computer.example.test/manual');entered();options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});})});
    const pending=request({scene:'Alice reads'},{signal:controller.signal});await started;controller.abort();await assert.rejects(pending,{name:'AbortError'});
});
test('API failures stay inside the manual request with one attempt',async()=>{
    const context=ctx();let calls=0;const request=createManualTransport({getContext:()=>context,fetcher:async()=>{calls++;return new Response('private upstream body',{status:401});}});
    await assert.rejects(request({scene:'Alice reads'}),/认证失败/);assert.equal(calls,1);assert.equal(context.chat[0].mes,'User story is unchanged');
});
test('automatic protocol survives absence of worldbook and disabling automation removes it',()=>{
    const story={cast:{people:{a:{person:'Alice',aliases:['阿丽丝'],chosen_appearance_tags:['never send giant tags'],face_description:'large descriptions'.repeat(1000)}}}};
    const prompt=automaticPrompt(story,{});assert(prompt.includes('image###ADCAP{"v":2'));assert(prompt.includes('Alice'));assert(prompt.length<2300);assert(!prompt.includes('large descriptions'));assert.equal(automaticPrompt(story,{automatic:false}),'');assert.equal(automaticPrompt(story,{enabled:false}),'');
});
