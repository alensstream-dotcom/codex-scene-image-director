import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('contains all 20 required worldbook scenarios and valid image counts', async () => {
    const scenes = await fixture('worldbook-scenes.json');
    assert.equal(scenes.length, 20);
    assert.deepEqual(scenes.map(scene => scene.id), Array.from({ length: 20 }, (_, index) => index + 1));
    assert.ok(scenes.every(scene => Number.isInteger(scene.expectedCount) && scene.expectedCount >= 0 && scene.expectedCount <= 3));
    assert.equal(scenes.find(scene => scene.name === '单男主普通行动').expectedCount, 0);
    assert.equal(scenes.find(scene => scene.name === '纯心理活动').expectedCount, 0);
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

test('worldbook has exactly the three designed entries and mandatory contract terms', async () => {
    const worldbook = JSON.parse(await readFile(new URL('../worldbooks/JANIMA_worldbook_rescue_v1.json', import.meta.url), 'utf8'));
    const entries = Object.values(worldbook.entries);
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map(entry => entry.comment.split('｜')[0]), ['IMG-CONTRACT', 'IMG-GRAMMAR', 'CHARACTER-DNA']);
    assert.match(entries[0].content, /<!--IMG_COUNT:n-->/);
    assert.match(entries[0].content, /紧跟/);
    assert.match(entries[1].content, /英文标签|English|英文逗号/);
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

test('runtime source uses only the verified Zhihuiji button route and keeps a mobile selection cache', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /\.st-chatu8-image-button/);
    assert.doesNotMatch(source, /generate-image-request/);
    assert.match(source, /30000/);
    assert.match(source, /default LLM requests: 0/);
});
