import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStoryboardCoverage, buildInstantStoryboard, desiredImageCount, extractImagePrompts, hasVisibleFemaleStoryBeat, isExplicitNoFemaleStory, isLikelyImagePrompt, parseDeclaredImageCount, planStoryboardSlots, storyBeatGroups, storyParagraphCandidates, storySegmentsForPrompts } from '../lib/rescue-core.mjs';

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

test('instant storyboard guarantees inline prompts without a second model call', () => {
    const text = [
        '艾琳走进卧室，银白长发披在肩后。',
        '她俯身与成年男性主角进行口部互动，抬眼观察他的反应。',
        '她随后引导成年男性主角首次进入她体内，身体在接触瞬间绷紧。',
        '她翻身骑到成年男性主角身上，明确改变体位并掌握节奏。',
        '她在最后一次动作中达到高潮，身体痉挛后抱紧成年男性主角。',
    ].join('\n\n');
    const built = buildInstantStoryboard(text, {
        preferred: 3,
        maximum: 6,
        previousPrompt: '1girl, adult woman, silver hair, violet eyes, slim build, black dress',
    });
    assert.equal(built.prompts.length, 4);
    assert.deepEqual(built.prompts.map(item => item.action_phase), ['oral_sex', 'penetration', 'position_change', 'climax']);
    assert.ok(built.prompts.every(item => item.source === 'instant-local'));
    assert.ok(built.prompts.every(item => item.prompt.startsWith('[masterpiece, best quality, score_7')));
    assert.match(built.prompts[0].prompt, /oral sex/);
    assert.match(built.prompts[3].prompt, /orgasm/);
    assert.ok(built.prompts.every(item => /silver hair/.test(item.prompt)));
});

test('instant storyboard reuses reply prompts in chronological order and only fills missing slots locally', () => {
    const text = [
        '她走进大厅，推开身后的门。',
        '[masterpiece, best quality, score_7, safe, 1girl, female focus, adult woman, long blue hair, blue eyes, white dress, entering, grand hall, medium shot]',
        '她突然拔剑挡在你的身前。',
        '她随后回身抱住你，露出释然的笑容。',
    ].join('\n\n');
    const built = buildInstantStoryboard(text, { preferred: 3, maximum: 3 });
    assert.equal(built.prompts.length, 3);
    assert.equal(built.prompts[0].source, 'reply');
    assert.deepEqual(built.prompts.slice(1).map(item => item.source), ['instant-local', 'instant-local']);
});

test('instant storyboard does not exhaust or stop after many consecutive turns', () => {
    let previousPrompt = '1girl, adult woman, long purple hair, purple eyes, slim build, navy dress';
    for (let turn = 0; turn < 12; turn++) {
        const text = [
            `第${turn + 1}轮，她突然推门进入大厅。`,
            '她拔出短剑挡住袭来的攻击，斗篷在身后扬起。',
            '她随后回身抱住你，露出终于放心的笑容。',
        ].join('\n\n');
        const built = buildInstantStoryboard(text, { preferred: 3, maximum: 3, previousPrompt });
        assert.equal(built.prompts.length, 3);
        assert.ok(built.prompts.every(item => item.prompt.includes('female focus')));
        previousPrompt = built.prompts.at(-1).prompt;
    }
});

test('female continuity handles name-only prose without reopening the male-only gate', () => {
    const nameOnly = [
        '艾琳推门进入大厅，银发被风吹起。',
        '艾琳拔剑挡住袭击，紫瞳盯紧敌人。',
        '艾琳收剑抱住主角，终于露出笑容。',
    ].join('\n\n');
    assert.equal(hasVisibleFemaleStoryBeat(nameOnly), false);
    assert.equal(buildInstantStoryboard(nameOnly, {
        preferred: 3,
        maximum: 3,
        assumeFemale: true,
        previousPrompt: 'Eileen, adult woman, silver-white long hair, violet eyes, navy dress',
    }).prompts.length, 3);

    const maleOnly = '一个陌生男人独自站在城堡外。\n\n镜头切到空无一人的走廊。';
    assert.equal(isExplicitNoFemaleStory(maleOnly), true);
    assert.equal(planStoryboardSlots(maleOnly).targetCount, 0);
});

test('adult action ledger keeps real phase changes and merges only continuous penetration', () => {
    const text = [
        '她解开礼服，让衣物滑落到床边。',
        '她俯身与你进行口部互动，抬眼观察你的反应。',
        '她引导你进入她体内，身体在接触瞬间绷紧。',
        '她继续维持结合，反复抽送，没有改变体位。',
        '她随后翻身骑到你身上，改变体位并掌握节奏。',
        '她在最后一次动作中达到高潮，身体痉挛后失神地抱紧你。',
        '事后她依偎着你休息，呼吸逐渐平静。',
    ].join('\n\n');
    const result = storyBeatGroups(text);
    assert.deepEqual(result.groups.map(group => group.actionPhase), [
        'outfit_change',
        'oral_sex',
        'penetration',
        'position_change',
        'climax',
        'aftercare',
    ]);
    const plan = planStoryboardSlots(text);
    assert.equal(plan.targetCount, 6);
    assert.equal(plan.slots.at(-2).actionPhase, 'climax');
    assert.match(plan.slots.at(-2).selectedBeatText, /达到高潮/);
});

test('climax outranks routine contact inside its story window', () => {
    const text = [
        '她轻轻抚摸你的肩膀，脸上带着潮红。',
        '她继续贴近你，保持相同的触碰。',
        '她终于达到高潮，抱紧你时全身颤栗，随后失神地倒在你怀里。',
    ].join('\n\n');
    const plan = planStoryboardSlots(text, { preferred: 1, maximum: 1 });
    assert.equal(plan.targetCount, 1);
    assert.equal(plan.slots[0].actionPhase, 'climax');
    assert.match(plan.slots[0].selectedBeatText, /达到高潮/);
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

test('story candidates ignore hidden reasoning and markdown planning paragraphs', () => {
    const text = [
        '<thinking>',
        '# 1.基础要求确认：本次需要规划三张图片。',
        '# 2.剧情要求：先安排互动，再输出提示词。',
        '</thinking>',
        '银发少女推开门，拔剑挡住袭击。',
    ].join('\n\n');
    const candidates = storyParagraphCandidates(text);
    assert.equal(candidates.length, 1);
    assert.match(candidates[0].text, /拔剑挡住袭击/);
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
