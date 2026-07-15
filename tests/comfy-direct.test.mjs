import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildComfyViewUrl,
    extractHistoryImages,
    normalizeComfyUrl,
    pingComfyNative,
    submitComfyPrompt,
    waitForComfyResult,
} from '../lib/comfy-direct.mjs';

test('normalizes Comfy URL', () => {
    assert.equal(normalizeComfyUrl('http://192.168.1.2:8188/'), 'http://192.168.1.2:8188');
});

test('ping falls back to object_info', async () => {
    const calls = [];
    const fetchImpl = async url => {
        calls.push(url);
        if (url.endsWith('/object_info')) return new Response('{}', { status: 200 });
        return new Response('no', { status: 404 });
    };
    const result = await pingComfyNative('http://host:8188', { fetchImpl });
    assert.equal(result.endpoint, '/object_info');
    assert.equal(calls.length, 3);
});

test('submits native prompt payload', async () => {
    let body;
    const fetchImpl = async (_url, options) => {
        body = JSON.parse(options.body);
        return new Response(JSON.stringify({ prompt_id: 'abc' }), { status: 200 });
    };
    const result = await submitComfyPrompt('http://host:8188', { 1: { class_type: 'SaveImage', inputs: {} } }, { fetchImpl, clientId: 'client' });
    assert.equal(result.promptId, 'abc');
    assert.equal(body.client_id, 'client');
    assert.ok(body.prompt['1']);
});

test('extracts output image and builds view URL', () => {
    const payload = { abc: { outputs: { 13: { images: [{ filename: 'a b.png', subfolder: 'x', type: 'output' }] } } } };
    const images = extractHistoryImages(payload, 'abc');
    assert.equal(images.length, 1);
    assert.equal(buildComfyViewUrl('http://host:8188', images[0]), 'http://host:8188/view?filename=a+b.png&subfolder=x&type=output');
});

test('polls until image is ready', async () => {
    let count = 0;
    const fetchImpl = async () => {
        count++;
        const body = count < 2 ? {} : { abc: { outputs: { 13: { images: [{ filename: 'done.png', type: 'output' }] } } } };
        return new Response(JSON.stringify(body), { status: 200 });
    };
    const result = await waitForComfyResult('http://host:8188', 'abc', { fetchImpl, pollIntervalMs: 1, timeoutMs: 1000 });
    assert.equal(result.images[0].filename, 'done.png');
    assert.equal(count, 2);
});
