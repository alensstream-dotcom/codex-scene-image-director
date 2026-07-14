import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyMissingPrompts,
    extractImagePrompts,
    makeCacheKey,
    parseStrictJson,
    reinforcePromptLocal,
    replacePromptAt,
    replaceStoryboardPrompts,
} from '../lib/rescue-core.mjs';

test('local reinforcement is deterministic and never calls fetch', () => {
    const oldFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = () => { called = true; throw new Error('must not call'); };
    try {
        const result = reinforcePromptLocal('[1girl， pink hair, pink hair, sitting]');
        assert.match(result, /^\[masterpiece, best quality, score_7, highres, newest, safe, 1girl, solo,/);
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

test('local reinforcement makes a Galgame protagonist physically visible for contact', () => {
    const result = reinforcePromptLocal('[Eileen, adult woman, silver-white long hair, violet eyes, touching the protagonist chest crest with her right fingertips, emotional close-up]');
    assert.match(result, /1girl and 1boy/);
    assert.match(result, /male protagonist torso partly visible/);
    assert.doesNotMatch(result, /, solo,/);
    assert.equal(reinforcePromptLocal(result), result);
});

test('local reinforcement selects one Anima safety tag from the actual content', () => {
    const normal = reinforcePromptLocal('[1girl, silver hair, school uniform, smile, upper body]');
    const clothedCurvy = reinforcePromptLocal('[1girl, adult woman, large breasts, formal gothic dress, upper body]');
    const nude = reinforcePromptLocal('[1girl, solo, nude, nipples, lying on bed, upper body]');
    const adult = reinforcePromptLocal('[1girl, 1boy, vaginal sex, explicit, on bed, medium shot]');
    assert.match(normal, /newest, safe, 1girl/);
    assert.match(clothedCurvy, /newest, safe, 1girl/);
    assert.match(nude, /newest, nsfw, 1girl/);
    assert.match(adult, /newest, explicit, 1girl/);
    assert.doesNotMatch(adult, /, safe,/);
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
    assert.match(next, /^第一段。\n\n\[masterpiece, best quality, score_7, highres, newest, safe, 1girl/m);
    assert.match(next, /第二段。/);
});

test('storyboard replacement removes old clustered prompts and inserts a new late shot', () => {
    const old = [
        '她推门进入大厅。', '',
        '[1girl, solo, female focus, adult woman, silver hair, entering, medium shot]', '',
        '她仍站在门口。', '',
        '[1girl, solo, female focus, adult woman, silver hair, standing, close-up]', '',
        '她突然拔剑挡住袭击。', '',
        '<!--IMG_COUNT:2-->',
    ].join('\n');
    const actionParagraph = old.split(/\n\n/).findIndex(value => value.includes('突然拔剑'));
    const next = replaceStoryboardPrompts(old, [{
        after_paragraph_index: actionParagraph,
        prompt_tags: ['masterpiece', 'best quality', '1girl', 'solo', 'female focus', 'adult woman', 'silver hair', 'blue eyes', 'drawing a sword', 'protecting her companion', 'determined expression', 'dynamic medium shot'],
    }]);
    assert.equal(extractImagePrompts(next).length, 1);
    assert.match(next, /突然拔剑[\s\S]*drawing a sword/);
    assert.match(next, /IMG_COUNT:1/);
    assert.doesNotMatch(next, /standing, close-up/);
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
