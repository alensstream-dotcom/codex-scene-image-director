import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanAssistantHistory,filterDrawingHistory} from './outbound-history.mjs';
import {patchAvsSource,installAvsCompatibility} from './avs-compatibility.mjs';
import {sourceHash,legacySourceHash,proseOf,proseRange} from './scene-planner.mjs';
import {THINKING_REGEX} from './display-filter.mjs';
import {automaticPrompt} from './automatic-instruction.mjs';
import {priorOutfitsFor} from './automatic-scene.mjs';
const saved='她穿着灰色外套读书。image###ADSCENE{"id":"local_only","rev":2}END;###随后她去归还资料。';
test('outbound history removes internal drawing IDs and hidden reasoning while preserving visual prose',()=>{
    const raw='<thinking>不要输出<VisualDelta>，照抄按钮 local_only。</thinking>'+saved;
    assert.equal(cleanAssistantHistory(raw),'她穿着灰色外套读书。随后她去归还资料。');
    assert.equal(raw.includes('local_only'),true);
    assert.equal(cleanAssistantHistory('<thinking>'),'<thinking>');
});
test('history filter preserves user and system contracts, multimodal images and new capture instructions',()=>{
    const event={chat:[{role:'system',content:'请输出 image###ADCAP{"v":2}END;###'},
        {role:'user',content:saved},{role:'assistant',content:[{type:'text',text:saved},{type:'image_url',image_url:{url:'data:image/png;base64,owned'}}]}]};
    const before=structuredClone(event);assert.equal(filterDrawingHistory(event),1);
    assert.deepEqual(event.chat.slice(0,2),before.chat.slice(0,2));
    assert.deepEqual(event.chat[2].content[1],before.chat[2].content[1]);
    assert.equal(event.chat[2].content[0].text.includes('ADSCENE'),false);
    assert.equal(filterDrawingHistory(event),0);
});
const avsSource=`const AVS={systemId: 'acgn_visual_system',runtimeVersion: '1.0.0'};
  function extractDelta(text) {
    const raw = String(text ?? '');
    const openCount = (raw.match(/<VisualDelta>/g) || []).length;
    const closeCount = (raw.match(/<\\/VisualDelta>/g) || []).length;
    if (openCount === 0 && closeCount === 0) return { kind: 'none' };
    if (openCount !== 1 || closeCount !== 1) return { kind: 'error', code: 'AVS_DELTA_BLOCK_COUNT' };
    const match = raw.match(/<VisualDelta>([\\s\\S]*?)<\\/VisualDelta>/);
    if (raw.slice(match.index + match[0].length).trim() !== '') return { kind: 'error', code: 'AVS_DELTA_NOT_LAST' };
    try {return {kind:'delta',payload:JSON.parse(match[1].trim())};} catch {return {kind:'error',code:'AVS_DELTA_JSON_INVALID'};}
  }`;
test('AVS parser ignores tag names and examples inside reasoning but commits a real final machine block',()=>{
    const patched=patchAvsSource(avsSource);assert.equal(patched.changed,true);
    const parse=new Function(patched.content+';return extractDelta;')();
    assert.deepEqual(parse('<thinking>本轮没有变化，不要输出<VisualDelta>。</thinking>她继续读书。'),{kind:'none'});
    const block='<VisualDelta>{"changes":[]}</VisualDelta>';
    assert.deepEqual(parse('<analysis>'+block+'</analysis>她穿好外套。'+block),{kind:'delta',payload:{changes:[]}});
    assert.deepEqual(parse('```json\n'+block+'\n```\n普通正文。'),{kind:'none'});
    assert.deepEqual(parse('<thinking>未结束的说明<VisualDelta>'),{kind:'none'});
});
test('AVS parser still rejects genuinely malformed, repeated and non-final machine transactions',()=>{
    const parse=new Function(patchAvsSource(avsSource).content+';return extractDelta;')();
    assert.equal(parse('正文。<VisualDelta>').code,'AVS_DELTA_BLOCK_COUNT');
    assert.equal(parse('<VisualDelta>{}</VisualDelta><VisualDelta>{}</VisualDelta>').code,'AVS_DELTA_BLOCK_COUNT');
    assert.equal(parse('<VisualDelta>{}</VisualDelta>其他正文').code,'AVS_DELTA_NOT_LAST');
    assert.equal(parse('<VisualDelta>invalid</VisualDelta>').code,'AVS_DELTA_JSON_INVALID');
});
test('a display status footer may follow AVS transactions but real subsequent prose still fails',()=>{
    const parse=new Function(patchAvsSource(avsSource).content+';return extractDelta;')(),block='<VisualDelta>{"changes":[]}</VisualDelta>';
    assert.equal(parse(block+'\n<status>时间：18:00，地点：图书馆。</status>').kind,'delta');
    assert.equal(parse(block+'后续真实剧情。<status>状态栏</status>').code,'AVS_DELTA_NOT_LAST');
    const first=patchAvsSource(avsSource).content,old=first.replace(/\n      \/\/ Animadex AVS status footer[^\n]*\n      \.replace\([^\n]*?\.trim\(\)/,' .trim()');
    assert.equal(patchAvsSource(first).changed,false);
});
test('automatic instructions carry bounded prior wardrobe states and distinguish sleeve lowering from unchanged design',()=>{
    const previous={known:true,items:[{id:'coat',state:'rolled',tags:['grey coat'],state_tags:['rolled sleeves']}]};
    const prompt=automaticPrompt({cast:{people:{a:{person:'李湘'}}}},{},{李湘:previous});
    assert(prompt.includes('放下袖口用 patch+worn'));assert(prompt.includes('"state":"rolled"'));assert(prompt.includes('"id":"coat"'));assert(!automaticPrompt({cast:{people:{}}},{automatic:false},{李湘:previous}));
    assert.equal(previous.items[0].state,'rolled');
});
test('long outfit histories hash each message once without crossing edited or alternate branches',()=>{
    let reads=0;const raw='原始剧情。',message={swipe_id:0,get mes(){reads++;return raw;}},events={};for(let i=0;i<100;i++)events[i]={message_id:0,swipe_id:0,source_hash:sourceHash(raw),offset:i,people:[]};
    priorOutfitsFor({events},{messageId:0,swipeId:0,offset:100,proseOffset:100,chat:[message]});assert.equal(reads,1);
});
test('AVS compatibility update preserves unrelated scripts and backs up original source once',()=>{
    let trees=[{type:'folder',id:'folder',scripts:[{type:'script',id:'avs',name:'AVS',content:avsSource},{type:'script',id:'other',content:'unrelated()'}]}];
    const helper={getScriptTrees:()=>structuredClone(trees),updateScriptTreesWith:fn=>trees=fn(structuredClone(trees))},settings={};
    assert.equal(installAvsCompatibility(helper,settings).changed,1);
    assert.equal(trees[0].scripts[1].content,'unrelated()');assert.equal(settings.avsCompatibilityBackups[0].content,avsSource);
    assert.equal(installAvsCompatibility(helper,settings).changed,0);assert.equal(settings.avsCompatibilityBackups.length,1);
    assert.equal(patchAvsSource('arbitrary script').changed,false);
    assert.equal(patchAvsSource("systemId: 'acgn_visual_system'; newerDifferentParser()").unsupported,true);
});
test('an unfinished image example in reasoning cannot consume real prose or destabilize picture hashes',()=>{
    const draft='<thinking>使用 image###ADCAP{...}END;###，不要使用 image###Scene Composition: 旧格式。</thinking>';
    const capture='image###ADCAP{"v":2,"scene":"library","people":[]}END;###',button='image###ADSCENE{"id":"safe","rev":1}END;###';
    const before=draft+'她读书。'+capture+'她合上书。',after=before.replace(capture,button);
    assert.equal(sourceHash(before),sourceHash(after));assert.equal(proseOf(after),'她读书。她合上书。');
    const at=after.indexOf('她读书');assert.equal(proseRange(after,at,at+4),true);assert.equal(proseRange(after,2,15),false);
    assert.equal(after.replace(THINKING_REGEX,''),'她读书。'+button+'她合上书。');
    const old='<thinking>完整旧图片 image###Scene Composition: library, reading;###</thinking>';assert.equal(old.replace(THINKING_REGEX,''),old);
});
test('ordinary legacy picture hashes stay compatible and changed real prose remains distinguishable',()=>{
    const button='image###ADSCENE{"id":"a"}END;###',raw='<thinking>普通思考。</thinking>她读书。'+button+'她合上书。';
    assert.equal(sourceHash(raw),legacySourceHash(raw));assert.notEqual(sourceHash(raw),sourceHash(raw.replace('她读书','她喝茶')));
    const bad='<thinking>image###Scene Composition: 未结束示例。</thinking>她读书。'+button+'她合上书。';
    assert.notEqual(sourceHash(bad),sourceHash(bad.replace('她读书','她喝茶')));
});
