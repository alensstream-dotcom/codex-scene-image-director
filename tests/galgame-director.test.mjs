import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_DIRECTOR_SETTINGS,
    buildDirectorMessages,
    cleanStory,
    composeDirectedMessage,
    completeScenes,
    desiredShotCount,
    insertInlinePrompts,
    mergeCharactersIntoBible,
    parseDirectorResponse,
} from '../lib/galgame-director.mjs';
import { buildFallbackPackets, createBible, mergePacketIntoBible } from '../lib/director-core.mjs';

const story = [
    '清晨的校门前，成年女性樱背着粉色书包跑来，樱粉色双马尾在肩后跃动。她笑着抓住我的手腕，把我从自行车旁拉到自己面前。',
    '走过商店街时，樱忽然停在橱窗前。她把奶油泡芙递到我的嘴边，紫色眼睛期待地望着我，直到我低头咬下一口。',
    '傍晚的河堤起了风。樱松开书包带，转身扑进我的怀里，双臂紧紧环住我的腰，随后含着眼泪吻住了我。',
].join('\n\n');

const response = {
    characters: [{
        name: '樱', english_name: 'Sakura', sex: 'female', age: 'adult',
        identity: 'adult woman, slim build, sakura-pink twin tails, purple eyes',
        outfit: 'pink cardigan, school uniform, pleated skirt, pink school bag',
        outfit_changed: false,
    }],
    scenes: [
        {
            anchor: '她笑着抓住我的手腕，把我从自行车旁拉到自己面前。', female_names: ['樱'], stage: 'wrist_pull',
            action_key: 'Sakura grabs his wrist and pulls him close', people: '1girl, 1boy',
            prompt: 'school gate, wrist pull, surprised boy, smiling heroine, dynamic medium shot', safety: 'safe',
        },
        {
            anchor: '她把奶油泡芙递到我的嘴边，紫色眼睛期待地望着我，直到我低头咬下一口。', female_names: ['樱'], stage: 'feeding',
            action_key: 'Sakura feeds him a cream puff', people: '1girl, 1boy',
            prompt: 'shopping street, feeding cream puff, both faces visible, intimate close shot', safety: 'safe',
        },
        {
            anchor: '樱松开书包带，转身扑进我的怀里，双臂紧紧环住我的腰，随后含着眼泪吻住了我。', female_names: ['樱'], stage: 'tearful_kiss',
            action_key: 'Sakura embraces him and kisses him with tears', people: '1girl, 1boy',
            prompt: 'riverside sunset, tight embrace, tearful kiss, windblown twin tails, cinematic close shot', safety: 'safe',
        },
    ],
};

test('one response covers early, middle and late story beats and inserts prompts inline', () => {
    const bible = createBible();
    const parsed = parseDirectorResponse(response, { story, bible, settings: { minimumShots: 3, maximumShots: 6 } });
    assert.equal(parsed.scenes.length, 3);
    assert.ok(parsed.scenes[0].position < parsed.scenes[1].position);
    assert.ok(parsed.scenes[1].position < parsed.scenes[2].position);
    const result = insertInlinePrompts(story, parsed.scenes);
    assert.equal(result.inserted, 3);
    for (const scene of parsed.scenes) {
        const anchorEnd = result.message.indexOf(scene.anchor) + scene.anchor.length;
        assert.equal(result.message.slice(anchorEnd).trimStart().startsWith('['), true);
    }
});

test('out-of-order model anchors are independently grounded and restored to story order', () => {
    const reversed = { ...response, scenes: [...response.scenes].reverse() };
    const parsed = parseDirectorResponse(reversed, { story, bible: createBible(), settings: { minimumShots: 3, maximumShots: 6 } });
    assert.equal(parsed.scenes.length, 3);
    assert.deepEqual(parsed.scenes.map(scene => scene.anchor), response.scenes.map(scene => scene.anchor));
});

test('character identity remains locked while an explicit outfit change is accepted', () => {
    const bible = createBible();
    mergeCharactersIntoBible(bible, parseDirectorResponse(response, { story, bible }).characters);
    const drift = structuredClone(response);
    drift.characters[0].identity = 'adult woman, short black hair, blue eyes';
    drift.characters[0].outfit = 'white evening dress';
    drift.characters[0].outfit_changed = true;
    const nextStory = '成年女性樱换上白色晚礼服，走进宴会厅。她转了一圈，提起裙摆向我伸手。';
    const nextResponse = {
        characters: drift.characters,
        scenes: [{
            anchor: '她转了一圈，提起裙摆向我伸手。', female_names: ['樱'], stage: 'dress_turn',
            action_key: 'Sakura turns and offers her hand', people: '1girl, 1boy', prompt: 'ballroom, white evening dress, elegant turn', safety: 'safe',
        }],
    };
    const parsed = parseDirectorResponse(nextResponse, { story: nextStory, bible });
    for (const scene of parsed.scenes) mergePacketIntoBible(bible, scene.packet);
    assert.match(bible['樱'].dna, /sakura-pink twin tails/);
    assert.match(bible['樱'].outfit, /white evening dress/);
});

test('repeated action, pure male/scenery, and sexual minor scenes are rejected', () => {
    const unsafeStory = [
        '成年女性艾琳抓住他的手腕，把他拉到门边。',
        '她仍然抓着他的手腕，继续维持同一个动作。',
        '空荡的城堡大厅只剩月光和一把剑。',
        '未成年女孩莉莉走进房间，随后出现了露骨的性行为。',
    ].join('\n\n');
    const unsafeResponse = {
        characters: [
            { name: '艾琳', english_name: 'Eileen', sex: 'female', age: 'adult', identity: 'adult woman, long silver hair, purple eyes', outfit: 'blue dress' },
            { name: '莉莉', english_name: 'Lily', sex: 'female', age: 'minor', identity: 'minor girl, blonde hair, blue eyes', outfit: 'dress' },
        ],
        scenes: [
            { anchor: '成年女性艾琳抓住他的手腕，把他拉到门边。', female_names: ['艾琳'], stage: 'wrist_pull', action_key: 'Eileen grabs and pulls his wrist', people: '1girl, 1boy', prompt: 'wrist pull at doorway', safety: 'safe' },
            { anchor: '她仍然抓着他的手腕，继续维持同一个动作。', female_names: ['艾琳'], stage: 'wrist_pull', action_key: 'Eileen keeps grabbing and pulling his wrist', people: '1girl, 1boy', prompt: 'same wrist pull', safety: 'safe' },
            { anchor: '空荡的城堡大厅只剩月光和一把剑。', female_names: [], stage: 'scenery', action_key: 'empty hall', people: '', prompt: 'empty castle hall, moonlight, sword', safety: 'safe' },
            { anchor: '未成年女孩莉莉走进房间，随后出现了露骨的性行为。', female_names: ['莉莉'], stage: 'explicit', action_key: 'explicit sexual intercourse', people: '1girl, 1boy', prompt: 'explicit sex', safety: 'explicit' },
        ],
    };
    const parsed = parseDirectorResponse(unsafeResponse, { story: unsafeStory, bible: createBible() });
    assert.equal(parsed.scenes.length, 1, JSON.stringify(parsed.scenes.map(scene => ({
        anchor: scene.anchor,
        stage: scene.packet.stage,
        cast: scene.packet.cast.map(item => ({ id: item.id, age: item.age })),
        evidenceWindow: scene.evidenceWindow,
    }))));
    assert.equal(parsed.scenes[0].packet.cast[0].id, '艾琳');
});

test('normal female reply targets three shots, fast plot can scale, and requests remain compact', () => {
    assert.equal(desiredShotCount(story, { minimumShots: 3, maximumShots: 6 }), 3);
    const fast = `${story}\n\n她拔剑挡住袭击，旋身斩断锁链，拉着我跃过断桥，又在落地后跪下包扎伤口。`;
    assert.ok(desiredShotCount(fast, { minimumShots: 3, maximumShots: 6 }) >= 4);
    const messages = buildDirectorMessages({ story, lastUserMessage: '继续约会。', bible: createBible() });
    assert.equal(messages.length, 2);
    assert.match(messages[0].content, /Never front-load/);
    assert.match(messages[0].content, /Sexual scenes are forbidden/);
    assert.match(messages[0].content, /Physical accuracy is mandatory/);
    assert.match(messages[0].content, /body part \+ contact \+ direction/);
    assert.ok(messages[1].content.length < 12000);
});

test('normal cafe story keeps the three cinematic beats instead of static transitions', () => {
    const cafeStory = [
        '艾琳走进站台咖啡店，湿制服在地板上滴下一串水印。',
        '艾琳端着热咖啡走来，把杯子递进他的手里，杯口冒着白色热气。',
        '她坐到他身边，用拇指擦掉他唇边的奶泡，两个人的脸靠得很近。',
        '晨光铺满站台，艾琳环住他的腰，抬头主动吻住他的嘴唇。',
        '她松开手后退一步，转身沿着站台慢慢离开。',
    ].join('\n\n');
    const makeScene = (anchor, stage, action) => ({
        anchor,
        position: cafeStory.indexOf(anchor),
        end: cafeStory.indexOf(anchor) + anchor.length,
        prompt: action,
        packet: { stage, action, quote: anchor, cast: [{ id: '艾琳' }] },
    });
    const scenes = [
        makeScene('艾琳走进站台咖啡店', 'entering cafe', 'Eileen enters the cafe'),
        makeScene('艾琳端着热咖啡走来，把杯子递进他的手里', 'serving coffee', 'Eileen hands him a steaming coffee cup'),
        makeScene('她坐到他身边，用拇指擦掉他唇边的奶泡', 'wiping milk foam', 'Eileen wipes milk foam from his lip'),
        makeScene('艾琳环住他的腰，抬头主动吻住他的嘴唇', 'kissing', 'Eileen embraces and kisses him'),
        makeScene('她松开手后退一步，转身沿着站台慢慢离开', 'parting', 'Eileen walks away'),
    ];
    const cafeBible = createBible();
    cafeBible['艾琳'] = { id: '艾琳', prompt_name: 'Eileen', sex: 'female', age: 'adult', dna: 'adult woman, long silver hair, purple eyes', outfit: 'dark navy uniform' };
    const selected = completeScenes({ story: cafeStory, parsedScenes: scenes, bible: cafeBible, settings: { minimumShots: 3, maximumShots: 6 } });
    assert.deepEqual(selected.map(scene => scene.packet.stage), ['coffee_handoff', 'wiping', 'kiss']);

    const incompleteModelPick = scenes.filter(scene => ['wiping milk foam', 'kissing', 'parting'].includes(scene.packet.stage));
    const repaired = completeScenes({ story: cafeStory, parsedScenes: incompleteModelPick, bible: cafeBible, settings: { minimumShots: 3, maximumShots: 6 } });
    assert.equal(repaired.some(scene => scene.packet.stage === 'parting'), false);
    assert.equal(repaired.some(scene => /coffee/i.test(scene.packet.stage) || /咖啡/.test(scene.packet.quote)), true, JSON.stringify(repaired.map(scene => ({ stage: scene.packet.stage, quote: scene.packet.quote }))));
    assert.equal(repaired.some(scene => /wiping|milk foam/i.test(scene.packet.stage)), true);
    assert.equal(repaired.some(scene => /kiss/i.test(scene.packet.stage)), true);
});

test('live station-cafe fallback keeps one action per shot and never carries old props or weather forward', () => {
    const liveStory = [
        '站台尽头的小咖啡店还亮着灯。艾琳走向柜台，湿掉的深蓝制服在木地板上滴下一串水印。',
        '他刚坐下，艾琳就端着两杯咖啡过来。她把其中一杯推到他面前，杯口冒着热气。',
        '艾琳绕过桌子坐到他旁边，卡座皮垫陷下去一块。她抬手，用拇指擦掉他唇上的奶泡。',
        '她站起来，他也跟着起身。',
        '推门出去时晨光已经铺满站台。银白长发、齐刘海和紫眼睛的艾琳穿着湿透的深蓝制服和红色领结环住他的腰，抬头吻住他的嘴唇。',
    ].join('\n\n');
    const bible = createBible();
    bible.heroine = { id: 'heroine', prompt_name: 'heroine', dna: '', outfit: 'school uniform' };
    const scenes = completeScenes({ story: liveStory, parsedScenes: [], bible, settings: { minimumShots: 3, maximumShots: 6 } });
    assert.deepEqual(scenes.map(scene => scene.packet.stage), ['coffee_handoff', 'wiping', 'kiss']);
    assert.match(scenes[0].anchor, /推到他面前/);
    assert.equal(scenes.some(scene => /站起来，他也跟着起身/.test(scene.anchor)), false);
    assert.doesNotMatch(scenes[0].prompt, /wiping milk foam|right thumb/i);
    assert.doesNotMatch(scenes[1].prompt, /handing a steaming coffee|active heavy rain/i);
    assert.doesNotMatch(scenes[2].prompt, /steaming coffee cup|wiping milk foam|active heavy rain/i);
    assert.ok(scenes.every(scene => /dark navy uniform/i.test(scene.packet.cast[0].outfit)));
    assert.ok(scenes.every(scene => /silver-white hair/i.test(scene.packet.cast[0].dna)));
    assert.ok(scenes.every(scene => /purple eyes/i.test(scene.packet.cast[0].dna)));
    assert.ok(scenes.every(scene => !/wet dark navy uniform[^,]*,\s*dark navy uniform/i.test(scene.prompt)));
    assert.match(scenes[2].packet.cast[0].outfit, /red ribbon tie/);
});

test('global optimizer reserves early middle and late coverage even when model candidates front-load', () => {
    const neutralA = '两个人继续谈论旅途中的见闻，窗外的光线缓慢移动。'.repeat(9);
    const neutralB = '他们又安静地聊了一会儿，时间在平稳的对话中流逝。'.repeat(9);
    const spreadStory = [
        '成年女性艾琳在咖啡店把热咖啡推到成年男友手里。她立刻又环住他的腰主动亲吻。',
        neutralA,
        '走到长廊中段时，艾琳靠近成年男友，用拇指擦掉他唇边残留的奶泡。',
        neutralB,
        '抵达站台尽头后，艾琳拔剑挡住袭击，旋身斩断敌人的武器，断刃飞落在地。',
    ].join('\n\n');
    const bible = createBible();
    bible['艾琳'] = { id: '艾琳', prompt_name: 'Eileen', dna: 'adult woman, long silver hair, purple eyes', outfit: 'dark navy uniform' };
    const earlyOnly = [
        { anchor: '成年女性艾琳在咖啡店把热咖啡推到成年男友手里。', position: 0, end: 25, packet: { stage: 'coffee_handoff', action: 'coffee handoff', quote: 'coffee', cast: [{ id: '艾琳' }] } },
        { anchor: '她立刻又环住他的腰主动亲吻。', position: 26, end: 42, packet: { stage: 'kiss', action: 'kiss', quote: 'kiss', cast: [{ id: '艾琳' }] } },
    ].map(scene => ({ ...scene, prompt: scene.packet.action, negative: '' }));
    const selected = completeScenes({ story: spreadStory, parsedScenes: earlyOnly, bible, settings: { minimumShots: 3, maximumShots: 3 } });
    const ratios = selected.map(scene => scene.position / spreadStory.length);
    assert.equal(selected.length, 3);
    assert.ok(ratios.some(value => value < 1 / 3), JSON.stringify(ratios));
    assert.ok(ratios.some(value => value >= 1 / 3 && value < 2 / 3), JSON.stringify(ratios));
    assert.ok(ratios.some(value => value >= 2 / 3), JSON.stringify(ratios));
    assert.ok(selected.some(scene => scene.packet.stage === 'wiping'));
    assert.ok(selected.some(scene => /combat/.test(scene.packet.stage)));
});

test('local completion supplies valid scenes when the model times out', () => {
    const bible = createBible();
    bible['樱'] = { id: '樱', prompt_name: 'Sakura', dna: 'adult woman, sakura-pink twin tails, purple eyes', outfit: 'pink cardigan, school uniform' };
    const scenes = completeScenes({ story, parsedScenes: [], bible, settings: { minimumShots: 3, maximumShots: 6 } });
    assert.equal(scenes.length, 3);
    assert.match(scenes.at(-1).anchor, /吻住了我/);
});

test('each final prompt window starts after the previous selected image and contains no future plot', () => {
    const bible = createBible();
    bible['樱'] = { id: '樱', prompt_name: 'Sakura', dna: 'adult woman, sakura-pink twin tails, purple eyes', outfit: 'pink cardigan, school uniform' };
    const clean = cleanStory(story);
    const scenes = completeScenes({ story, parsedScenes: [], bible, settings: { minimumShots: 3, maximumShots: 6 } });
    let previousEnd = 0;
    scenes.forEach((scene, index) => {
        assert.equal(scene.evidenceWindow, clean.slice(previousEnd, scene.end));
        assert.equal(scene.evidenceWindow.includes(scene.anchor), true);
        if (scenes[index + 1]) assert.equal(scene.evidenceWindow.includes(scenes[index + 1].anchor), false);
        previousEnd = scene.end;
    });
});

test('a one-shot model answer is repaired to three manual buttons from exact story beats', () => {
    const shortStory = [
        '成年女性艾琳穿着深蓝制服，把热咖啡递进他的手里。',
        '她用拇指擦掉他唇边的奶泡，两个人的脸靠得很近。',
        '她环住他的腰，抬头吻住他的嘴唇。',
    ].join('\n\n');
    const modelOnlyFoundOne = {
        characters: [{
            name: '艾琳', english_name: 'Eileen', sex: 'female', age: 'adult',
            identity: '24 years old adult woman, long silver hair, purple eyes',
            outfit: 'dark navy uniform',
        }],
        scenes: [{
            anchor: '成年女性艾琳穿着深蓝制服，把热咖啡递进他的手里。',
            female_names: ['艾琳'], stage: 'coffee', action_key: 'Eileen hands him coffee',
            people: '1girl, 1boy', prompt: 'coffee handoff', outfits: { 艾琳: 'dark navy uniform' }, safety: 'safe',
        }],
    };
    const bible = createBible();
    const parsed = parseDirectorResponse(modelOnlyFoundOne, { story: shortStory, bible });
    mergeCharactersIntoBible(bible, parsed.characters);
    const repaired = completeScenes({
        story: shortStory,
        parsedScenes: parsed.scenes,
        bible,
        settings: { minimumShots: 3, maximumShots: 6 },
    });
    assert.equal(DEFAULT_DIRECTOR_SETTINGS.autoGenerate, false);
    assert.equal(repaired.length, 3);
    assert.deepEqual(repaired.map(scene => scene.packet.stage), ['coffee_handoff', 'wiping', 'kiss']);
    assert.ok(repaired.every(scene => shortStory.includes(scene.anchor)));
});

test('outfit is resolved at each anchor and model wardrobe hallucinations are discarded', () => {
    const outfitStory = [
        '24岁成年女性艾琳身穿深蓝色制服和红色领结，把热咖啡递进成年男友的手里。',
        '她明确换上白色晚礼服，在宴会厅旋身挡住袭来的利刃，裙摆在灯下扬起。',
        '危险解除后，她脱下白色晚礼服，赤裸着跨坐到成年男友身上亲吻他。',
    ].join('\n\n');
    const raw = {
        characters: [{
            name: '艾琳', english_name: 'Eileen', sex: 'female', age: 'adult',
            identity: '24 years old adult woman, long silver hair, purple eyes',
            outfit: 'black tactical suit',
        }],
        scenes: [
            { anchor: outfitStory.split('\n\n')[0], female_names: ['艾琳'], stage: 'coffee', action_key: 'coffee', people: '1girl, 1boy', prompt: 'black tactical suit on a train', outfits: { 艾琳: 'black tactical suit' }, safety: 'safe' },
            { anchor: outfitStory.split('\n\n')[1], female_names: ['艾琳'], stage: 'combat', action_key: 'blocks the blade', people: '1girl, 1boy', prompt: 'black tactical suit', outfits: { 艾琳: 'black tactical suit' }, safety: 'safe' },
            { anchor: outfitStory.split('\n\n')[2], female_names: ['艾琳'], stage: 'straddle', action_key: 'kisses him', people: '1girl, 1boy', prompt: 'black tactical suit', outfits: { 艾琳: 'black tactical suit' }, safety: 'nsfw' },
        ],
    };
    const bible = createBible();
    bible['艾琳'] = {
        id: '艾琳', prompt_name: 'Eileen', dna: '24 years old adult woman, long silver hair, purple eyes', outfit: 'casual clothes',
    };
    const parsed = parseDirectorResponse(raw, { story: outfitStory, bible });
    const scenes = completeScenes({ story: outfitStory, parsedScenes: parsed.scenes, bible, settings: { minimumShots: 3, maximumShots: 3 } });
    assert.equal(scenes.length, 3);
    assert.match(scenes[0].packet.cast[0].outfit, /dark navy uniform/);
    assert.match(scenes[0].packet.cast[0].outfit, /red ribbon tie/);
    assert.match(scenes[1].packet.cast[0].outfit, /white evening dress/);
    assert.equal(scenes[2].packet.cast[0].outfit, 'completely nude');
    assert.ok(scenes.every(scene => !/black tactical|casual clothes/i.test(scene.prompt)));
});

test('adult NSFW fast plot selects each decisive stage and skips the static setup', () => {
    const adultStory = [
        '24岁成年女性艾琳走进卧室，只是站在床边看着她25岁的成年男友。',
        '她脱下深蓝制服和内衣，赤裸身体跪到他的腿间。',
        '她在双方同意后开始口交，双手扶住成年男友的腰。',
        '随后成年男友进入她，双方继续自愿性交。',
        '她跨坐在成年男友身上切换成骑乘位，双手按住他的胸口。',
        '节奏加快，艾琳仰起头，在骑乘位达到高潮。',
    ].join('\n\n');
    const bible = createBible();
    bible['艾琳'] = {
        id: '艾琳', prompt_name: 'Eileen', dna: '24 years old adult woman, long silver hair, purple eyes', outfit: 'dark navy uniform',
    };
    const localPackets = buildFallbackPackets(adultStory, { bible, minimum: 5, maximum: 5 });
    assert.deepEqual(
        localPackets.map(packet => packet.stage),
        ['undressing', 'oral', 'penetration', 'position_change', 'climax'],
        JSON.stringify(localPackets.map(packet => ({ stage: packet.stage, quote: packet.quote }))),
    );
    const scenes = completeScenes({ story: adultStory, parsedScenes: [], bible, settings: { minimumShots: 3, maximumShots: 6 } });
    assert.equal(scenes.length, 5);
    assert.deepEqual(
        scenes.map(scene => scene.packet.stage),
        ['undressing', 'oral', 'penetration', 'position_change', 'climax'],
        JSON.stringify(scenes.map(scene => ({ stage: scene.packet.stage, anchor: scene.anchor }))),
    );
    assert.equal(scenes.some(scene => /只是站在床边/.test(scene.anchor)), false);
    assert.equal(scenes.at(-1).anchor.includes('达到高潮'), true);
});

test('unsupported model locations, props, actions and outfits cannot reach the final prompt', () => {
    const groundedStory = '成年女性艾琳身穿深蓝制服，在站台咖啡店把冒着热气的咖啡杯递进成年男友手里。';
    const bible = createBible();
    bible['艾琳'] = {
        id: '艾琳', prompt_name: 'Eileen', dna: 'adult woman, long silver hair, purple eyes', outfit: 'dark navy uniform',
    };
    const parsed = parseDirectorResponse({
        characters: [{ name: '艾琳', english_name: 'Eileen', sex: 'female', age: 'adult', identity: bible['艾琳'].dna, outfit: 'black dress' }],
        scenes: [{
            anchor: groundedStory,
            female_names: ['艾琳'], stage: 'sword fight', action_key: 'Eileen draws a sword inside a moving train',
            people: '1girl, 1boy', prompt: 'black dress, sword duel, moving train', outfits: { 艾琳: 'black dress' }, safety: 'safe',
        }],
    }, { story: groundedStory, bible });
    assert.equal(parsed.scenes.length, 1);
    const [scene] = completeScenes({ story: groundedStory, parsedScenes: parsed.scenes, bible, settings: { minimumShots: 3, maximumShots: 3 } });
    assert.ok(scene.audit.rejectedConcepts.includes('sword'));
    assert.ok(scene.audit.rejectedConcepts.includes('train'));
    assert.match(scene.prompt, /coffee/i);
    assert.match(scene.prompt, /dark navy uniform/i);
    assert.doesNotMatch(scene.prompt, /moving train|sword duel|draws a sword|black dress/i);
    assert.match(scene.evidenceWindow, /咖啡杯递进/);
});

test('story cleaner removes mobile status/database payload but preserves narrative', () => {
    const raw = `<content>${story}</content>\n<status>时间：18:00\n地点：河堤</status>\n\\n{\"database\":\"not story\"}`;
    const cleaned = cleanStory(raw);
    assert.match(cleaned, /樱松开书包带/);
    assert.doesNotMatch(cleaned, /database|时间：18:00/);
});

test('hidden model drafts and legacy worldbook prompts are replaced by clean inline director prompts', () => {
    const raw = [
        '<!-- 输出开始 -->',
        '# 1.基础要求确认：this hidden planning must never become story',
        '<content>',
        '<!-- version 1: discarded draft -->',
        'Adult heroine Eileen steadies him with both hands on his shoulders.',
        '',
        'Eileen blocks the attacker and cuts the blade in half.',
        '',
        'Eileen rests on his shoulder and kisses him with tears.',
        '</content>',
        '<status>time: midnight\nplace: train</status>',
        '[legacy woman prompt, silver hair, purple eyes, wet uniform, train, rain, standing, duplicate, scenery]',
        '<!-- 输出结束 -->',
    ].join('\n');
    const storyOnly = cleanStory(raw);
    assert.doesNotMatch(storyOnly, /hidden planning|discarded draft|legacy woman prompt|status|version\s*\d/i);
    assert.match(storyOnly, /^Adult heroine Eileen/);
    const scenes = [
        { anchor: 'Adult heroine Eileen steadies him with both hands on his shoulders.', position: 0, prompt: 'director prompt one' },
        { anchor: 'Eileen blocks the attacker and cuts the blade in half.', position: 70, prompt: 'director prompt two' },
        { anchor: 'Eileen rests on his shoulder and kisses him with tears.', position: 130, prompt: 'director prompt three' },
    ];
    const composed = composeDirectedMessage(raw, storyOnly, scenes);
    assert.equal(composed.inserted, 3);
    assert.match(composed.message, /director prompt one/);
    assert.match(composed.message, /director prompt three/);
    assert.match(composed.message, /<status>time: midnight/);
    assert.doesNotMatch(composed.message, /hidden planning|legacy woman prompt/);
});

test('a feminine pronoun is enough to keep female-led storyboarding active', () => {
    const pronounStory = '她在雨夜列车里奔跑，随后抓住同伴并挡下袭击。'.repeat(8);
    assert.ok(desiredShotCount(pronounStory, { minimumShots: 3, maximumShots: 6 }) > 0);
});
