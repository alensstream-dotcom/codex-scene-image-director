import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomRefresh,changedChatRows} from './dom-refresh.mjs';
test('streaming mutation bursts refresh only the changed row once per frame',()=>{
    const scheduled=[],calls=[],row={};const q=createDomRefresh(rows=>calls.push(rows),{schedule:cb=>scheduled.push(cb)});
    for(let i=0;i<1000;i++)q.request([row]);assert.equal(scheduled.length,1);assert.equal(calls.length,0);
    scheduled.shift()();assert.deepEqual(calls,[[row]]);assert.deepEqual(q.stats(),{flushes:1,fullRefreshes:0,rowsRefreshed:1,pending:false});
});
test('a story change refreshes every row and supersedes pending streaming changes',()=>{
    const scheduled=[],calls=[],a={},b={},q=createDomRefresh(rows=>calls.push(rows),{schedule:cb=>scheduled.push(cb)});
    q.request([a]);q.request();q.request([b]);scheduled.shift()();assert.deepEqual(calls,[null]);
    q.request([]);assert.equal(scheduled.length,0);q.request([b]);scheduled.shift()();assert.deepEqual(calls,[null,[b]]);
});
test('mutations caused by mounting can schedule a subsequent frame without losing rows',()=>{
    const scheduled=[],calls=[],row={};let q;q=createDomRefresh(rows=>{calls.push(rows);if(calls.length===1)q.request([row]);},{schedule:cb=>scheduled.push(cb)});
    q.request();scheduled.shift()();assert.equal(scheduled.length,1);scheduled.shift()();assert.deepEqual(calls,[null,[row]]);
});
test('adding a message never scans the whole chat and detached rows are excluded',()=>{
    const row={nodeType:1,closest:()=>row,querySelectorAll:()=>[]},detached={nodeType:1,closest:()=>detached,querySelectorAll:()=>[]};
    let rootScans=0;const chat={nodeType:1,closest:()=>null,querySelectorAll:()=>{rootScans++;return[row];},contains:r=>r===row};
    const text={nodeType:3,parentElement:row};
    assert.deepEqual(changedChatRows([{target:chat,addedNodes:[row,detached]},{target:text,addedNodes:[]}],chat),[row]);assert.equal(rootScans,0);
});
