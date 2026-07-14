import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createCharacterRegistry,
    extractShotPackets,
    repairStoryboardFromEvidence,
    serializeShotPacket,
} from '../lib/story-evidence.mjs';
import { extractImagePrompts } from '../lib/rescue-core.mjs';

const eileen = (overrides = {}) => ({
    id: '艾琳',
    prompt_name: 'Eileen',
    dna: 'adult woman, slim build, pale skin, oval face, silver-white long hair, violet eyes',
    outfit: 'navy military dress, silver shoulder armor',
    identity_change: false,
    outfit_change: false,
    ...overrides,
});

const packet = (overrides = {}) => ({
    id: 's1',
    quote: '她突然拔出银剑，挡在你的身前。',
    people: '1girl and 1boy',
    cast: [eileen(), {
        id: '男主',
        prompt_name: 'male protagonist',
        dna: 'adult man, lean build, short black hair, gray eyes',
        outfit: 'black travel coat',
        identity_change: false,
        outfit_change: false,
    }],
    action: 'Eileen drawing a silver sword and shielding the male protagonist from an attack',
    setting: 'ruined clocktower interior, shattered window',
    expression: 'Eileen determined expression, male protagonist startled expression',
    composition: 'dynamic medium two-shot, Eileen in the foreground, blue rim light',
    safety: 'safe',
    ...overrides,
});

function shotText(story, value, prompt = '') {
    return `${story}\n\n${serializeShotPacket(value)}${prompt ? `\n\n${prompt}` : ''}`;
}

test('same-call packet produces a canonical inline prompt from exact story evidence', () => {
    const story = '钟楼的玻璃在震动。她突然拔出银剑，挡在你的身前。';
    const result = repairStoryboardFromEvidence(shotText(story, packet()));
    assert.equal(result.errors.length, 0);
    assert.equal(result.shots.length, 1);
    assert.equal(extractImagePrompts(result.text).length, 1);
    assert.match(result.text, /她突然拔出银剑，挡在你的身前。[\s\S]*<!--JANIMA_SHOT:/);
    assert.match(result.text, /Eileen drawing a silver sword and shielding the male protagonist/);
    assert.match(result.text, /silver-white long hair/);
    assert.match(result.text, /ruined clocktower interior/);
    assert.match(result.text, /<!--IMG_COUNT:1-->/);
});

test('missing bracket prompt is repaired without a second model or generic action template', () => {
    const story = '她突然拔出银剑，挡在你的身前。';
    const result = repairStoryboardFromEvidence(shotText(story, packet(), '[temporary model placeholder]'));
    const promptText = extractImagePrompts(result.text)[0].prompt;
    assert.match(promptText, /drawing a silver sword/);
    assert.doesNotMatch(promptText, /story-accurate environment|performing the decisive story action/);
    assert.doesNotMatch(result.text, /temporary model placeholder/);
});

test('future or paraphrased evidence is rejected instead of inventing an image', () => {
    const future = packet({ quote: '她随后跃上高台，挥剑斩断锁链。', action: 'Eileen attacking the chain with her sword' });
    const text = `${serializeShotPacket(future)}\n\n她随后跃上高台，挥剑斩断锁链。`;
    const result = repairStoryboardFromEvidence(text);
    assert.equal(result.shots.length, 0);
    assert.ok(result.errors.some(issue => issue.code === 'quote_not_in_window'));
    assert.equal(extractImagePrompts(result.text).length, 0);
    assert.match(result.text, /<!--IMG_COUNT:0-->/);
});

test('action phase mismatch is rejected rather than turning an attack into a hug', () => {
    const bad = packet({
        quote: '她猛然挥剑劈向扑来的怪物。',
        action: 'Eileen embracing the male protagonist with a relieved smile',
    });
    const result = repairStoryboardFromEvidence(shotText('她猛然挥剑劈向扑来的怪物。', bad));
    assert.equal(result.shots.length, 0);
    assert.ok(result.errors.some(issue => issue.code === 'action_phase_mismatch'));
});

test('recurring character keeps immutable DNA and unchanged outfit across turns', () => {
    const first = repairStoryboardFromEvidence(shotText('她突然拔出银剑，挡在你的身前。', packet()));
    const registry = createCharacterRegistry(first.shots.map(item => item.packet));
    const drifted = packet({
        id: 's2',
        quote: '艾琳收起银剑，转身对你露出微笑。',
        people: '1girl',
        cast: [eileen({ dna: 'adult woman, curvy build, tan skin, short red hair, green eyes', outfit: 'red bikini' })],
        action: 'Eileen sheathing her silver sword and smiling at the viewer',
        setting: 'ruined clocktower interior',
        expression: 'warm relieved smile',
        composition: 'medium shot, Eileen centered, soft blue moonlight',
    });
    const second = repairStoryboardFromEvidence(shotText('艾琳收起银剑，转身对你露出微笑。', drifted), { registry });
    assert.equal(second.shots.length, 1);
    const promptText = extractImagePrompts(second.text)[0].prompt;
    assert.match(promptText, /silver-white long hair/);
    assert.match(promptText, /navy military dress/);
    assert.doesNotMatch(promptText, /short red hair|red bikini|tan skin/);
});

test('registry keeps first-seen identity when a later packet drifts without proof', () => {
    const registry = createCharacterRegistry([
        packet(),
        packet({
            id: 's2',
            cast: [eileen({ dna: 'adult woman, short red hair, green eyes', outfit: 'black bikini' })],
        }),
    ]);
    const locked = registry.get('艾琳');
    assert.match(locked.dna, /silver-white long hair/);
    assert.match(locked.outfit, /navy military dress/);
    assert.doesNotMatch(`${locked.dna}, ${locked.outfit}`, /short red hair|black bikini/);
});

test('story-proven outfit change is allowed while immutable face DNA stays locked', () => {
    const first = repairStoryboardFromEvidence(shotText('她突然拔出银剑，挡在你的身前。', packet()));
    const registry = createCharacterRegistry(first.shots.map(item => item.packet));
    const changed = packet({
        id: 's2',
        quote: '艾琳换下军装，穿上白色晚礼服走进舞厅。',
        people: '1girl',
        cast: [eileen({ outfit: 'white evening gown', outfit_change: true })],
        action: 'Eileen changed into a white evening gown before entering the ballroom',
        setting: 'crystal ballroom',
        expression: 'calm confident smile',
        composition: 'full body shot, Eileen centered, warm chandelier light',
    });
    const result = repairStoryboardFromEvidence(shotText('艾琳换下军装，穿上白色晚礼服走进舞厅。', changed), { registry });
    const promptText = extractImagePrompts(result.text)[0].prompt;
    assert.match(promptText, /silver-white long hair/);
    assert.match(promptText, /white evening gown/);
    assert.doesNotMatch(promptText, /navy military dress/);
});

test('adult action stages stay distinct and remain explicit', () => {
    const stages = [
        ['她俯身为成年男主进行口交，抬眼观察他的反应。', 'Eileen performing oral sex on the adult male protagonist', 'oral_sex'],
        ['她随后引导成年男主首次进入她体内，身体在接触瞬间绷紧。', 'Eileen guiding the adult male protagonist into initial vaginal penetration', 'penetration'],
        ['她翻身骑到成年男主身上，明确改变体位并掌握节奏。', 'Eileen changing position and mounting the adult male protagonist', 'position_change'],
        ['她在最后一次动作中达到高潮，身体痉挛后抱紧成年男主。', 'Eileen reaching orgasm while holding the adult male protagonist', 'climax'],
    ];
    const chunks = [];
    stages.forEach(([quote, action], index) => {
        chunks.push(quote, serializeShotPacket(packet({ id: `s${index + 1}`, quote, action, safety: 'explicit' })));
    });
    const result = repairStoryboardFromEvidence(chunks.join('\n\n'));
    assert.equal(result.errors.length, 0);
    assert.equal(result.shots.length, 4);
    assert.deepEqual(result.shots.map(item => item.actionPhase), stages.map(item => item[2]));
    assert.ok(extractImagePrompts(result.text).every(item => item.tags.includes('explicit')));
});

test('male-only evidence cannot create a Galgame button', () => {
    const maleOnly = packet({
        quote: '男人独自站在空无一人的走廊里。',
        people: '1boy',
        cast: [{ id: '男主', prompt_name: 'male protagonist', dna: 'adult man, short black hair', outfit: 'black coat' }],
        action: 'male protagonist standing alone',
        setting: 'empty corridor',
        expression: 'serious expression',
        composition: 'medium shot',
    });
    const result = repairStoryboardFromEvidence(shotText('男人独自站在空无一人的走廊里。', maleOnly));
    assert.equal(result.shots.length, 0);
    assert.ok(result.errors.some(issue => issue.code === 'people_invalid' || issue.code === 'female_cast_missing'));
});
