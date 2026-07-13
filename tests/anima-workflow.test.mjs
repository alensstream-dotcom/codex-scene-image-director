import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ANIMA_ACCURACY_WORKFLOW_ID,
    ANIMA_NATIVE_NEGATIVE_TAGS,
    ANIMA_PROMPT_PRESET_ID,
    buildAnimaAccuracyWorkflow,
    installAnimaAccuracyWorkflow,
} from '../lib/anima-workflow.mjs';

test('Galgame workflow restores the user Turbo LoRA and eight-step sampling', () => {
    const graph = JSON.parse(buildAnimaAccuracyWorkflow());
    assert.equal(graph['11'].inputs.steps, 8);
    assert.equal(graph['11'].inputs.cfg, 1);
    assert.equal(graph['11'].inputs.sampler_name, 'euler');
    assert.equal(graph['11'].inputs.scheduler, 'normal');
    assert.equal(graph['11'].inputs.model[0], '7');
    assert.equal(graph['7'].class_type, 'LoraLoader');
    assert.equal(graph['7'].inputs.lora_name, 'anima-turbo-lora-v0.2.safetensors');
    assert.equal(graph['7'].inputs.strength_model, 1);
    assert.equal(graph['7'].inputs.strength_clip, 1);
    assert.equal(graph['8'].inputs.text, '%prompt%');
    assert.equal(graph['9'].inputs.text, '%negative_prompt%');
    assert.equal(Object.values(graph).some(node => node.class_type === 'LoraLoader'), true);
});

test('installer selects the native Anima workflow and isolated prompt preset once', () => {
    const settings = { workers: {}, yushe: { 默认: { negativePrompt: 'low quality, wrong face' } } };
    assert.equal(installAnimaAccuracyWorkflow(settings), true);
    assert.equal(settings.workerid, ANIMA_ACCURACY_WORKFLOW_ID);
    assert.equal(settings.comfyui_steps, 8);
    assert.equal(settings.AQT_comfyui, '');
    assert.equal(settings.UCP_comfyui, ANIMA_NATIVE_NEGATIVE_TAGS.join(', '));
    assert.equal(settings.yusheid_comfyui, ANIMA_PROMPT_PRESET_ID);
    assert.equal(settings.yushe.默认.negativePrompt, 'low quality, wrong face');
    assert.equal(settings.yushe[ANIMA_PROMPT_PRESET_ID].negativePrompt, '');
    assert.match(settings.UCP_comfyui, /chromatic aberration/);
    const first = JSON.stringify(settings);
    assert.equal(installAnimaAccuracyWorkflow(settings), false);
    assert.equal(JSON.stringify(settings), first);
});
