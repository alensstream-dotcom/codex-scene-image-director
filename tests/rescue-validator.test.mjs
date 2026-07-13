import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTurn } from '../lib/rescue-core.mjs';

const good = '樱推开窗户，回头坚定地看向来人。\n\n[1girl, solo, female focus, Sakura, pink long hair, home dress, turning toward the viewer, determined expression, upper body]\n\n<!--IMG_COUNT:1-->';

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

test('rejects male-only and scenery-only Galgame prompts but accepts a female-led mixed shot', () => {
    const story = '门外传来脚步声，众人同时回头。';
    const maleOnly = `${story}\n\n[1boy, solo, black hair, dark coat, running through the corridor, dynamic shot]\n\n<!--IMG_COUNT:1-->`;
    const sceneryOnly = `${story}\n\n[masterpiece, empty gothic corridor, moonlight, detailed background, cinematic lighting]\n\n<!--IMG_COUNT:1-->`;
    const mixed = `${story}\n\n[1girl and 1boy, female focus, adult woman in the foreground, blonde hair, blue eyes, raising her sword, male companion behind her, shocked expression, gothic corridor, dynamic composition]\n\n<!--IMG_COUNT:1-->`;
    assert.ok(validateTurn(maleOnly).issues.some(issue => issue.code === 'female_subject_missing'));
    assert.ok(validateTurn(sceneryOnly).issues.some(issue => issue.code === 'female_subject_missing'));
    assert.ok(!validateTurn(mixed).issues.some(issue => issue.code === 'female_subject_missing'));
});

test('rejects two image prompts with no new story between them', () => {
    const text = [
        '少女拔出长剑，挡在同伴身前。', '',
        '[1girl, solo, female focus, adult woman, silver hair, blue eyes, drawing a sword, determined expression, medium shot]', '',
        '[1girl, solo, female focus, adult woman, silver hair, blue eyes, holding a sword, determined expression, close-up]', '',
        '<!--IMG_COUNT:2-->',
    ].join('\n');
    assert.ok(validateTurn(text).issues.some(issue => issue.code === 'empty_story_segment'));
});

test('a short female reaction still counts as a new story segment', () => {
    const text = '她笑了。\n\n[1girl, solo, female focus, adult woman, blonde hair, blue eyes, smiling warmly, close-up reaction, soft lighting]\n\n<!--IMG_COUNT:1-->';
    assert.ok(!validateTurn(text).issues.some(issue => issue.code === 'empty_story_segment'));
});

test('accepts a story-aligned explicit adult female-led prompt', () => {
    const text = [
        '两名成年人在卧室里延续彼此自愿的亲密互动，她主动拉近距离。',
        '',
        '[masterpiece, best quality, score_7, highres, newest, explicit, 1girl and 1boy, female focus, adult woman, tall curvy build, pale skin, oval face, very long blonde hair, blue eyes, adult man behind her, intimate embrace, bedroom, flushed expression, medium two-shot, warm lighting]',
        '',
        '<!--IMG_COUNT:1-->',
    ].join('\n');
    const result = validateTurn(text);
    assert.ok(!result.issues.some(issue => ['female_subject_missing', 'people_conflict', 'solo_relation_conflict'].includes(issue.code)));
    assert.equal(result.ok, true);
});
