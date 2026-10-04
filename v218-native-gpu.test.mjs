import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./companions/st-chatu8/index.js',import.meta.url),'utf8');
const begin=source.indexOf('async function detectMultiGpu('),end=source.indexOf('var multiGpuCache;',begin);
const actual=source.slice(begin,end);
function fixture(standard,cache=new Map()){
 const calls=[],settings={animadex_story_cast:{standard_comfy_history:standard}};
 const fakeFetch=async(url)=>{calls.push(url);return Response.json(url.endsWith('/mgpu/status')?{enabled:true}:{outputs:{}});};
 const api=new Function('fetch','normalizeUrl','multiGpuCache','extension_settings49','AbortController',actual+';return {detectMultiGpu,fetchHistory,interruptAll};')(fakeFetch,u=>u.replace(/\/+$/,''),cache,settings,AbortController);
 return {calls,api,settings};
}
test('standard ComfyUI never probes the absent optional MGPU route',async()=>{const f=fixture(true);assert.equal(await f.api.detectMultiGpu('http://comfy.test'),false);await f.api.fetchHistory('http://comfy.test','owned');assert.deepEqual(f.calls,['http://comfy.test/history/owned']);});
test('standard history ignores a previously cached multi-GPU result and avoids optional interrupts',async()=>{const f=fixture(true,new Map([['http://comfy.test',true]]));await f.api.fetchHistory('http://comfy.test','owned');await f.api.interruptAll('http://comfy.test');assert.deepEqual(f.calls,['http://comfy.test/history/owned','http://comfy.test/api/interrupt']);});
test('MGPU opt-in preserves native detection, cache and its history route',async()=>{const f=fixture(false);assert.equal(await f.api.detectMultiGpu('http://comfy.test'),true);await f.api.fetchHistory('http://comfy.test','owned');assert.deepEqual(f.calls,['http://comfy.test/mgpu/status','http://comfy.test/mgpu/history/owned']);});
test('turning standard history back on takes effect without poisoning the MGPU cache',async()=>{const f=fixture(false);await f.api.detectMultiGpu('http://comfy.test');f.settings.animadex_story_cast.standard_comfy_history=true;assert.equal(await f.api.detectMultiGpu('http://comfy.test'),false);await f.api.fetchHistory('http://comfy.test','owned');assert.equal(f.calls.at(-1),'http://comfy.test/history/owned');});
