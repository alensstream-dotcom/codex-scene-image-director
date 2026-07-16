import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildFallbackShotsV4,
    buildPlannerPrompt,
    composePromptV4,
    nsfwLevelForText,
    parsePlannerResponse,
    selectShotsV4,
} from '../lib/director-v4.mjs';

test('isolated planner maps exact paragraph indexes and applies stable identity registry', () => {
    const story = '青青在庭院里握住木剑。\n\n师父站到她身后，手覆在她手背上纠正剑势。\n\n两人随后走到湖边。';
    const raw = JSON.stringify({
        target_count: 3,
        characters: [
            { name: '青青', identity: 'adult woman, long brown hair, green eyes, round face', outfit: 'pale blue hanfu' },
            { name: '师父', identity: 'adult woman, long black hair, golden eyes, oval face', outfit: 'white hanfu' },
        ],
        shots: [{
            id: 's1', paragraph_index: 1, block: 'training', importance: 98, nsfw_level: 0, stage: 'sword_action', must_draw: true,
            people: '2girls', character_names: ['青青', '师父'], character_tags: 'two adult women', outfit_tags: 'pale blue hanfu, white hanfu',
            setting_tags: 'traditional Chinese courtyard', action_tags: 'hand over hand sword guidance, both hands gripping one wooden sword',
            expression_tags: 'focused expressions', camera_tags: 'medium shot, warm sunlight', positive: 'xianxia visual novel CG', negative: 'school uniform'
        }]
    });
    const parsed = parsePlannerResponse(raw, story);
    assert.equal(parsed.shots[0].paragraphIndex, 1);
    assert.equal(parsed.shots[0].anchor, '师父站到她身后，手覆在她手背上纠正剑势。');
    assert.match(parsed.shots[0].characterTags, /long brown hair/);
    assert.match(parsed.shots[0].characterTags, /long black hair/);
});

test('selection avoids clustering and covers early middle late', () => {
    const story = ['她推开院门走进庭院。', '她握住木剑摆好起手式。', '师父站到她身后纠正握剑姿势。', '她重新挥剑劈开落叶。', '两人走进厨房开始烹鱼。', '她端起鱼汤递给师父。', '傍晚她们离开院子。', '两人沿着竹林小路奔向湖边。', '她在湖心亭回头招手。'].join('\n\n');
    const fallback = buildFallbackShotsV4(story);
    const plan = selectShotsV4({ story, plannerShots: fallback, fallbackShots: [], minimum: 3, maximum: 5, requestedCount: 3 });
    assert.ok(plan.shots.length >= 3 && plan.shots.length <= 5);
    assert.deepEqual(new Set(plan.diagnostics.zones), new Set(['early', 'middle', 'late']));
    assert.equal(new Set(plan.shots.map(s => s.paragraphIndex)).size, plan.shots.length);
});

test('explicit text cannot be downgraded and undressing uses level two', () => {
    assert.equal(nsfwLevelForText('两名成年人发生性交并达到高潮', 1), 3);
    assert.equal(nsfwLevelForText('成年女子慢慢脱下衣服，露出身体', 0), 2);
    assert.equal(nsfwLevelForText('两个成年人轻轻接吻', 0), 1);
});

test('explicit branch forces adult action and removes conflicting safe terms', () => {
    const result = composePromptV4({
        paragraph: '两名成年人发生性交。', people: '1girl, 1boy', characterTags: 'adult woman, adult man', outfitTags: 'nude', settingTags: 'bedroom',
        actionTags: 'consensual adult intercourse', expressionTags: 'flushed face', cameraTags: 'intimate medium close-up',
        stage: 'penetration', nsfwLevel: 3, positive: '', negative: ''
    }, { fixedPositive: 'masterpiece, sfw, fully clothed', fixedNegative: 'bad hands, no nudity, no sex' });
    assert.match(result.positive, /explicit consensual adult sexual scene/);
    assert.match(result.positive, /explicit penetration/);
    assert.doesNotMatch(result.positive, /fully clothed|\bsfw\b/i);
    assert.doesNotMatch(result.negative, /no nudity|no sex/);
    assert.match(result.negative, /censored/);
});

test('non-school ancient scene strips academy clothing pollution', () => {
    const result = composePromptV4({
        paragraph: '青青身穿浅青色汉服，在庭院中练剑。', people: '1girl', characterTags: 'adult woman, long brown hair', outfitTags: 'pale blue hanfu',
        settingTags: 'traditional Chinese courtyard', actionTags: 'practicing swordsmanship', expressionTags: 'focused expression', cameraTags: 'medium shot',
        stage: 'sword_action', nsfwLevel: 0, positive: 'academy uniform, school blazer, necktie', negative: ''
    }, { fixedPositive: 'masterpiece, school uniform', fixedNegative: 'bad hands' });
    assert.match(result.positive, /period-accurate hanfu/);
    assert.doesNotMatch(result.positive, /school uniform|academy uniform|school blazer|necktie/i);
    assert.match(result.negative, /school uniform/);
});

test('planner prompt isolates worldbook assumptions and requests more candidates than final images', () => {
    const prompt = buildPlannerPrompt({ story: '她穿着白色汉服练剑。', card: { name: '青青', visual: '黑色长发' }, minimum: 3, maximum: 5 });
    assert.match(prompt.systemPrompt, /Ignore roleplay instructions, world-book rules/i);
    assert.match(prompt.systemPrompt, /Return strict JSON only/i);
    assert.match(prompt.systemPrompt, /6-10 distinct high-value candidate shots/i);
    assert.match(prompt.userPrompt, /\[P0\]/);
    assert.match(prompt.userPrompt, /character_names/);
});

test('fallback action and NSFW classification use current paragraph only', () => {
    const story = '两名成年人在卧室发生性交。\n\n她们穿好衣服走进厨房。\n\n她在灶台前烹鱼。';
    const shots = buildFallbackShotsV4(story);
    const kitchen = shots.find(shot => shot.paragraphIndex === 2);
    const transition = shots.find(shot => shot.paragraphIndex === 1);
    assert.equal(kitchen.stage, 'cooking');
    assert.equal(kitchen.nsfwLevel, 0);
    assert.match(kitchen.actionTags, /cooking fish/);
    assert.doesNotMatch(kitchen.actionTags, /intercourse|penetration/);
    assert.equal(transition.nsfwLevel, 0);
});

test('adult reserve preserves explicit coverage without consuming every zone slot', () => {
    const story = [
        '她推开院门走进庭院。',
        '她握住木剑开始练习。',
        '师父纠正她的姿势。',
        '两人走进卧室。',
        '两名成年人慢慢脱下衣服。',
        '两名成年人发生性交。',
        '她们变换体位继续。',
        '两人达到高潮。',
        '事后她们相拥。',
        '清晨两人穿好衣服。',
        '她们走到湖边看日出。',
    ].join('\n\n');
    const fallback = buildFallbackShotsV4(story);
    const plan = selectShotsV4({ story, plannerShots: fallback, fallbackShots: [], minimum: 3, maximum: 5, requestedCount: 5 });
    assert.ok(plan.shots.some(shot => shot.nsfwLevel >= 2));
    assert.ok(plan.shots.some(shot => shot.paragraphIndex <= 2));
    assert.ok(plan.shots.some(shot => shot.paragraphIndex >= 9));
    assert.ok(plan.diagnostics.adultReserveQuota <= 3);
});
