import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createCharacterRegistry,
    extractShotPackets,
    repairStoryboardFromEvidence,
    repairStoryboardFromLedger,
    serializeShotPacket,
    serializeStoryboardLedger,
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

test('composite action evidence is accepted when the quote and prompt share a grounded action', () => {
    const quote = 'The adult woman Eileen grabs the male protagonist by the wrist and runs toward the clocktower entrance.';
    const composite = packet({
        quote,
        action: 'Eileen gripping the male protagonist wrist while running toward the clocktower entrance',
    });
    const result = repairStoryboardFromEvidence(shotText(quote, composite));
    assert.equal(result.errors.length, 0);
    assert.equal(result.shots.length, 1);
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

test('an explicitly stated current outfit overrides stale nudity without unlocking face DNA', () => {
    const registry = createCharacterRegistry([
        packet({
            quote: 'Adult woman Eileen removes her dress and becomes fully nude.',
            cast: [eileen({ outfit: 'fully nude', outfit_change: true })],
        }),
    ]);
    const quote = 'Adult woman Eileen arrives in a rain-soaked navy school uniform and red ribbon.';
    const current = packet({
        id: 's2',
        quote,
        cast: [eileen({
            dna: 'adult woman, curvy build, tan skin, short red hair, green eyes',
            outfit: 'navy school uniform, red ribbon',
            outfit_change: false,
        })],
        action: 'Eileen arriving beside the male protagonist in her rain-soaked navy school uniform',
    });
    const result = repairStoryboardFromEvidence(shotText(quote, current), { registry });
    assert.equal(result.errors.length, 0);
    assert.equal(result.shots.length, 1);
    const promptText = extractImagePrompts(result.text)[0].prompt;
    assert.match(promptText, /navy school uniform, red ribbon/);
    assert.match(promptText, /silver-white long hair/);
    assert.doesNotMatch(promptText, /fully nude|short red hair|green eyes/);
});

test('registry follows later explicit outfit state even when the transition happened offscreen', () => {
    const registry = createCharacterRegistry([
        packet({
            id: 'a1',
            quote: 'Adult woman Eileen removes her dress and becomes fully nude.',
            cast: [eileen({ outfit: 'fully nude', outfit_change: true })],
        }),
        packet({
            id: 's1',
            quote: 'Adult woman Eileen waits in a dry navy school uniform and red ribbon.',
            cast: [eileen({ outfit: 'navy school uniform, red ribbon', outfit_change: false })],
        }),
    ]);
    const current = [...registry.values()][0];
    assert.equal(current.outfit, 'navy school uniform, red ribbon');
    assert.equal(current.outfit_change, false);
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

test('gerund position change and cowgirl riding remain a distinct adult stage', () => {
    const quote = 'The adult woman Eileen changes position and rides the adult male protagonist in cowgirl position.';
    const changed = packet({
        quote,
        action: 'Eileen changing position to cowgirl and riding the adult male protagonist',
        safety: 'explicit',
    });
    const result = repairStoryboardFromEvidence(shotText(quote, changed));
    assert.equal(result.errors.length, 0);
    assert.equal(result.shots.length, 1);
    assert.equal(result.shots[0].actionPhase, 'position_change');
});

test('one hidden end ledger creates chronological inline prompts without another model', () => {
    const quotes = [
        '艾琳突然冲进钟楼，银白长发在风中扬起。',
        '她拔出银剑挡住怪物的利爪，把你牢牢护在身后。',
        '危机解除后，艾琳转身抱住你，主动吻上你的嘴唇。',
    ];
    const shots = [
        packet({ id: 's1', quote: quotes[0], people: '1girl', cast: [eileen()], action: 'Eileen rushing into the clocktower through the open door' }),
        packet({ id: 's2', quote: quotes[1], action: 'Eileen drawing her silver sword, blocking the monster claws, and shielding the male protagonist behind her' }),
        packet({ id: 's3', quote: quotes[2], action: 'Eileen embracing and kissing the male protagonist on the lips after the battle' }),
    ];
    const story = quotes.join('\n\n');
    const input = `${story}\n\n${serializeStoryboardLedger(shots)}`;
    const result = repairStoryboardFromLedger(input);
    assert.equal(result.errors.length, 0);
    assert.equal(result.shots.length, 3);
    assert.equal(extractImagePrompts(result.text).length, 3);
    assert.ok(result.text.indexOf('rushing into the clocktower') > result.text.indexOf(quotes[0]));
    assert.ok(result.text.indexOf('rushing into the clocktower') < result.text.indexOf(quotes[1]));
    assert.ok(result.text.indexOf('blocking the monster claws') < result.text.indexOf(quotes[2]));
    assert.match(result.text, /<!--JANIMA_STORYBOARD_V2:/);
    assert.match(result.text, /<!--IMG_COUNT:3-->/);

    const repeated = repairStoryboardFromLedger(result.text);
    assert.deepEqual(repeated.shots.map(item => item.packet.id), result.shots.map(item => item.packet.id));
    assert.equal(extractImagePrompts(repeated.text).length, 3);
    assert.equal(repeated.errors.length, 0);
});

test('end ledger accepts Chinese and ASCII punctuation variants but never matches its own hidden copy', () => {
    const storyQuote = '成年女性艾琳撑着透明雨伞跑到你面前，银白长发贴在肩头；她把伞倾向你。';
    const ledgerQuote = '成年女性艾琳撑着透明雨伞跑到你面前,银白长发贴在肩头;她把伞倾向你。';
    const input = `${storyQuote}\n\n${serializeStoryboardLedger([
        packet({
            id: 's1',
            quote: ledgerQuote,
            people: '1girl',
            cast: [eileen()],
            action: 'Eileen running to the male protagonist and tilting her transparent umbrella toward him',
        }),
    ])}`;
    const result = repairStoryboardFromLedger(input);
    assert.equal(result.errors.length, 0);
    assert.equal(result.shots.length, 1);
    assert.equal(result.shots[0].quoteStart, 0);
    assert.ok(result.shots[0].quoteEnd < input.indexOf('<!--JANIMA_STORYBOARD_V2:'));
    assert.equal(extractImagePrompts(result.text).length, 1);
});

test('end ledger rejects out-of-order reused story evidence', () => {
    const first = '艾琳突然冲进钟楼，银白长发在风中扬起。';
    const second = '她拔出银剑挡住怪物的利爪，把你牢牢护在身后。';
    const input = `${first}\n\n${second}\n\n${serializeStoryboardLedger([
        packet({ id: 's1', quote: second, action: 'Eileen blocking the monster claws with her sword' }),
        packet({ id: 's2', quote: first, people: '1girl', cast: [eileen()], action: 'Eileen rushing into the clocktower' }),
    ])}`;
    const result = repairStoryboardFromLedger(input);
    assert.equal(result.shots.length, 1);
    assert.ok(result.errors.some(issue => issue.code === 'ledger_quote_not_in_order' || issue.code === 'quote_not_in_window'));
});

test('end ledger rejects a generic pose that does not match the quoted action', () => {
    const quote = '艾琳猛然挥剑劈向扑来的怪物，剑锋斩断了它的利爪。';
    const input = `${quote}\n\n${serializeStoryboardLedger([
        packet({ quote, action: 'Eileen standing still and smiling softly for a portrait' }),
    ])}`;
    const result = repairStoryboardFromLedger(input);
    assert.equal(result.shots.length, 0);
    assert.ok(result.errors.some(issue => issue.code === 'action_phase_mismatch' || issue.code === 'action_semantics_mismatch'));
});
