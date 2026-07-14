import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStoryboardCoverage, desiredImageCount, extractImagePrompts, hasVisibleFemaleStoryBeat, isLikelyImagePrompt, parseDeclaredImageCount, planStoryboardSlots, storyBeatGroups, storyParagraphCandidates, storySegmentsForPrompts } from '../lib/rescue-core.mjs';

test('parses the final IMG_COUNT declaration', () => {
    assert.equal(parseDeclaredImageCount('正文\n<!--IMG_COUNT:2-->').count, 2);
    assert.equal(parseDeclaredImageCount('正文\n<!--IMG_COUNT:6-->').count, 6);
    assert.equal(parseDeclaredImageCount('正文').count, null);
});

test('adaptive target follows distinct female story beats rather than paragraph quota', () => {
    const normal = ['她推开石门，蓝光照亮洞窟。', '少女停在湖边，握紧手中的银剑。', '她回头望向身后的伙伴。'].join('\n\n');
    assert.equal(desiredImageCount(normal), 3);
    const fast = Array.from({ length: 24 }, (_, index) => `她突然冲入第${index + 1}个场景，动作与地点发生明显变化。`).join('\n\n');
    assert.equal(desiredImageCount(fast), 6);
});

test('merges repeated prose about one continuous action into one image beat', () => {
    const text = [
        '她抱住你，把脸埋在你的肩头。',
        '她仍然抱着你，没有松开双臂。',
        '她继续维持这个拥抱，只是呼吸逐渐平静。',
    ].join('\n\n');
    assert.equal(storyBeatGroups(text).groups.length, 1);
    assert.equal(planStoryboardSlots(text).targetCount, 1);
});

test('continuous non-candidate bridge paragraphs do not split one action into two shots', () => {
    const text = [
        '艾琳在月台灯下突然抱住你，银白长发落在你的肩头，紫色眼睛因为重逢而泛着泪光。',
        '她继续维持着同一个拥抱，双臂没有松开，只把脸更深地埋进你的胸前。',
        '列车广播响了两遍，艾琳仍然抱着你，姿势和位置都没有改变。',
        '她没有松开，只在你耳边轻声说终于等到你了。',
    ].join('\n\n');
    const result = storyBeatGroups(text);
    assert.equal(result.groups.length, 1);
    assert.equal(planStoryboardSlots(text).targetCount, 1);
});

test('plans chronological opening middle and ending slots for distinct changes', () => {
    const text = [
        '银发少女推门进入车站，抬眼找到你。',
        '她走近后伸手递来一张银色车票。',
        '广播响起，她忽然抓住你的手奔向月台。',
        '列车启动前，她转身抱住你，眼里泛起泪光。',
    ].join('\n\n');
    const plan = planStoryboardSlots(text);
    assert.ok(plan.targetCount >= 3);
    assert.equal(plan.slots[0].phase, 'opening');
    assert.equal(plan.slots.at(-1).phase, 'ending');
    assert.ok(plan.slots[0].anchorOrder < plan.slots.at(-1).anchorOrder);
});

test('detects front-loaded buttons and an uncovered late action change', () => {
    const prompt = action => `[masterpiece, best quality, score_7, highres, newest, safe, 1girl, solo, female focus, adult woman, silver hair, blue eyes, ${action}, cinematic medium shot]`;
    const text = [
        '银发少女推门进入车站。', '', prompt('entering the station'), '',
        '她走近后伸手递来一张银色车票。', '', prompt('offering a silver ticket'), '',
        '她仍站在售票机旁，继续递着车票。', '', prompt('offering a silver ticket with her right hand'), '',
        '广播响起后，她忽然抓住你的手奔向月台。', '',
        '列车启动前，她转身抱住你，眼里泛起泪光。', '',
        '<!--IMG_COUNT:3-->',
    ].join('\n');
    const codes = analyzeStoryboardCoverage(text).issues.map(issue => issue.code);
    assert.ok(codes.includes('near_duplicate_action') || codes.includes('repeated_continuous_beat'));
    assert.ok(codes.includes('uncovered_late_beat') || codes.includes('front_loaded_storyboard'));
});

test('story candidates ignore image prompts and variable/status blocks', () => {
    const text = '她走入大厅，抬头看向王座。\n\n[masterpiece, best quality, 1girl, solo, black dress, grand hall, upper body]\n\n<UpdateVariable>hidden data</UpdateVariable>\n\n<!--IMG_COUNT:1-->';
    const candidates = storyParagraphCandidates(text);
    assert.equal(candidates.length, 1);
    assert.match(candidates[0].text, /走入大厅/);
});

test('detects a visible woman in Chinese and English story beats without relying on prompts', () => {
    assert.equal(hasVisibleFemaleStoryBeat('少女推开车门。她朝你伸出手。'), true);
    assert.equal(hasVisibleFemaleStoryBeat('The woman raises her lantern and smiles.'), true);
    assert.equal(hasVisibleFemaleStoryBeat('一个男人独自穿过空城，四周只有建筑。'), false);
    assert.equal(hasVisibleFemaleStoryBeat('[masterpiece, 1girl, female focus, upper body]'), false);
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
