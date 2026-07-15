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

test('v8.8 mobile worldbook creates one hidden same-reply ledger with no second model', async () => {
    const worldbook = JSON.parse(await readFile(new URL('../worldbooks/JANIMA_v8_0_worldbook.json', import.meta.url), 'utf8'));
    const mobileWorldbook = JSON.parse(await readFile(new URL('../worldbooks/JANIMA_v8_8_Galgame_SameReply_Ledger_Director.json', import.meta.url), 'utf8'));
    const entries = Object.values(mobileWorldbook.entries);
    assert.notDeepEqual(mobileWorldbook, worldbook);
    assert.equal(entries.length, 3);
    assert.match(mobileWorldbook.entries['2'].content, /\{\{getvar::stat_data\}\}/);
    assert.doesNotMatch(JSON.stringify(mobileWorldbook), /<%[_=]?/);
    assert.match(mobileWorldbook.entries['2'].content, /不依赖 EJS、酒馆助手或 JS-Slash-Runner/);
    assert.match(mobileWorldbook.entries['3'].content, /FM_DNA \/ FM_SCENE \/ FM_ANCHOR/);
    assert.match(mobileWorldbook.entries['4'].comment, /v8\.8/);
    assert.equal(mobileWorldbook.entries['4'].disable, false);
    assert.equal(mobileWorldbook.entries['4'].order, 999);
    assert.match(mobileWorldbook.entries['4'].content, /JANIMA_v8_8_MOBILE_GALGAME_SAME_REPLY_LEDGER_DIRECTOR/);
    assert.match(mobileWorldbook.entries['4'].content, /插件只在本机把账本变成智绘姬原位按钮/);
    assert.match(mobileWorldbook.entries['4'].content, /JANIMA_STORYBOARD_V2/);
    assert.match(mobileWorldbook.entries['4'].content, /不调用、不等待智绘姬内部 LLM 或第二个模型/);
    assert.match(mobileWorldbook.entries['4'].content, /从本轮正文逐字复制/);
    assert.match(mobileWorldbook.entries['4'].content, /发起者\+准确可见物理动作\/接触/);
    assert.match(mobileWorldbook.entries['4'].content, /后半段若有新动作/);
    assert.match(mobileWorldbook.entries['4'].content, /单男性、纯场景、纯建筑、纯道具/);
    assert.match(mobileWorldbook.entries['2'].content, /CANONICAL LOCK: Lucifer/);
    assert.match(mobileWorldbook.entries['2'].content, /CANONICAL LOCK: Leviathan/);
    assert.match(mobileWorldbook.entries['2'].content, /CANONICAL PROP LOCK: Behemoth/);
    assert.match(mobileWorldbook.entries['4'].content, /cast\.id 是跨回合稳定身份键/);
    assert.match(mobileWorldbook.entries['4'].content, /成人剧情不删减但必须动作准确/);
    assert.match(mobileWorldbook.entries['4'].content, /自愿成人亲密、裸露和明确性行为/);
    assert.match(mobileWorldbook.entries['4'].content, /同体位持续反复最多一张/);
    assert.match(mobileWorldbook.entries['4'].content, /首次进入/);
    assert.match(mobileWorldbook.entries['4'].content, /明确换体位/);
    assert.match(mobileWorldbook.entries['4'].content, /高潮\/射精结果/);
    assert.match(mobileWorldbook.entries['2'].content, /PREVIOUS SHOT CONTINUITY ANCHOR/);
    assert.match(mobileWorldbook.entries['2'].content, /ANIMA STYLE ANCHOR/);
    assert.match(mobileWorldbook.entries['2'].content, /SAME-REPLY LEDGER CONTINUITY/);
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
    assert.match(source, /postReplyStoryboard:\s*false/);
    assert.match(source, /sameCallEvidence:\s*true/);
    assert.match(source, /useCurrentModel:\s*false/);
    assert.match(source, /STREAM_TOKEN_RECEIVED/);
    assert.match(source, /if \(runtime\.generationActive\) \{/);
    assert.match(source, /Wait for GENERATION_ENDED before any evidence rewrite/);
    assert.match(source, /MESSAGE_RECEIVED is SillyTavern's committed assistant message/);
    assert.match(source, /same-call-story-evidence/);
    assert.match(source, /CHAT_COMPLETION_PROMPT_READY/);
    assert.match(source, /GENERATE_AFTER_COMBINE_PROMPTS/);
    assert.match(source, /JANIMA_STORYBOARD_V2/);
    assert.match(source, /repairStoryboardFromLedger/);
    assert.match(source, /same-reply-end-ledger/);
    assert.match(source, /zero-second-llm/);
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
