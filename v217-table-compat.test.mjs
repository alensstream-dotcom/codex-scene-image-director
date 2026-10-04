import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./compat/shujuku/index.js',import.meta.url),'utf8');
const start=source.indexOf('function buildCustomApiRequestBody_ACU('),end=source.indexOf('    /**',source.indexOf('return body;',start));
const build=new Function('settings_ACU','composeCustomIncludeBody_ACU','logWarn_ACU','normalizePromptPostProcessing_ACU','normalizeCustomApiFormat_ACU','isTauriTavernHost_ACU','normalizeSTNativeProxyBase_ACU','normalizeExcludeBodyParamsForSillyTavern_ACU',source.slice(start,end)+';return buildCustomApiRequestBody_ACU;')(
    {streamingEnabled:false},(user,fields)=>({value:JSON.stringify({...JSON.parse(user||'{}'),...fields}),diagnostic:{reason:'ok'}}),()=>{},x=>x||'',x=>x||'openai_compat',()=>true,x=>x,x=>x||'');
const config={model:'flash',url:'https://example.test/v1',apiKey:'synthetic-key',max_tokens:60000,bodyParams:'{"temperature":0.4}'};
test('real SP table request builder requires a text reply and uses quiet network error semantics',()=>{
    const messages=[{role:'SYSTEM',content:'Update the tables as text'}],before=structuredClone(config),body=build(messages,config,{textOnly:true});
    assert.equal(body.type,'quiet');assert.equal(body.tool_choice,'none');assert.equal(JSON.parse(body.custom_include_body).tool_choice,'none');assert.equal(body.messages[0].role,'system');
    assert.equal(JSON.parse(body.custom_include_body).temperature,0.4);assert.deepEqual(config,before);assert.equal(messages[0].role,'SYSTEM');
});
test('SP agent and other API calls retain their existing tool behavior',()=>{
    const body=build([{role:'user',content:'Run an agent'}],{...config,bodyParams:'{"tools":[{"type":"function"}],"tool_choice":"auto"}'});
    assert.equal(body.type,undefined);const fields=JSON.parse(body.custom_include_body);assert.equal(fields.tool_choice,'auto');assert.equal(fields.tools.length,1);
});
test('actual table fill call enables the policy and recovered JSON does not create a false failure',()=>{
    const call=source.slice(source.indexOf('async function callCustomOpenAI_ACU('),source.indexOf('async function parseNonStreamResponse_ACU('));
    assert(call.includes('textOnly: true'));assert(!source.includes('logError_ACU(`Primary JSON parse failed'));
    assert(source.includes('logError_ACU(`JSON sanitization pipeline failed'));
    assert(source.includes('logError_ACU(`Failed to parse command line'));
});
test('native caller tool policy bypasses the actual Kemini anti-truncation interceptor',()=>{
    const code=fs.readFileSync(new URL('./fixtures/tauri-tool-policy.original.js',import.meta.url),'utf8'),start=code.indexOf('function callerControlsTools('),end=code.length;
    const classify=new Function(code.slice(start,end)+';return callerControlsTools;')();
    const table=build([{role:'system',content:'Fill tables'}],config,{textOnly:true});
    assert.equal(classify(table),'tools-disabled-by-caller');assert.equal(classify({type:'quiet',custom_include_body:'tool_choice: none'}),undefined);
    assert.equal(classify({type:'normal'}),undefined);
});
const normalizeStart=source.indexOf('function normalizeTableReferences_ACU('),normalizeEnd=source.indexOf('// Animadex table-reference compatibility v2.1.7 end',normalizeStart);
const normalize=new Function('getSortedSheetKeys_ACU',source.slice(normalizeStart,normalizeEnd)+';return normalizeTableReferences_ACU;')(tables=>Object.keys(tables).sort((a,b)=>tables[a].orderNo-tables[b].orderNo));
const tables={b:{name:'角色表',orderNo:2},a:{name:'全局表',orderNo:1}};
test('actual SP response normalization resolves exact unique table names to frozen table indices',()=>{
    const response='<tableEdit>\ninsertRow(角色表, {"0":"李湘"})\nupdateRow("全局表", 0, {"0":"阅览室"})\ndeleteRow(角色表, 2)\n</tableEdit>';
    assert.equal(normalize(response,tables),'<tableEdit>\ninsertRow(1, {"0":"李湘"})\nupdateRow(0, 0, {"0":"阅览室"})\ndeleteRow(1, 2)\n</tableEdit>');
});
test('unknown and ambiguous table names remain invalid instead of writing to another sheet',()=>{
    const response='<tableEdit>\ninsertRow(陌生表, {"0":"x"})\ninsertRow(角色表, {"0":"y"})\n</tableEdit>';
    assert.equal(normalize(response,{...tables,c:{name:'角色表',orderNo:3}}),response);
});
test('table normalization leaves numeric calls, JSON values and text outside tableEdit intact',()=>{
    const response='insertRow(角色表, {})\n<tableEdit>\ninsertRow(1, {"0":"insertRow(角色表, {})"}); updateRow(全局表,0,{"0":"x"})\n</tableEdit>';
    assert.equal(normalize(response,tables),response.replace('; updateRow(全局表,','; updateRow(0,'));
});
const retryStart=source.indexOf('function isRetryableAiRequestError_ACU('),retryEnd=source.indexOf('function isRecord_ACU',retryStart);
const retry=new Function(source.slice(retryStart,retryEnd)+';return isRetryableAiRequestError_ACU;')();
test('SP bounded retry classification accepts transient transport failures and refuses abort/auth/config failures',()=>{
    for(const status of [429,500,502,503,504])assert.equal(retry({status}),true);
    for(const status of [400,401,403,404])assert.equal(retry({status}),false);
    assert.equal(retry({name:'AbortError',status:502}),false);assert.equal(retry(new TypeError('fetch failed')),true);assert.equal(retry(new Error('Invalid model configuration')),false);
});
test('actual SP fill path carries HTTP status and uses its existing bounded retry owner',()=>{
    assert(source.includes('throw new AgentApiHttpError_ACU(response.status, `API请求失败: ${response.status} ${errTxt}`)'));
    assert(source.includes("if (lastErrorCategory !== 'model' && !isRetryableAiRequestError_ACU(error))"));
    assert(source.includes('for (let attempt = 1; attempt <= maxRetries; attempt++)'));
    assert(source.includes('normalizeTableReferences_ACU(content, options?.tableData || currentJsonTableData_ACU).trim()'));
});
const collectStart=source.indexOf('async function collectGroupFillResponse_ACU('),collectEnd=source.indexOf('function buildSqlInitializationBase_ACU(',collectStart);
function collectorHarness(outcomes){
    let calls=0;const progress=[];
    const deps={settings_ACU:{tableMaxRetries:3},wasStoppedByUser_ACU:false,pendingFinalGenerationGreenlights_ACU:[],
        prepareAIInput_ACU:async()=>({tableDataText:'frozen table input'}),startRuntimePerformanceSpan_ACU:()=>({end(){}}),isSqliteMode:()=>false,
        callCustomOpenAI_ACU:async()=>{const value=outcomes[Math.min(calls++,outcomes.length-1)];if(value instanceof Error)throw value;return value;},
        ModelOutputRetryError_ACU:class extends Error{},RetryableAiResponseError_ACU:class extends Error{},isRetryableAiRequestError_ACU:retry,
        sanitizeRetryFeedback_ACU:text=>text,MAX_WARN_ERROR_LENGTH_ACU:240,logWarn_ACU:()=>{},formatGroupAttemptLabel_ACU:()=> 'synthetic group',setTimeout:cb=>cb()};
    const collect=new Function('deps','with(deps){'+source.slice(collectStart,collectEnd)+';return collectGroupFillResponse_ACU;}')(deps);
    return {run:signal=>collect({messagesForContext:[],targetSheetKeys:[],baseSnapshot:{}},null,signal?{signal}:undefined,{onProgress:p=>progress.push(p)}),calls:()=>calls,progress};
}
const transportFailure=status=>Object.assign(new Error('synthetic upstream failure'),{status});
test('actual group collector retries a transient failure and returns the successful table response',async()=>{
    const h=collectorHarness([transportFailure(502),'<tableEdit>insertRow(0,{"0":"test"})</tableEdit>']),result=await h.run();
    assert.equal(result.success,true);assert.equal(result.attempt,2);assert.equal(h.calls(),2);assert.equal(h.progress.filter(p=>p.phase==='retry').length,1);
});
test('actual group collector stops at its configured attempt limit and reports persistent failure',async()=>{
    const h=collectorHarness([transportFailure(503)]),result=await h.run();
    assert.equal(result.success,false);assert.equal(result.attempt,3);assert.equal(h.calls(),3);assert.equal(result.errorCategory,'infrastructure');
});
test('actual group collector never retries auth failure or an already cancelled request',async()=>{
    const h=collectorHarness([transportFailure(401)]),result=await h.run();assert.equal(result.success,false);assert.equal(h.calls(),1);
    const abort=new AbortController();abort.abort();const cancelled=collectorHarness([transportFailure(502)]),stopped=await cancelled.run(abort.signal);
    assert.equal(stopped.aborted,true);assert.equal(cancelled.calls(),0);
});
