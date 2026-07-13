import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('contains all 20 required worldbook scenarios and valid image counts', async () => {
    const scenes = await fixture('worldbook-scenes.json');
    assert.equal(scenes.length, 20);
    assert.deepEqual(scenes.map(scene => scene.id), Array.from({ length: 20 }, (_, index) => index + 1));
    assert.ok(scenes.every(scene => Number.isInteger(scene.expectedCount) && scene.expectedCount >= 0 && scene.expectedCount <= 6));
    assert.ok(scenes.filter(scene => scene.name !== '纯解释无图场景').every(scene => scene.expectedCount >= 3));
    assert.equal(scenes.find(scene => scene.name === '地点切换').expectedCount, 4);
    assert.equal(scenes.find(scene => scene.name === '纯解释无图场景').expectedCount, 0);
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

test('v8.1 worldbook preserves variables and enforces adaptive inline prompts plus identity locks', async () => {
    const worldbook = JSON.parse(await readFile(new URL('../worldbooks/JANIMA_v8_0_worldbook.json', import.meta.url), 'utf8'));
    const entries = Object.values(worldbook.entries);
    assert.equal(entries.length, 5);
    assert.match(entries[1].comment, /v7\.9/);
    assert.equal(entries[1].disable, true);
    assert.match(entries[2].content, /FM_DNA_REGISTERED/);
    assert.match(entries[3].content, /FM_DNA \/ FM_SCENE \/ FM_ANCHOR/);
    assert.match(entries[4].comment, /v8\.1/);
    assert.equal(entries[4].disable, false);
    assert.equal(entries[4].order, 999);
    assert.match(entries[4].content, /至少\s*3\s*个有效 Prompt/);
    assert.match(entries[4].content, /硬上限\s*6\s*张/);
    assert.match(entries[4].content, /每个 Prompt 只描绘它正上方紧邻段落/);
    assert.match(entries[4].content, /禁止\s*\[Unnamed Persona\]/);
    assert.match(entries[4].content, /<!--IMG_COUNT:n-->/);
    assert.match(entries[2].content, /CANONICAL LOCK: Lucifer/);
    assert.match(entries[2].content, /CANONICAL LOCK: Leviathan/);
    assert.match(entries[2].content, /CANONICAL PROP LOCK: Behemoth/);
    assert.match(entries[4].content, /two separate bodies/);
    assert.match(entries[4].content, /角色名字不是外貌/);
    assert.match(entries[4].content, /gothic dress with water-pattern trim:1\.25/);
    assert.match(entries[4].content, /bodysuit、leotard、lingerie/);
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
    assert.match(source, /repairInvalidPrompts:\s*true/);
    assert.match(source, /semanticAudit:\s*true/);
    assert.match(source, /accuracyWorkflow:\s*true/);
    assert.match(source, /janimaSemanticAuditHash/);
    assert.match(source, /Number\(messageId\) === 0/);
    assert.match(workflowSource, /JANIMA_剧情准确_30步_角色锁_v1/);
    assert.match(source, /janima-current-model-prompt-repair/);
    assert.match(source, /janima-invalid-image-button/);
    assert.doesNotMatch(source, /host\.append\(panel\)/);
    assert.match(css, /\.janima-rescue-panel[\s\S]*display:\s*none\s*!important/);
    assert.match(css, /\.janima-inline-image-button/);
});
