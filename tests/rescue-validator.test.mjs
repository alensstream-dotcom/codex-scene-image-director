import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTurn } from '../lib/rescue-core.mjs';

const good = '剧情。\n\n[1girl, solo, Sakura, pink long hair, home dress, upper body]\n\n<!--IMG_COUNT:1-->';

test('accepts matching count and prompt', () => {
    const result = validateTurn(good);
    assert.equal(result.detectedPromptCount, 1);
    assert.equal(result.issues.length, 0);
    assert.equal(result.ok, true);
});

test('reports missing and mismatched counts', () => {
    assert.ok(validateTurn(good.replace('<!--IMG_COUNT:1-->', '<!--IMG_COUNT:2-->')).issues.some(issue => issue.code === 'count_mismatch'));
    assert.ok(validateTurn(good.replace(/<!--IMG_COUNT:1-->/, '')).issues.some(issue => issue.code === 'missing_count'));
});

test('flags Chinese, prose, people conflicts, duplicates, and piled prompts', () => {
    const text = [
        '正文。', '',
        '[1girl, 2girls, solo, 樱, pink hair, home dress]', '',
        '[1girl, solo, Sakura, pink hair, home dress, she thinks while sitting because she is sad]', '',
        '[1girl, solo, Sakura, pink hair, home dress, she thinks while sitting because she is sad]', '',
        '<!--IMG_COUNT:3-->',
    ].join('\n');
    const codes = validateTurn(text).issues.map(issue => issue.code);
    for (const code of ['contains_chinese', 'prose_sentence', 'people_conflict', 'duplicate_prompt', 'piled_at_end']) assert.ok(codes.includes(code), code);
});

test('flags prompts longer than the configured limit', () => {
    const long = `[1girl, solo, Sakura, pink hair, home dress, upper body, ${'detailed background, '.repeat(50)}soft lighting]`;
    assert.ok(validateTurn(`${long}\n\n<!--IMG_COUNT:1-->`, { maxPromptChars: 100 }).issues.some(issue => issue.code === 'too_long'));
});

test('flags solo prompts that explicitly place a second person beside the subject', () => {
    const text = '剧情。\n\n[1girl, solo, Lucifer, blonde hair, blue eyes, Leviathan kneeling beside her, dark hall, medium shot]\n\n<!--IMG_COUNT:1-->';
    assert.ok(validateTurn(text).issues.some(issue => issue.code === 'solo_relation_conflict'));
});
