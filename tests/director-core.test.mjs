import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyBible,
    buildDirectorContract,
    buildFallbackPackets,
    compilePrompt,
    createBible,
    isDuplicateBeat,
    mergePacketIntoBible,
    parseCgPackets,
    seedForPacket,
    stripProtocol,
} from '../lib/director-core.mjs';

const marker = packet => `<!--JANIMA_CG:${JSON.stringify(packet)}-->`;

const first = {
    id: 's1',
    quote: 'Seraphina 抓住他的手腕，把他拉进月光下。',
    people: '1girl, 1boy',
    cast: [{
        id: 'Seraphina',
        prompt_name: 'Seraphina',
        dna: 'adult woman, slim build, pale skin, oval face, long blue hair, amber eyes',
        outfit: 'white combat dress',
    }],
    action: 'Seraphina grabs his wrist and pulls him into the moonlight',
    setting: 'ruined chapel',
    expression: 'determined gaze',
    composition: 'dynamic medium shot, rim light',
    stage: 'wrist_pull',
    safety: 'safe',
};

test('parses complete same-response packets and strips protocol', () => {
    const text = `剧情第一段。\n\n${first.quote}${marker(first)}\n\n收尾。<!--JANIMA_CG_END:{"count":1}-->`;
    const parsed = parseCgPackets(text);
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.packets.length, 1);
    assert.equal(parsed.packets[0].cast[0].id, 'Seraphina');
    assert.equal(stripProtocol(text), `剧情第一段。\n\n${first.quote}\n\n收尾。`);
});

test('ignores an incomplete streaming marker until it closes', () => {
    const partial = `正文<!--JANIMA_CG:{"id":"s1","quote":"尚未结束"`;
    assert.equal(parseCgPackets(partial).packets.length, 0);
});

test('locks immutable DNA and carries outfit unless story changes it', () => {
    const bible = createBible();
    mergePacketIntoBible(bible, first);
    const drift = structuredClone(first);
    drift.id = 's2';
    drift.cast[0].dna = 'adult woman, short red hair, green eyes';
    drift.cast[0].outfit = 'black coat';
    const locked = applyBible(drift, bible);
    assert.match(locked.cast[0].dna, /long blue hair/);
    assert.equal(locked.cast[0].outfit, 'white combat dress');

    drift.cast[0].outfit_change = true;
    mergePacketIntoBible(bible, drift);
    assert.equal(bible.seraphina.outfit, 'black coat');
    assert.match(bible.seraphina.dna, /long blue hair/);
});

test('prompt places decisive story action before identity and uses one safety tag', () => {
    const bible = createBible();
    mergePacketIntoBible(bible, first);
    const result = compilePrompt(first, bible);
    assert.ok(result.positive.indexOf('decisive action') < result.positive.indexOf('character 1'));
    assert.match(result.positive, /^safe,/);
    assert.match(result.positive, /long blue hair/);
    assert.doesNotMatch(result.positive, /nsfw|explicit/);
});

test('duplicate continuous action is filtered but a new stage passes', () => {
    const repeat = { ...first, id: 's2', quote: '她仍抓着他的手腕继续拉扯。', action: 'Seraphina keeps grabbing his wrist and pulling him' };
    assert.equal(isDuplicateBeat(repeat, [first]), true);
    const change = { ...repeat, id: 's3', stage: 'sword_clash', action: 'Seraphina releases his wrist and blocks a sword strike' };
    assert.equal(isDuplicateBeat(change, [first]), false);
});

test('fallback is local, female-gated, late-aware, and does not create scenery CG', () => {
    const story = [
        '月光照在空无一人的走廊和古老的石柱上。',
        '她握住剑柄，却只是站在原地观察。',
        '怪物撞破门扉时，她旋身拔剑，银色剑锋贴着脸颊挡住利爪，火花照亮她愤怒的眼睛。',
    ].join('\n\n');
    const packets = buildFallbackPackets(story, {
        characterName: 'Seraphina',
        characterVisual: 'adult woman, long blue hair, amber eyes',
        maximum: 2,
    });
    assert.ok(packets.length >= 1);
    assert.match(packets.at(-1).quote, /挡住利爪/);
    assert.equal(buildFallbackPackets('空城里只有风吹过废墟。').length, 0);
});

test('identity seed stays stable across scene wording and changes only on reroll', () => {
    const next = { ...first, id: 's2', action: 'a completely new action', setting: 'new place' };
    assert.equal(seedForPacket(first), seedForPacket(next));
    assert.notEqual(seedForPacket(first), seedForPacket(first, 1));
});

test('contract is adaptive, inline, female-gated and adult-safe for explicit scenes', () => {
    const contract = buildDirectorContract({ bibleText: '- Seraphina: DNA=long blue hair', maximumShots: 3 });
    assert.match(contract, /immediately append ONE compact/);
    assert.match(contract, /A continuous pose\/action is ONE CG/);
    assert.match(contract, /Every shot must contain a woman/);
    assert.match(contract, /adults \(18\+\)/);
    assert.match(contract, /at most 3/);
});

