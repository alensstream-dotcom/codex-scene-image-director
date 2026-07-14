import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('contains all 20 required worldbook scenarios and valid image counts', async () => {
    const scenes = await fixture('worldbook-scenes.json');
    assert.equal(scenes.length, 20);
    assert.deepEqual(scenes.map(scene => scene.id), Array.from({ length: 20 }, (_, index) => index + 1));
    assert.ok(scenes.every(scene => Number.isInteger(scene.expectedCount) && scene.expectedCount >= 0 && scene.expectedCount <= 6));
    assert.equal(scenes.find(scene => scene.name === '单女角色首次登场').expectedCount, 1);
    assert.equal(scenes.find(scene => scene.name === '两个独立高价值镜头').expectedCount, 2);
    assert.equal(scenes.find(scene => scene.name === '地点切换').expectedCount, 4);
    assert.equal(scenes.find(scene => scene.name === '纯解释无图场景').expectedCount, 0);
    assert.equal(scenes.find(scene => scene.name === '单男主普通行动').expectedCount, 0);
});

test('sofa regression contains every fixed assertion', async () => {
    const scene = await fixture('sofa-scene.json');
    for (const tag of scene.mustInclude) assert.ok(scene.prompt.toLowerCase().includes(tag.toLowerCase()), tag);
});

test('doorway regression restores current clothing/action and excludes invented people', async () => {
    const scene = await fixture('doorway-scene.json');
    for (const tag of scene.mustInclude) assert.ok(scene.prompt.toLowerCase().includes(tag.toLowerCase()), tag);
    for (const tag of scene.mustNotInclude) assert.ok(!scene.prompt.toLowerCase().includes(tag.toLowerCase()), tag);
});

test('v8.3 mobile worldbook plans distinct full-turn events and preserves identity locks', async () => {
    const worldbook = JSON.parse(await readFile(new URL('../worldbooks/JANIMA_v8_0_worldbook.json', import.meta.url), 'utf8'));
    const mobileWorldbook = JSON.parse(await readFile(new URL('../worldbooks/JANIMA_v8_3_Galgame_Director.json', import.meta.url), 'utf8'));
    const entries = Object.values(mobileWorldbook.entries);
    assert.notDeepEqual(mobileWorldbook, worldbook);
    assert.equal(entries.length, 3);
    assert.ok(!worldbook.entries['0']);
    assert.ok(!worldbook.entries['1']);
    assert.match(mobileWorldbook.entries['2'].content, /\{\{getvar::stat_data\}\}/);
    assert.doesNotMatch(JSON.stringify(mobileWorldbook), /<%[_=]?/);
    assert.match(mobileWorldbook.entries['2'].content, /不依赖 EJS、酒馆助手或 JS-Slash-Runner/);
    assert.match(mobileWorldbook.entries['3'].content, /FM_DNA \/ FM_SCENE \/ FM_ANCHOR/);
    assert.match(mobileWorldbook.entries['4'].comment, /v8\.3/);
    assert.equal(mobileWorldbook.entries['4'].disable, false);
    assert.equal(mobileWorldbook.entries['4'].order, 999);
    assert.match(mobileWorldbook.entries['4'].content, /整轮事件表/);
    assert.match(mobileWorldbook.entries['4'].content, /同一次拥抱、亲吻、抚摸/);
    assert.match(mobileWorldbook.entries['4'].content, /正文后 40%/);
    assert.match(mobileWorldbook.entries['4'].content, /只有 1 个事件组就 1 张，2 个就 2 张/);
    assert.match(mobileWorldbook.entries['4'].content, /核心动作签名互不重复/);
    assert.match(mobileWorldbook.entries['4'].content, /硬上限\s*6\s*张/);
    assert.match(mobileWorldbook.entries['4'].content, /上一张 Prompt 之后/);
    assert.match(mobileWorldbook.entries['4'].content, /窗口内全部剧情再选镜/);
    assert.match(mobileWorldbook.entries['4'].content, /女性硬门禁/);
    assert.match(mobileWorldbook.entries['4'].content, /单独男性、纯场景、纯建筑、纯道具/);
    assert.match(mobileWorldbook.entries['4'].content, /整轮完全没有真实可见女性[\s\S]*IMG_COUNT:0/);
    assert.match(mobileWorldbook.entries['4'].content, /最佳镜头赢家规则/);
    assert.match(mobileWorldbook.entries['4'].content, /禁止\s*\[Unnamed Persona\]/);
    assert.match(mobileWorldbook.entries['4'].content, /<!--IMG_COUNT:n-->/);
    assert.match(mobileWorldbook.entries['2'].content, /CANONICAL LOCK: Lucifer/);
    assert.match(mobileWorldbook.entries['2'].content, /CANONICAL LOCK: Leviathan/);
    assert.match(mobileWorldbook.entries['2'].content, /CANONICAL PROP LOCK: Behemoth/);
    assert.match(mobileWorldbook.entries['4'].content, /two separate bodies/);
    assert.match(mobileWorldbook.entries['4'].content, /角色名字不是外貌/);
    assert.match(mobileWorldbook.entries['4'].content, /gothic dress with water-pattern trim:1\.25/);
    assert.match(mobileWorldbook.entries['4'].content, /bodysuit、leotard、lingerie/);
    assert.match(mobileWorldbook.entries['4'].content, /masterpiece, best quality, score_7, highres, newest/);
    assert.match(mobileWorldbook.entries['4'].content, /普通内容 safe；擦边\/内衣 sensitive；裸露 nsfw；明确性行为 explicit/);
    assert.match(mobileWorldbook.entries['4'].content, /成人剧情照常出图/);
    assert.match(mobileWorldbook.entries['4'].content, /不得仅因内容属于 NSFW 就省略 Prompt/);
    assert.match(mobileWorldbook.entries['4'].content, /持续的相同动作或体位只用 1 张/);
    assert.match(mobileWorldbook.entries['4'].content, /裸体镜头也不会换人/);
    assert.match(mobileWorldbook.entries['4'].content, /只允许一个以 @ 开头的精确画师标签/);
    assert.match(mobileWorldbook.entries['2'].content, /PREVIOUS SHOT CONTINUITY ANCHOR/);
    assert.match(mobileWorldbook.entries['2'].content, /ANIMA STYLE ANCHOR/);
});

test('regex package has three narrow rules and preserves ordinary brackets', async () => {
    const rules = JSON.parse(await readFile(new URL('../regex/JANIMA_rescue_regex.json', import.meta.url), 'utf8'));
    assert.equal(rules.length, 3);
    assert.equal(rules[2].disabled, true);
    const parse = literal => {
        const match = literal.match(/^\/(.*)\/([a-z]*)$/s);
        return new RegExp(match[1], match[2]);
    };
    const promptRule = parse(rules[1].findRegex);
    assert.equal('[接受]'.replace(promptRule, ''), '[接受]');
    assert.equal('[OpenAI](https://openai.com)'.replace(promptRule, ''), '[OpenAI](https://openai.com)');
    assert.equal('[1girl, solo, Sakura, pink hair, home dress, upper body]'.replace(promptRule, ''), '');
});

test('runtime is silent and uses only the verified inline Zhihuiji button route', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const workflowSource = await readFile(new URL('../lib/anima-workflow.mjs', import.meta.url), 'utf8');
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(source, /\.st-chatu8-image-button/);
    assert.doesNotMatch(source, /generate-image-request/);
    assert.match(source, /silentMode:\s*true/);
    assert.match(source, /inlineButtons:\s*true/);
    assert.match(source, /generateQuietPrompt/);
    assert.match(source, /minimumImages:\s*3/);
    assert.match(source, /maximumImages:\s*6/);
    assert.match(source, /repairInvalidPrompts:\s*false/);
    assert.match(source, /semanticAudit:\s*false/);
    assert.match(source, /female_subject_missing/);
    assert.match(source, /story_segment_since_previous_image/);
    assert.match(source, /BLOCKING_IMAGE_ISSUE_CODES/);
    assert.match(source, /promptRecord\?\.issues\?\.some/);
    assert.doesNotMatch(source, /buttonNode\.dataset\.imageTag = promptRecord\.prompt/);
    assert.doesNotMatch(source, /await reloadCurrentChat\?\.\(\)/);
    assert.doesNotMatch(source, /native payload cannot be proven to match/);
    assert.match(source, /nativePayloadMismatch/);
    assert.match(source, /setTimeout\(configureChatu8AccuracyWorkflow, 800\)/);
    assert.match(workflowSource, /chatu8Settings\.scriptEnabled = true/);
    assert.match(source, /accuracyWorkflow:\s*true/);
    assert.match(source, /janimaSemanticAuditHash/);
    assert.doesNotMatch(source, /Number\(messageId\) === 0/);
    assert.match(source, /hasVisibleFemaleStoryBeat\(text\)/);
    assert.match(source, /首次聊天文件尚未建立/);
    assert.match(source, /await eventSource\.emit\(event_types\.MESSAGE_UPDATED/);
    assert.match(source, /updateMessageBlock\(id, message\)/);
    assert.match(workflowSource, /JANIMA_Galgame_Turbo_8步_角色锁_v1/);
    assert.match(source, /janima-current-model-prompt-repair/);
    assert.match(source, /janima-invalid-image-button/);
    assert.doesNotMatch(source, /host\.append\(panel\)/);
    assert.match(css, /\.janima-rescue-panel[\s\S]*display:\s*none\s*!important/);
    assert.match(css, /\.janima-inline-image-button/);
});
