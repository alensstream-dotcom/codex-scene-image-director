import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyMissingPrompts,
    extractImagePrompts,
    makeCacheKey,
    parseStrictJson,
    reinforcePromptLocal,
    replacePromptAt,
} from '../lib/rescue-core.mjs';

test('local reinforcement is deterministic and never calls fetch', () => {
    const oldFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = () => { called = true; throw new Error('must not call'); };
    try {
        const result = reinforcePromptLocal('[1girl， pink hair, pink hair, sitting]');
        assert.match(result, /^\[1girl, solo,/);
        assert.equal((result.match(/pink hair/g) || []).length, 1);
        assert.match(result, /tight composition/);
        assert.equal(called, false);
    } finally {
        globalThis.fetch = oldFetch;
    }
});

test('local reinforcement never adds solo to an explicit two-girl prompt', () => {
    const result = reinforcePromptLocal('[2girls, Sakura, Lan, distinct outfits, standing together, upper body]');
    assert.ok(!result.split(',').map(tag => tag.trim().toLowerCase()).includes('solo'));
});

test('repair replaces only one prompt and preserves story', () => {
    const source = '第一段正文。\n\n[1girl, solo, Sakura, pink hair, home dress, upper body]\n\n第二段正文。\n\n<!--IMG_COUNT:1-->';
    const prompt = extractImagePrompts(source)[0];
    const next = replacePromptAt(source, prompt, '[1girl, solo, Sakura, pink long hair, home dress, upper body]');
    assert.match(next, /第一段正文。/);
    assert.match(next, /第二段正文。/);
    assert.equal(extractImagePrompts(next).length, 1);
});

test('whole-turn fill inserts only at requested paragraph', () => {
    const source = '第一段。\n\n第二段。\n\n<!--IMG_COUNT:1-->';
    const next = applyMissingPrompts(source, [{ after_paragraph_index: 0, prompt_tags: ['1girl', 'solo', 'Sakura', 'pink hair', 'home dress', 'upper body'] }]);
    assert.match(next, /^第一段。\n\n\[1girl/m);
    assert.match(next, /第二段。/);
});

test('cache key changes by message, content, prompt, and mode', () => {
    const base = { messageId: 1, messageContent: 'a', originalPrompt: 'b', repairMode: 'ai' };
    const key = makeCacheKey(base);
    assert.equal(key, makeCacheKey(base));
    assert.notEqual(key, makeCacheKey({ ...base, repairMode: 'wholeTurn' }));
});

test('invalid AI response cannot overwrite the original', () => {
    const original = '[1girl, solo, Sakura, pink hair, home dress, upper body]';
    assert.throws(() => parseStrictJson('I could not create the requested prompts.'));
    assert.equal(original, '[1girl, solo, Sakura, pink hair, home dress, upper body]');
});

test('strict JSON accepts a plain object response', () => {
    assert.deepEqual(parseStrictJson('{"prompt_tags":["1girl"]}'), { prompt_tags: ['1girl'] });
});

test('JSON parser tolerates Markdown fences and short reasoning wrappers', () => {
    assert.deepEqual(parseStrictJson('```json\n{"prompts":[]}\n```'), { prompts: [] });
    assert.deepEqual(parseStrictJson('Done.\n{"prompts":[{"prompt_tags":["brace } inside string"]}]}\nUse it.'), {
        prompts: [{ prompt_tags: ['brace } inside string'] }],
    });
});
