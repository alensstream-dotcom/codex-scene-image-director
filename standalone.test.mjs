import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureRenderSettings,updateRenderSettings} from './render-settings.mjs';
import {assetMetadata,imageBytes,cachePage,consolidateLegacyCopies,imageContentHash} from './image-cache.mjs';
import {imageZip} from './image-zip.mjs';
import {installPlanningFilter} from './display-filter.mjs';
import {createComfyRenderer,buildComfyRequest} from './comfy-transport.mjs';
const graph={1:{class_type:'CLIPTextEncode',inputs:{text:'%prompt%'}},2:{class_type:'KSampler',inputs:{steps:'%steps%',seed:'%seed%',cfg:'%cfg_scale%'}}};
test('migration copies only drawing settings and remains independent after restart',()=>{
    const legacy={worker:JSON.stringify(graph),workerid:'owned',comfyuiUrl:'http://comfy.test',comfyui_steps:28,llm_profiles:{secret:'must not copy'},api_key:'must not copy',workers:{owned:JSON.stringify(graph)}},before=structuredClone(legacy),setting={};
    const own=ensureRenderSettings(setting,legacy);assert.equal(own.comfyui_steps,28);assert(!own.llm_profiles);assert(!own.api_key);own.comfyui_steps=32;own.workers.custom='{}';assert.deepEqual(legacy,before);assert.equal(ensureRenderSettings(setting,{}),own);
});
test('fresh standalone settings work with an imported standard API workflow',()=>{
    const own=ensureRenderSettings({});own.worker=JSON.stringify(graph);updateRenderSettings(own,{url:'http://comfy.test:8188/',comfyui_steps:'36',cfg_comfyui:'4.2'});const result=buildComfyRequest(own,{change:'adult woman, reading',animadexSeed:3});assert.equal(result.graph[2].inputs.steps,36);assert.equal(result.graph[2].inputs.cfg,4.2);assert.equal(own.comfyuiUrl,'http://comfy.test:8188');
    const before=structuredClone(own);assert.throws(()=>updateRenderSettings(own,{url:'http://comfy.test',comfyui_steps:0}));assert.deepEqual(own,before);
});
test('scene display anchors are idempotent, safe and leave original prose intact',()=>{
    const settings={regex:[]};installPlanningFilter(settings);installPlanningFilter(settings);const script=settings.regex.find(s=>s.id.endsWith('-scene-anchor')),regex=new RegExp(script.findRegex.slice(1,-2),'g');const source='前文。image###ADSCENE{"id":"sc_1","rev":2}END;###后文。';const rendered=source.replace(regex,script.replaceString);assert(rendered.includes('data-ad-scene="sc_1"'));assert(rendered.startsWith('前文。'));assert(rendered.endsWith('后文。'));assert.equal(settings.regex.filter(s=>s.id===script.id).length,1);const invalid='image###ADSCENE{"id":"<script>","rev":1}END;###';assert.equal(invalid.replace(regex,script.replaceString),invalid);
});
test('gallery sizes and paged filters use metadata instead of image data',()=>{
    assert.equal(imageBytes('data:image/png;base64,AQIDBA=='),4);assert.equal(imageBytes('data:image/png;base64,AQID'),3);const assets=Array.from({length:32},(_,i)=>assetMetadata({id:'id'+i,data:'data:image/png;base64,AQIDBA==',created_at:new Date(i*1000).toISOString(),story_id:i<20?'a':'b',scene_snapshot:{actors:[{person:i%2?'甲':'乙'}]}}));
    const page=cachePage(assets,{scope:'current',storyId:'a',person:'甲',page:20,pageSize:4});assert.equal(page.total,10);assert.equal(page.pages,3);assert.equal(page.page,3);assert.equal(page.bytes,40);assert.equal(page.items.length,2);assert(!Object.hasOwn(page.items[0],'data'));
});
test('download ZIP writes valid local and central records with per-file CRCs',async()=>{
    const blob=imageZip([{data:'data:image/png;base64,AQIDBA==',created_at:'2026-10-04T10:00:00Z'},{data:'data:image/jpeg;base64,AQID',created_at:'2026-10-04T11:00:00Z'}]),bytes=await blob.arrayBuffer(),view=new DataView(bytes);assert.equal(view.getUint32(0,true),0x04034b50);assert.equal(view.getUint32(bytes.byteLength-22,true),0x06054b50);assert.equal(view.getUint16(bytes.byteLength-12,true),2);assert.throws(()=>imageZip([{data:'text/plain'}]),/格式/);
});
test('tablet canvas generation records its actual output dimensions',()=>{
    const own=ensureRenderSettings({});own.worker=JSON.stringify({...graph,3:{class_type:'AnimadexIdentityCanvas',inputs:{output_size:'tablet'}}});const result=buildComfyRequest(own,{change:'adult woman, reading, 704x1152',animadexSeed:1});assert.equal(result.genParams.width,704);assert.equal(result.genParams.height,1152);
});
test('identical native copies merge migration IDs without deleting original chat assets',async()=>{
    const data='data:image/png;base64,AQIDBA==',hash=await imageContentHash(data),assets=new Map([['original',{id:'original',data,content_hash:hash}],['copy',{id:'copy',data,content_hash:hash,legacy_uuid:'native-uuid'}]]),library={listAssetMetadata:async()=>[...assets.values()].map(assetMetadata),getAsset:async id=>assets.get(id),saveAsset:async a=>assets.set(a.id,a),deleteAssets:async ids=>{for(const id of ids)assets.delete(id);return{deleted:ids.length,protected:[]};}};
    assert.equal((await consolidateLegacyCopies(library)).deleted,1);assert.deepEqual(assets.get('original').legacy_uuids,['native-uuid']);assert.equal(assets.size,1);assert.equal(cachePage([...assets.values()].map(assetMetadata),{scope:'legacy'}).total,1);
});
