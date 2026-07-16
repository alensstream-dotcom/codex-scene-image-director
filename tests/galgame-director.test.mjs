import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDirectorMessages,
    cleanStory,
    completeScenes,
    desiredShotCount,
    insertInlinePrompts,
    mergeCharactersIntoBible,
    parseDirectorResponse,
} from '../lib/galgame-director.mjs';
import { createBible } from '../lib/director-core.mjs';

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
    mergeCharactersIntoBible(bible, parsed.characters);
    assert.match(bible['樱'].dna, /sakura-pink twin tails/);
    assert.equal(bible['樱'].outfit, 'white evening dress');
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
    assert.equal(parsed.scenes.length, 1);
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

test('local completion supplies valid scenes when the model times out', () => {
    const bible = createBible();
    bible['樱'] = { id: '樱', prompt_name: 'Sakura', dna: 'adult woman, sakura-pink twin tails, purple eyes', outfit: 'pink cardigan, school uniform' };
    const scenes = completeScenes({ story, parsedScenes: [], bible, settings: { minimumShots: 3, maximumShots: 6 } });
    assert.equal(scenes.length, 3);
    assert.match(scenes.at(-1).anchor, /吻住了我/);
});

test('story cleaner removes mobile status/database payload but preserves narrative', () => {
    const raw = `<content>${story}</content>\n<status>时间：18:00\n地点：河堤</status>\n\\n{\"database\":\"not story\"}`;
    const cleaned = cleanStory(raw);
    assert.match(cleaned, /樱松开书包带/);
    assert.doesNotMatch(cleaned, /database|时间：18:00/);
});
