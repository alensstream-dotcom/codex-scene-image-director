import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildComfyRequest,createComfyRenderer} from './comfy-transport.mjs';
const workflow=JSON.parse(fs.readFileSync(new URL('./workflow-api.json',import.meta.url)));
const settings=()=>({mode:'comfyui',comfyuiUrl:'http://comfy.example.test:8188',worker:JSON.stringify(workflow),workerid:'main',comfyui_width:'704',comfyui_height:'1152',comfyui_steps:24,cfg_comfyui:3,comfyuisamplerName:'euler_ancestral',comfyui_scheduler:'simple',MODEL_NAME:'model.safetensors',yushe:{default:{fixedPrompt:'quality',negativePrompt:'bad'}},yusheid_comfyui:'default'});
const request=()=>({id:'request1',prompt:'ADSCENE{"id":"one"}END',change:'Scene Composition: SFW, hallway, @wlop, 704x1152; Character 1 Prompt: adult woman, black hair, holding a "coffee" cup;',animadexSeed:1234});
test('graph filling is typed, preserves tags and quotes, records real parameters and never modifies native settings',()=>{
    const native=settings(),before=structuredClone(native),result=buildComfyRequest(native,request());assert.deepEqual(native,before);
    assert.equal(result.graph['5'].inputs.seed,1234);assert(result.genParams.resolvedPrompt.includes('@wlop'));assert(result.genParams.resolvedPrompt.includes('"coffee"'));assert(!JSON.stringify(result.graph).includes('%prompt%'));assert.equal(result.genParams.width,880);assert.equal(result.genParams.height,1440);assert.equal(result.genParams.scheduler,'simple');
});
test('backend receives exact final text including resolution text, weights, Unicode, punctuation and repeated tags',()=>{
    const native=settings();native.yushe.default.fixedPrompt='';native.yushe.default.negativePrompt='';
    const change='  Scene Composition: office, @wlop, 896x896; Character 1 Prompt: adult woman, (holding coffee:1.2), holding coffee, "704x1152", 猫 & 雨, <lora:example:0.8>;\n';
    const result=buildComfyRequest(native,{...request(),change});assert.equal(result.genParams.resolvedPrompt,change);assert.equal(result.graph['28'].inputs.prompt,change);assert.equal(result.genParams.width,1120);assert.equal(result.genParams.height,1120);
});
test('dimensions in ordinary prose do not override canvas settings and negative prompts remain user owned',()=>{
    const native=settings();native.yushe.default.fixedPrompt='';native.yushe.default.negativePrompt='  custom user negative  ';native.UCP_comfyui='another user tag';
    const change='adult woman, holding a label reading "896x896"',negative='(user selected exclusion:0.5)';
    const result=buildComfyRequest(native,{...request(),change,extraNegativePrompt:negative});assert.equal(result.genParams.resolvedPrompt,change);assert.equal(result.genParams.width,880);assert.equal(result.genParams.height,1440);assert.equal(result.genParams.negativePrompt,'  custom user negative  , '+negative+', another user tag');
});
test('custom workflow safety settings are preserved without adding or disabling flags',()=>{
    const native=settings(),graph=JSON.parse(native.worker);graph['99']={class_type:'CustomSafetyNode',inputs:{enable_safety_checker:true,nsfw_filter:true,safety:'configured'}};native.worker=JSON.stringify(graph);
    assert.deepEqual(buildComfyRequest(native,request()).graph['99'],graph['99']);
});
test('bundled prompt presets have no default exclusions, including the legacy anatomy quality list',()=>{
    const config=JSON.parse(fs.readFileSync(new URL('./workflow-config.json',import.meta.url)));assert.equal(config.promptPreset.negativePrompt,'');assert.equal(config.legacyPromptPreset.negativePrompt,'');
});
test('references remain explicit and preserve existing reference model settings',()=>{
    const r={...request(),animadexReferenceFiles:['AnimadexIdentity/img_'+('a'.repeat(64))+'.png']},result=buildComfyRequest(settings(),r);assert(result.genParams.resolvedPrompt.includes('@adref:'));assert.equal(result.genParams.referenceFiles.length,1);
    assert.throws(()=>buildComfyRequest(settings(),{...r,animadexReferenceFiles:['../private.png']}),/参考文件/);
});
test('independent render submits once, polls standard history, retrieves and returns an image without native events',async()=>{
    const calls=[];let polls=0;const renderer=createComfyRenderer({getSettings:settings,pollMs:1,fetcher:async(url,opts)=>{calls.push(url);if(url.endsWith('/prompt')){const body=JSON.parse(opts.body);assert.equal(body.prompt['5'].inputs.seed,1234);return Response.json({prompt_id:'pid'});}if(url.endsWith('/history/pid'))return Response.json(++polls===1?{}:{pid:{outputs:{8:{images:[{filename:'image.png',subfolder:'folder',type:'output'}]}},status:{completed:true}}});if(url.includes('/view?'))return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});throw new Error('unexpected endpoint');}});
    const result=await renderer(request());assert.equal(result.success,true);assert.equal(result.id,'request1');assert(result.imageData.startsWith('data:image/png;base64,'));assert.equal(calls.filter(v=>v.endsWith('/prompt')).length,1);assert(!calls.some(v=>v.includes('mgpu')));assert.equal(result.genParams.seed,1234);
});
test('stale scenes and unresolved controls never submit GPU work',async()=>{
    let calls=0;const renderer=createComfyRenderer({getSettings:settings,fetcher:async()=>{calls++;throw new Error('must not call');}});
    await assert.rejects(renderer({...request(),animadexValidate:()=> 'original scene changed'}),/original scene changed/);assert.equal(calls,0);
    await assert.rejects(renderer({...request(),change:''}),/尚未准备/);assert.equal(calls,0);
});
test('execution failures and completed outputs with no images fail clearly',async()=>{
    for(const status of [{status_str:'error'},{completed:true}]){const renderer=createComfyRenderer({getSettings:settings,pollMs:1,fetcher:async url=>Response.json(url.endsWith('/prompt')?{prompt_id:'p'}:{p:{status,outputs:{}}})});await assert.rejects(renderer(request()),/执行失败|没有返回图片/);}
});
test('unknown placeholders do not silently send a malformed custom graph',()=>{
    const native=settings();native.worker=JSON.stringify({1:{class_type:'SaveImage',inputs:{filename_prefix:'%unknown%'}}});assert.throws(()=>buildComfyRequest(native,request()),/未支持的占位符/);
});
