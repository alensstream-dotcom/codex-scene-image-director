import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnimaWorkflow, buildComfyProxyBody, normalizeProfile } from '../lib/anima-direct-workflow.mjs';

test('direct workflow keeps the Turbo latency profile', () => {
    const graph = buildAnimaWorkflow({ positive: 'safe, heroine running', negative: 'bad hands', seed: 123 });
    assert.equal(graph[2].inputs.unet_name, 'JANIMA_v10.safetensors');
    assert.equal(graph[7].inputs.lora_name, 'anima-turbo-lora-v0.2.safetensors');
    assert.equal(graph[11].inputs.steps, 8);
    assert.equal(graph[11].inputs.cfg, 1);
    assert.equal(graph[11].inputs.sampler_name, 'euler');
    assert.equal(graph[11].inputs.scheduler, 'normal');
    assert.equal(graph[10].inputs.width, 768);
    assert.equal(graph[10].inputs.height, 1024);
});

test('proxy payload targets the configured LAN ComfyUI and valid API prompt shape', () => {
    const workflow = buildAnimaWorkflow({ positive: 'test', negative: 'bad', seed: 1 });
    const body = buildComfyProxyBody('http://192.168.1.12:8188', workflow);
    assert.equal(body.url, 'http://192.168.1.12:8188');
    assert.deepEqual(Object.keys(JSON.parse(body.prompt)), ['prompt']);
});

test('profile clamps unsafe dimensions and keeps explicit fast overrides possible', () => {
    const profile = normalizeProfile({ width: 99999, height: 1, steps: 999, cfg: 0 });
    assert.equal(profile.width, 1536);
    assert.equal(profile.height, 256);
    assert.equal(profile.steps, 30);
    assert.equal(profile.cfg, 0.1);
});

test('later CGs can reuse the first heroine image without adding a slow model', () => {
    const graph = buildAnimaWorkflow({
        positive: 'same pink-haired heroine walking home',
        negative: 'wrong hair',
        seed: 123,
        referenceImage: 'janima_identity_sakura.png',
        referenceDenoise: 0.9,
    });
    assert.equal(graph[10].class_type, 'LoadImage');
    assert.equal(graph[14].class_type, 'VAEEncode');
    assert.deepEqual(graph[11].inputs.latent_image, ['14', 0]);
    assert.equal(graph[11].inputs.denoise, 0.9);
    assert.equal(graph[11].inputs.steps, 8);
});

