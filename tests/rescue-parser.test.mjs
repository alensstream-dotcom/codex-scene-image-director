import test from 'node:test';
import assert from 'node:assert/strict';
import { desiredImageCount, extractImagePrompts, isLikelyImagePrompt, parseDeclaredImageCount, storyParagraphCandidates, storySegmentsForPrompts } from '../lib/rescue-core.mjs';

test('parses the final IMG_COUNT declaration', () => {
    assert.equal(parseDeclaredImageCount('正文\n<!--IMG_COUNT:2-->').count, 2);
    assert.equal(parseDeclaredImageCount('正文\n<!--IMG_COUNT:6-->').count, 6);
    assert.equal(parseDeclaredImageCount('正文').count, null);
});

test('adaptive target starts at three and rises to six for fast multi-beat replies', () => {
    const normal = ['她推开石门，蓝光照亮洞窟。', '少女停在湖边，握紧手中的银剑。', '她回头望向身后的伙伴。'].join('\n\n');
    assert.equal(desiredImageCount(normal), 3);
    const fast = Array.from({ length: 24 }, (_, index) => `突然，第${index + 1}个场景发生明显动作变化。`).join('\n\n');
    assert.equal(desiredImageCount(fast), 6);
});

test('story candidates ignore image prompts and variable/status blocks', () => {
    const text = '她走入大厅，抬头看向王座。\n\n[masterpiece, best quality, 1girl, solo, black dress, grand hall, upper body]\n\n<UpdateVariable>hidden data</UpdateVariable>\n\n<!--IMG_COUNT:1-->';
    const candidates = storyParagraphCandidates(text);
    assert.equal(candidates.length, 1);
    assert.match(candidates[0].text, /走入大厅/);
});

test('retains all count declarations for duplicate-marker diagnostics', () => {
    const result = parseDeclaredImageCount('<!--IMG_COUNT:1-->\n<!--IMG_COUNT:2-->');
    assert.equal(result.count, 2);
    assert.equal(result.matches.length, 2);
});

test('extracts image prompt lines with paragraph locations', () => {
    const text = '剧情。\n\n[1girl, solo, Sakura, pink long hair, home dress, upper body]\n\n<!--IMG_COUNT:1-->';
    const prompts = extractImagePrompts(text);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].tags[0], '1girl');
    assert.ok(prompts[0].paragraphIndex >= 0);
});

test('does not treat choices, links, dialogue brackets, or short lists as image prompts', () => {
    const text = '[接受]\n[拒绝]\n[OpenAI](https://openai.com)\n她说：“[别走]。”\n[A, B, C]';
    assert.equal(extractImagePrompts(text).length, 0);
    assert.equal(isLikelyImagePrompt('A, B, C'), false);
});

test('does not treat JSON Patch arrays as image prompts', () => {
    const patch = '{ "op": "replace", "path": "/剧情/关键事件", "value": "裂痕被发现,万魔殿外出现异响" },{ "op": "replace", "path": "/剧情/模式", "value": "战斗" }';
    assert.equal(isLikelyImagePrompt(patch), false);
    assert.equal(extractImagePrompts(`[${patch}]`).length, 0);
});

test('each image owns all story paragraphs since the previous image', () => {
    const text = [
        '利维坦推开图书馆的大门。', '',
        '她抱紧怀里的布偶，警觉地望向破碎的窗户。', '',
        '[1girl, solo, female focus, adult woman, light-purple twin tails, holding a stuffed demon mascot, looking toward the shattered window, tense expression, medium shot]', '',
        '路西法从阴影中走出，抬手挡住飞来的玻璃。', '',
        '利维坦惊讶地转身看她。', '',
        '[2girls, female focus, two adult women, Lucifer shielding Leviathan, Leviathan turning in surprise, shattered library window, dynamic two-shot]', '',
        '<!--IMG_COUNT:2-->',
    ].join('\n');
    const segments = storySegmentsForPrompts(text);
    assert.equal(segments.length, 2);
    assert.match(segments[0].text, /推开图书馆[\s\S]*破碎的窗户/);
    assert.doesNotMatch(segments[1].text, /推开图书馆/);
    assert.match(segments[1].text, /路西法[\s\S]*利维坦惊讶/);
});
