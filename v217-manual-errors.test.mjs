import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualTransport,manualConnection} from './manual-transport.mjs';
const context=()=>({extensionSettings:{'st-chatu8':{llm_profiles:{默认:{api_url:'https://example.test/v1',api_key:'owned-test-key',model:'flash'}},current_llm_profile:'默认'}},getRequestHeaders:()=>({}),chat:[{mes:'Original user chat'}]});
test('native helper requests are quiet and preserve structured Tauri timeout details',async()=>{
 const ctx=context();let calls=0;
 const request=createManualTransport({getContext:()=>ctx,fetcher:async(_,options)=>{calls++;assert.equal(JSON.parse(options.body).type,'quiet');assert.equal(JSON.parse(options.body).tool_choice,'none');return Response.json({error:{code:'network.timeout',category:'network',message:'private upstream diagnostic'}},{status:502});}});
 await assert.rejects(request({scene:'Reading a book'}),/请求超时/);assert.equal(calls,1);assert.equal(ctx.chat[0].mes,'Original user chat');
});
test('manual transport distinguishes timeout, interrupted reply, rate limit and authentication without leaking bodies',async()=>{
 for(const[status,body,expected]of [[502,{error:{code:'network.body_interrupted'}},/回复中断/],[502,{error:{code:'network.proxy_failed'}},/网络与代理/],[429,{},/繁忙/],[401,{},/认证失败/]]){
  const request=createManualTransport({getContext:context,fetcher:async()=>Response.json({...body,message:'private-key-not-for-display'},{status})});
  await assert.rejects(request({}),error=>expected.test(error.message)&&!error.message.includes('private-key'));
 }
});
test('old Tauri error completions and malformed HTTP 200 JSON produce actionable manual errors',async()=>{
 for(const[response,expected]of [[Response.json({choices:[{message:{content:'[API 错误]\n请求超时：private upstream detail'}}]}),/请求超时/],[new Response('<html>proxy response</html>'),/未返回有效 JSON/],[Response.json({error:{code:'network.tls_failed'}}),/无法连接/]]){
  const request=createManualTransport({getContext:context,fetcher:async()=>response});await assert.rejects(request({}),expected);
 }
});
test('Tauri with no native profile fails immediately rather than silently waiting for a Windows helper',()=>{
 const before=globalThis.location;globalThis.location={hostname:'tauri.localhost'};
 try{
  const ctx={extensionSettings:{'st-chatu8':{}}};assert.throws(()=>manualConnection(ctx),/API 配置/);
  assert.equal(manualConnection(ctx,{manual_transport:'helper'}).kind,'helper');
  assert.equal(manualConnection(ctx,{manual_helper_url:'https://owned-computer.test'}).kind,'helper');
  assert.throws(()=>manualConnection(ctx,{manual_transport:'typo'}),/连接方式无效/);
 }finally{globalThis.location=before;}
});
test('native proxy passes DeepSeek reasoning and JSON options through the host additional-body channel',async()=>{
 const ctx=context();ctx.extensionSettings['st-chatu8'].llm_profiles.默认.model='deepseek-flash';const original=structuredClone(ctx.extensionSettings);
 const request=createManualTransport({getContext:()=>ctx,fetcher:async(_,options)=>{const body=JSON.parse(options.body),fields=JSON.parse(body.custom_include_body);
  assert.deepEqual(fields.thinking,{type:'disabled'});assert.deepEqual(fields.response_format,{type:'json_object'});assert.equal(fields.tool_choice,'none');
  return Response.json({choices:[{finish_reason:'stop',message:{content:'{"summary":"Complete tags"}'}}]});}});
 assert.equal((await request({})).summary,'Complete tags');assert.deepEqual(ctx.extensionSettings,original);assert.equal(ctx.chat[0].mes,'Original user chat');
});
