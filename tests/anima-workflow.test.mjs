import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ANIMA_ACCURACY_WORKFLOW_ID,
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

test('installer selects the accuracy workflow and adds identity negatives once', () => {
    const settings = { workers: {}, yushe: { 默认: { negativePrompt: 'low quality, wrong face' } } };
    assert.equal(installAnimaAccuracyWorkflow(settings), true);
    assert.equal(settings.workerid, ANIMA_ACCURACY_WORKFLOW_ID);
    assert.equal(settings.comfyui_steps, 8);
    assert.match(settings.yushe.默认.negativePrompt, /missing character/);
    assert.match(settings.yushe.默认.negativePrompt, /skintight bodysuit/);
    assert.match(settings.yushe.默认.negativePrompt, /floating mascot/);
    const first = settings.yushe.默认.negativePrompt;
    assert.equal(installAnimaAccuracyWorkflow(settings), false);
    assert.equal(settings.yushe.默认.negativePrompt, first);
});
