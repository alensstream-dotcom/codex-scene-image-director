import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ANIMA_ACCURACY_WORKFLOW_ID,
    buildAnimaAccuracyWorkflow,
    installAnimaAccuracyWorkflow,
} from '../lib/anima-workflow.mjs';

test('accuracy workflow uses Anima base guidance without the weak Turbo LoRA', () => {
    const graph = JSON.parse(buildAnimaAccuracyWorkflow());
    assert.equal(graph['11'].inputs.steps, 30);
    assert.equal(graph['11'].inputs.cfg, 4);
    assert.equal(graph['11'].inputs.sampler_name, 'er_sde');
    assert.equal(graph['11'].inputs.scheduler, 'simple');
    assert.equal(graph['11'].inputs.model[0], '2');
    assert.equal(graph['8'].inputs.text, '%prompt%');
    assert.equal(graph['9'].inputs.text, '%negative_prompt%');
    assert.equal(Object.values(graph).some(node => node.class_type === 'LoraLoader'), false);
});

test('installer selects the accuracy workflow and adds identity negatives once', () => {
    const settings = { workers: {}, yushe: { 默认: { negativePrompt: 'low quality, wrong face' } } };
    assert.equal(installAnimaAccuracyWorkflow(settings), true);
    assert.equal(settings.workerid, ANIMA_ACCURACY_WORKFLOW_ID);
    assert.equal(settings.comfyui_steps, 30);
    assert.match(settings.yushe.默认.negativePrompt, /missing character/);
    const first = settings.yushe.默认.negativePrompt;
    assert.equal(installAnimaAccuracyWorkflow(settings), false);
    assert.equal(settings.yushe.默认.negativePrompt, first);
});
