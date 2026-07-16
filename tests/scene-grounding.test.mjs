import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildLocalGroundedPackets,
    compileGroundedPrompt,
    desiredGroundedCount,
    mergeGroundedPackets,
    parseRichPackets,
    selectGroundedPackets,
} from '../lib/scene-grounding.mjs';

const wuxiaStory = `青青把木剑放在桌上。小荷跳下床，凑过来看。\n\n青青拔出真剑，剑身雪亮。她按照教过的握法握住剑柄，开始练习剑招。\n\n窗外湖心亭的灯笼亮了。萧曦月坐在亭中石凳上，彩凤琴搁在膝头，手指按在琴弦上。`;

test('builds story-specific wuxia packets instead of western uniform portraits', () => {
    const packets = buildLocalGroundedPackets(wuxiaStory, { maximum: 5 });
    assert.ok(packets.length >= 3);
    const prompts = packets.map(packet => packet.prompt).join(' | ');
    assert.match(prompts, /wooden sword|real sword|guqin/);
    assert.match(prompts, /ancient Chinese fantasy|wuxia|hanfu/);
    assert.doesNotMatch(prompts, /red military coat|epaulettes/);
});

test('unrelated active character card is not injected', () => {
    const packet = buildLocalGroundedPackets(wuxiaStory, { maximum: 5 })[0];
    const compiled = compileGroundedPrompt(packet, {
        card: { name: 'Lucifer', visual: 'black bob hair, red military coat, gold epaulettes' },
    });
    assert.doesNotMatch(compiled.positive, /red military coat|gold epaulettes|black bob hair/);
    assert.match(compiled.negative, /western military uniform|red military coat|epaulettes/);
});

test('uses rich English model prompt when supplied', () => {
    const parsed = parseRichPackets('<!--JANIMA_CG:{"id":"s1","quote":"青青拔出真剑。","people":"1girl","cast":[{"id":"青青","dna":"adult woman, long black hair","outfit":"pale green hanfu"}],"prompt":"1girl, adult woman, long black hair, pale green hanfu, drawing a reflective Chinese sword, traditional bedroom, medium shot","negative":"western uniform","stage":"sword_action","safety":"safe"}-->');
    assert.equal(parsed.packets.length, 1);
    const compiled = compileGroundedPrompt(parsed.packets[0], { card: { name: 'Other', visual: 'red coat' } });
    assert.match(compiled.positive, /drawing a reflective Chinese sword/);
    assert.match(compiled.positive, /pale green hanfu/);
    assert.doesNotMatch(compiled.positive, /red coat/);
});

test('keeps later explicit stages before ordinary scenes', () => {
    const ordinary = buildLocalGroundedPackets(wuxiaStory, { maximum: 5 });
    const explicit = [
        { id: 'u', quote: '她脱下衣物。', people: '1girl, 1boy', cast: [], prompt: 'adult woman undressing, bedroom, intimate medium shot', stage: 'undressing', safety: 'explicit', source: 'model' },
        { id: 'p', quote: '两名成年人发生了性行为。', people: '1girl, 1boy', cast: [], prompt: 'consensual adult intercourse, bedroom, clear body positioning', stage: 'penetration', safety: 'explicit', source: 'model' },
        { id: 'c', quote: '她达到高潮。', people: '1girl, 1boy', cast: [], prompt: 'consensual adult climax, flushed face, intimate close-up', stage: 'climax', safety: 'explicit', source: 'model' },
    ];
    const selected = selectGroundedPackets(mergeGroundedPackets(explicit, ordinary), `${wuxiaStory}\n\n她脱下衣物。\n\n两名成年人发生了性行为。\n\n她达到高潮。`, { minimum: 3, maximum: 5 });
    assert.ok(selected.some(packet => packet.stage === 'undressing'));
    assert.ok(selected.some(packet => packet.stage === 'penetration'));
    assert.ok(selected.some(packet => packet.stage === 'climax'));
});

test('long multi-stage replies request five images', () => {
    const story = `${wuxiaStory}\n\n她换上衣服。\n\n两人来到卧室。\n\n她脱下衣服。\n\n两名成年人发生了性行为。\n\n她达到高潮。\n\n事后拥抱。`;
    assert.equal(desiredGroundedCount(story, { minimum: 3, maximum: 5 }), 5);
});
