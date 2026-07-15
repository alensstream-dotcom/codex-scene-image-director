import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyBible,
    buildDirectorContract,
    buildFallbackPackets,
    compilePrompt,
    createBible,
    extractNarrativeStory,
    isDuplicateBeat,
    mergePacketIntoBible,
    parseCgPackets,
    seedForPacket,
    stripLegacyImagePromptLines,
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

test('strips multilingual legacy image prompts but preserves short choices and links', () => {
    const story = [
        '她拔剑挡住了巨爪。',
        '[艾琳, 银白长发, 紫色眼睛, 深蓝制服, 正面挡下巨爪, 雨夜车站, 动态中景]',
        '[kneeling embrace kiss tears silver hair wet uniform red ribbon train roof night rain]',
        '[接受, 拒绝]',
        '[角色资料](https://example.com)',
    ].join('\n');
    const cleaned = stripLegacyImagePromptLines(story);
    assert.doesNotMatch(cleaned, /银白长发/);
    assert.doesNotMatch(cleaned, /kneeling embrace/);
    assert.match(cleaned, /\[接受, 拒绝\]/);
    assert.match(cleaned, /\[角色资料\]\(https:\/\/example\.com\)/);
});

test('extracts only narrative prose before mobile status and database payloads', () => {
    const raw = [
        '<content>',
        '樱背着粉色书包，两条樱粉色马尾随着脚步晃动。',
        '',
        '放学后，她和男生并肩走过商店街，递给他一个奶油泡芙。',
        '</content>',
        '<status>世界：Y # 时间11:30\n当前动作：接梗回家</status>',
        '\\n八宇式无聊死了，校长讲了半天话。\\nPS：这不是正文。',
    ].join('\n');
    const story = extractNarrativeStory(raw);
    assert.match(story, /樱粉色马尾/);
    assert.match(story, /奶油泡芙/);
    assert.doesNotMatch(story, /当前动作|八宇式|PS/);
    const packets = buildFallbackPackets(raw, {
        characterName: '樱',
        characterVisual: 'female character, 樱粉色双马尾, 粉色开衫, 校服, 粉色书包',
        maximum: 3,
    });
    assert.ok(packets.every(packet => !/八宇式|当前动作/.test(packet.quote)));
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

test('prompt follows Anima tag order with identity before general action and one safety tag', () => {
    const bible = createBible();
    mergePacketIntoBible(bible, first);
    const result = compilePrompt(first, bible);
    assert.match(result.positive, /^masterpiece, best quality, score_7/);
    assert.ok(result.positive.indexOf('1girl') < result.positive.indexOf('character 1'));
    assert.ok(result.positive.indexOf('character 1') < result.positive.indexOf('original story action'));
    assert.match(result.positive, /long blue hair/);
    assert.doesNotMatch(result.positive, /nsfw|explicit/);
});

test('Anima prompt adds weighted English identity and concise English scene tags', () => {
    const packet = {
        ...first,
        quote: '雨夜列车里，艾琳护在他身前，挥动发光细剑斩断敌人的武器。',
        action: '艾琳护在他身前，挥动发光细剑斩断敌人的武器。',
        setting: '暴雨中的列车车厢，破碎车窗和电火花。',
        cast: [{
            id: '艾琳',
            prompt_name: 'Eileen',
            dna: 'adult woman, 银白长发, 齐刘海, 紫色眼睛, 纤细身材',
            outfit: '湿透的深蓝制服和红色领结',
        }],
    };
    const result = compilePrompt(packet, createBible());
    assert.match(result.positive, /\(long silver-white hair:1\.8\)/);
    assert.match(result.positive, /\(purple eyes:1\.7\)/);
    assert.match(result.positive, /heroine shielding her male partner/);
    assert.match(result.positive, /enemy weapon breaking/);
    assert.match(result.positive, /stormy night/);
});

test('school heroine prompt locks pink twin tails and rejects tactical drift', () => {
    const packet = {
        ...first,
        people: '1girl, 1boy',
        quote: '樱背着粉色书包，两条樱粉色马尾一跳一跳，她和男生一起走过校门。',
        action: '樱走在男生前面，两个人一起走回家。',
        setting: '清晨的小学校门和住宅街。',
        cast: [{
            id: '樱',
            prompt_name: 'Sakura',
            dna: 'female character, 樱粉色双马尾, 粉色眼睛',
            outfit: '粉色开衫, 校服, 百褶裙, 粉色书包, 小皮鞋',
        }],
    };
    const result = compilePrompt(packet, createBible());
    assert.match(result.positive, /\(sakura-pink hair:1\.9\)/);
    assert.match(result.positive, /\(twin ponytails:1\.8\)/);
    assert.match(result.positive, /pink cardigan/);
    assert.match(result.positive, /both clearly visible in the same frame/);
    assert.match(result.negative, /black hair/);
    assert.match(result.negative, /tactical outfit/);
});

test('explicit adult story stages receive direct English Anima action tags without a second model', () => {
    const packet = {
        ...first,
        quote: '两名24岁成年人确认同意后，她跨坐在伴侣身上进入骑乘位并达到高潮。',
        action: '成年女性跨坐骑乘，性交插入后达到高潮，随后事后拥抱。',
        people: '1girl, 1boy',
        cast: [{ id: '艾琳', prompt_name: 'Eileen', dna: '24 years old adult woman, long silver hair, purple eyes', outfit: 'nude' }],
        stage: 'climax',
        safety: 'explicit',
    };
    const result = compilePrompt(packet, createBible());
    assert.match(result.positive, /explicit/);
    assert.match(result.positive, /consensual adult vaginal intercourse/);
    assert.match(result.positive, /cowgirl position/);
    assert.match(result.positive, /adult sexual climax/);
    assert.match(result.positive, /aftercare/);
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

test('fallback does not mistake a dropped sword for undressing', () => {
    const packets = buildFallbackPackets('成年女战士从车顶翻回车厢，细剑脱了手，她跪落后被同伴搀扶起来。', {
        characterName: '艾琳',
        characterVisual: 'adult woman, long silver hair, purple eyes',
        maximum: 1,
    });
    assert.equal(packets.length, 1);
    assert.notEqual(packets[0].stage, 'undressing');
});

test('fallback never applies a different character bible entry by position', () => {
    const bible = createBible();
    bible.wrong = { id: '千纱', prompt_name: 'Chisa', dna: 'adult woman, brown hair', outfit: 'white dress' };
    const packets = buildFallbackPackets('艾琳拔出发光细剑，正面挡下破窗而入的触手。', {
        bible,
        characterName: '艾琳',
        characterVisual: 'adult woman, long silver hair, purple eyes',
        maximum: 1,
    });
    assert.equal(packets.length, 1);
    assert.equal(packets[0].cast[0].id, '艾琳');
    assert.match(packets[0].cast[0].dna, /long silver hair/);
    assert.doesNotMatch(packets[0].cast[0].dna, /brown hair/);
});

test('fallback covers distinct early, middle, and late actions when three slots are available', () => {
    const story = [
        '成年女性艾琳在平台坠落边缘单手抓住他的手腕，把他拉离裂口。',
        '救援绳荡来时，艾琳抱紧他的腰，与他一起摆荡越过断桥。',
        '落上车顶后，艾琳跪坐喘息，随后扑进他怀中含泪亲吻。',
    ].join('\n\n');
    const packets = buildFallbackPackets(story, {
        characterName: '艾琳',
        characterVisual: 'adult woman, long silver hair, purple eyes',
        maximum: 3,
    });
    assert.equal(packets.length, 3);
    assert.match(packets[0].quote, /抓住他的手腕/);
    assert.match(packets[1].quote, /抱紧他的腰/);
    assert.match(packets[2].quote, /含泪亲吻/);
});

test('decisive Chinese beats outrank transitions and a lips-touch kiss is visual', () => {
    const story = [
        '艾琳扣住他的手腕，拽着他跃过车厢门沿。',
        '车窗炸开，艾琳转身挡在他前面，细剑拔出。',
        '第一把刀劈下来时，她挥剑斩断武器，断刃插进车厢壁。',
        '敌人退走后，艾琳收剑坐到他身旁。',
        '她靠过来，银白长发蹭过肩膀，湿冷的嘴唇贴在他的唇上。',
    ].join('\n\n');
    const packets = buildFallbackPackets(story, {
        characterName: '艾琳',
        characterVisual: 'adult woman, long silver hair, purple eyes',
        maximum: 3,
    });
    assert.equal(packets.length, 3);
    assert.ok(packets.some(packet => /斩断武器/.test(packet.quote)));
    assert.ok(packets.some(packet => /嘴唇贴在/.test(packet.quote) && packet.stage === 'kiss'));
    assert.ok(!packets.some(packet => /收剑坐到/.test(packet.quote)));
});

test('the phrase 没打算 after lips touch is not classified as combat', () => {
    const story = [
        '艾琳扣住他的手腕，把他从车门边拉回来。',
        '追兵破窗后，艾琳挥剑斩断迎面劈来的武器。',
        '她靠进他怀里，湿冷的嘴唇贴上来，没打算松开。',
    ].join('\n\n');
    const packets = buildFallbackPackets(story, {
        characterName: '艾琳',
        characterVisual: 'adult woman, long silver hair, purple eyes',
        maximum: 3,
    });
    assert.equal(packets.length, 3);
    assert.equal(packets.at(-1).stage, 'kiss');
});

test('an explicit current-turn appearance repairs stale DNA for the same named heroine', () => {
    const bible = createBible();
    bible['艾琳'] = { id: '艾琳', prompt_name: 'Eileen', dna: 'adult woman, short brown hair, green eyes', outfit: '' };
    const [packet] = buildFallbackPackets('艾琳挥剑斩断迎面砸来的锁链。', {
        bible,
        characterName: '艾琳',
        characterVisual: 'adult woman, long silver hair, purple eyes',
        maximum: 1,
    });
    assert.match(packet.cast[0].dna, /long silver hair/);
    assert.equal(packet.cast[0].identity_change, true);
    mergePacketIntoBible(bible, packet);
    assert.match(bible['艾琳'].dna, /long silver hair/);
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

