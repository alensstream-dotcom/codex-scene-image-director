import test from 'node:test';
import assert from 'node:assert/strict';
import {
    adultSceneAllowed,
    cleanCompiledPrompt,
    desiredShotCount,
    selectPacketsAdaptive,
} from '../lib/scene-policy.mjs';

test('uses 3-5 adaptive shots', () => {
    assert.equal(desiredShotCount('她推门。\n\n她坐下。\n\n她回头。'), 3);
    assert.equal(desiredShotCount('一。\n\n二。\n\n三。\n\n四。\n\n五。\n\n她换上裙子。\n\n她走进卧室。'), 4);
    assert.equal(desiredShotCount('一。\n\n二。\n\n三。\n\n四。\n\n五。\n\n六。\n\n她脱下衣服。\n\n两人做爱。\n\n她达到高潮。\n\n事后拥抱。\n\n清晨醒来。'), 5);
});

test('prioritizes later NSFW stages over ordinary scenes', () => {
    const packets = [
        { id: 'talk', quote: '普通对话', action: 'talking', stage: 'talk', safety: 'safe' },
        { id: 'sit', quote: '坐下', action: 'sitting on sofa', stage: 'sit', safety: 'safe' },
        { id: 'kiss', quote: '亲吻', action: 'adult lovers kissing', stage: 'kiss', safety: 'nsfw' },
        { id: 'sex', quote: '做爱', action: 'consensual adult intercourse', stage: 'penetration', safety: 'explicit' },
    ];
    const selected = selectPacketsAdaptive(packets, '很长的剧情。\n\n亲吻。\n\n做爱。', 3);
    assert.ok(selected.some(packet => packet.id === 'kiss'));
    assert.ok(selected.some(packet => packet.id === 'sex'));
});

test('keeps fixed quality prompts but removes Chinese story prose', () => {
    const result = cleanCompiledPrompt({
        positive: 'masterpiece, story evidence: 她推开门, original story action: 她探头, 1girl, pink hair, peeking through doorway',
        negative: 'bad hands',
        packet: {},
    }, { people: '1girl', safety: 'safe', composition: 'upper body' });
    assert.match(result.positive, /masterpiece/);
    assert.match(result.positive, /peeking through doorway/);
    assert.doesNotMatch(result.positive, /她/);
    assert.match(result.negative, /bad hands/);
});

test('blocks explicit minors but allows adult cast', () => {
    assert.equal(adultSceneAllowed({ safety: 'explicit', cast: [{ id: 'adult woman', dna: 'adult woman' }] }, ''), true);
    assert.equal(adultSceneAllowed({ safety: 'explicit', cast: [{ id: 'girl', dna: '16 years old' }] }, ''), false);
});
