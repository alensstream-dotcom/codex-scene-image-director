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

test('v8.7 mobile worldbook keeps the primary reply clean for one post-reply storyboard pass', async () => {
    const worldbook = JSON.parse(await readFile(new URL('../worldbooks/JANIMA_v8_0_worldbook.json', import.meta.url), 'utf8'));
    const mobileWorldbook = JSON.parse(await readFile(new URL('../worldbooks/JANIMA_v8_7_Galgame_PostReply_Director.json', import.meta.url), 'utf8'));
    const entries = Object.values(mobileWorldbook.entries);
    assert.notDeepEqual(mobileWorldbook, worldbook);
    assert.equal(entries.length, 3);
    assert.match(mobileWorldbook.entries['2'].content, /\{\{getvar::stat_data\}\}/);
    assert.doesNotMatch(JSON.stringify(mobileWorldbook), /<%[_=]?/);
    assert.match(mobileWorldbook.entries['2'].content, /不依赖 EJS、酒馆助手或 JS-Slash-Runner/);
    assert.match(mobileWorldbook.entries['3'].content, /FM_DNA \/ FM_SCENE \/ FM_ANCHOR/);
    assert.match(mobileWorldbook.entries['4'].comment, /v8\.7/);
    assert.equal(mobileWorldbook.entries['4'].disable, false);
    assert.equal(mobileWorldbook.entries['4'].order, 999);
    assert.match(mobileWorldbook.entries['4'].content, /JANIMA_v8_7_MOBILE_GALGAME_POST_REPLY_DIRECTOR/);
    assert.match(mobileWorldbook.entries['4'].content, /图片分镜由插件在整轮回复完成后一次性读取全文并生成/);
    assert.match(mobileWorldbook.entries['4'].content, /不输出方括号图片 Prompt、JANIMA_SHOT、IMG_COUNT/);
    assert.match(mobileWorldbook.entries['4'].content, /插件会在回复完成后只调用当前模型一次/);
    assert.match(mobileWorldbook.entries['4'].content, /动作发起者、接收者或对象/);
    assert.match(mobileWorldbook.entries['4'].content, /同一拥抱、亲吻、抚摸/);
    assert.match(mobileWorldbook.entries['4'].content, /后半段出现新的动作/);
    assert.match(mobileWorldbook.entries['4'].content, /纯男性、空镜、纯建筑、纯道具/);
    assert.match(mobileWorldbook.entries['2'].content, /CANONICAL LOCK: Lucifer/);
    assert.match(mobileWorldbook.entries['2'].content, /CANONICAL LOCK: Leviathan/);
    assert.match(mobileWorldbook.entries['2'].content, /CANONICAL PROP LOCK: Behemoth/);
    assert.match(mobileWorldbook.entries['4'].content, /相同人物继续使用同一稳定名字/);
    assert.match(mobileWorldbook.entries['4'].content, /成人剧情不回避/);
    assert.match(mobileWorldbook.entries['4'].content, /自愿成人亲密与明确性行为/);
    assert.match(mobileWorldbook.entries['4'].content, /同体位重复动作仍属于同一阶段/);
    assert.match(mobileWorldbook.entries['4'].content, /首次进入/);
    assert.match(mobileWorldbook.entries['4'].content, /明确换体位/);
    assert.match(mobileWorldbook.entries['4'].content, /高潮\/射精结果/);
    assert.match(mobileWorldbook.entries['2'].content, /PREVIOUS SHOT CONTINUITY ANCHOR/);
    assert.match(mobileWorldbook.entries['2'].content, /ANIMA STYLE ANCHOR/);
    assert.match(mobileWorldbook.entries['2'].content, /POST-REPLY CONTINUITY/);
    assert.doesNotMatch(mobileWorldbook.entries['2'].content, /SHOT PACKET CONTINUITY/);
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
    assert.match(source, /evidenceRepair:\s*true/);
    assert.match(source, /postReplyStoryboard:\s*true/);
    assert.match(source, /sameCallEvidence:\s*false/);
    assert.match(source, /useCurrentModel:\s*true/);
    assert.match(source, /STREAM_TOKEN_RECEIVED/);
    assert.match(source, /same-call-story-evidence/);
    assert.match(source, /CHAT_COMPLETION_PROMPT_READY/);
    assert.match(source, /GENERATE_AFTER_COMBINE_PROMPTS/);
    assert.match(source, /JANIMA_STORY_EVIDENCE_V1/);
    assert.match(source, /repairStoryboardFromEvidence/);
    assert.doesNotMatch(source, /buildInstantStoryboard|story-accurate environment|performing the decisive story action/);
    assert.match(source, /repairInvalidPrompts:\s*false/);
    assert.match(source, /semanticAudit:\s*false/);
    assert.match(source, /female_subject_missing/);
    assert.match(source, /story_segment_since_previous_image/);
    assert.match(source, /returnedActions\.some\(action => requiredActions\.has\(action\)\)/);
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
    assert.match(source, /isExplicitNoFemaleStory\(text\)/);
    assert.match(source, /The latest completed story must be checked even when it contains/);
    assert.match(source, /scheduleCompletedReplyScans/);
    assert.match(source, /janima-post-reply-female-gate-clear/);
    const renderCheck = source.slice(source.indexOf('async function renderMessageCheck'), source.indexOf('function scheduleCheck'));
    assert.doesNotMatch(renderCheck, /if \(!host\) return/);
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
