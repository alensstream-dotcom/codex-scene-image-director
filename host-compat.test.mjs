import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureHostEventCompatibility} from './host-compat.mjs';
test('host alias removes only the requested listener and preserves event source context',()=>{
    const listener=()=>{},calls=[],source={removeListener(event,fn){assert.equal(this,source);calls.push([event,fn]);return this;}};
    assert.equal(ensureHostEventCompatibility(source),true);assert.equal(source.off('owned-task',listener),source);assert.deepEqual(calls,[['owned-task',listener]]);assert.equal(ensureHostEventCompatibility(source),false);
});
test('existing host off implementation and unsupported hosts remain untouched',()=>{
    const off=()=>{},source={off};assert.equal(ensureHostEventCompatibility(source),false);assert.equal(source.off,off);assert.equal(ensureHostEventCompatibility({}),false);
});
