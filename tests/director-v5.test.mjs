import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildFallbackCandidatesV5,
    buildStateTimeline,
    composePromptV5,
    makeAnchorSpec,
    nsfwLevelForV5,
    parseDirectorResponse,
    parseStateResponse,
    selectShotsV5,
    splitStoryWithSpans,
} from '../lib/director-v5.mjs';
import { canonicalText } from '../lib/dom-anchor-v5.mjs';

test('paragraph spans preserve exact source position and contexts', () => {
    const story = '第一段。\n\n青青穿着浅青色汉服走进庭院。\n\n她举起木剑。';
    const paragraphs = splitStoryWithSpans(story);
    assert.equal(paragraphs.length, 3);
    assert.equal(story.slice(paragraphs[1].start, paragraphs[1].end), '青青穿着浅青色汉服走进庭院。');
    const anchor = makeAnchorSpec(paragraphs[1]);
    assert.equal(anchor.quote, '青青穿着浅青色汉服走进庭院。');
    assert.match(anchor.before, /第一段/);
    assert.match(anchor.after, /她举起木剑/);
});

test('render canonicalization normalizes whitespace and Chinese quotes', () => {
    assert.equal(canonicalText('  她说：“你好”\n然后离开。 '), '她说："你好" 然后离开。');
});

test('state extractor accepts only evidence-backed outfit changes and carries outfit forward', () => {
    const story = [
        '青青穿着浅青色交领汉服，腰间系白色丝带。',
        '她在庭院里练习木剑。',
        '她走进厨房开始烹鱼。',
        '她换上白色寝衣，回到卧室。',
        '她坐在床边。',
    ].join('\n\n');
    const raw = JSON.stringify({
        characters: [{ name: '青青', identity: 'adult woman, long brown hair, green eyes', default_outfit: 'pale blue hanfu, white sash' }],
        events: [
            { paragraph_index: 0, characters_present: ['青青'], location: '', location_evidence: '', outfit_updates: [{ name: '青青', outfit: 'pale blue crossed-collar hanfu, white sash', evidence: '穿着浅青色交领汉服，腰间系白色丝带' }], stage: 'story_action', nsfw_level: 0 },
            { paragraph_index: 1, characters_present: ['青青'], location: 'traditional Chinese courtyard', location_evidence: '庭院', outfit_updates: [], stage: 'sword_action', nsfw_level: 0 },
            { paragraph_index: 2, characters_present: ['青青'], location: 'traditional kitchen', location_evidence: '厨房', outfit_updates: [{ name: '青青', outfit: 'school uniform', evidence: '开始烹鱼' }], stage: 'cooking', nsfw_level: 0 },
            { paragraph_index: 3, characters_present: ['青青'], location: 'bedroom', location_evidence: '卧室', outfit_updates: [{ name: '青青', outfit: 'white sleeping robe', evidence: '换上白色寝衣' }], stage: 'outfit_change', nsfw_level: 0 },
        ],
    });
    const parsed = parseStateResponse(raw, story);
    const timeline = buildStateTimeline(story, parsed, {});
    assert.equal(timeline.states[1].characters[0].outfit, 'pale blue crossed-collar hanfu, white sash');
    assert.equal(timeline.states[2].characters[0].outfit, 'pale blue crossed-collar hanfu, white sash');
    assert.equal(timeline.states[4].characters[0].outfit, 'white sleeping robe');
    assert.doesNotMatch(timeline.states[2].characters[0].outfit, /school uniform/i);
});

test('director cannot override frozen outfit or location', () => {
    const story = '青青穿着白色汉服在庭院中练剑。';
    const parsedState = parseStateResponse(JSON.stringify({
        characters: [{ name: '青青', identity: 'adult woman, long black hair, golden eyes', default_outfit: 'white hanfu' }],
        events: [{ paragraph_index: 0, characters_present: ['青青'], location: 'traditional Chinese courtyard', location_evidence: '庭院', outfit_updates: [{ name: '青青', outfit: 'white hanfu', evidence: '穿着白色汉服' }], stage: 'sword_action', nsfw_level: 0 }],
    }), story);
    const timeline = buildStateTimeline(story, parsedState, {});
    const director = parseDirectorResponse(JSON.stringify({
        target_count: 3,
        candidates: [{ id: 'c1', paragraph_index: 0, scene_block: 'training', importance: 95, reason: 'clear action', stage: 'sword_action', nsfw_level: 0, must_draw: true, action: 'woman practicing swordsmanship, wooden sword in hand', expression: 'focused expression', camera: 'medium full-body shot, dynamic angle', atmosphere: 'warm afternoon light, falling leaves' }],
    }), story, timeline);
    const prompt = composePromptV5(director.shots[0], { fixedPositive: 'masterpiece, school uniform', fixedNegative: 'bad hands' });
    assert.match(prompt.positive, /white hanfu/i);
    assert.match(prompt.positive, /traditional Chinese courtyard/i);
    assert.doesNotMatch(prompt.positive, /school uniform/i);
    assert.match(prompt.negative, /school uniform/i);
});

test('explicit text cannot be downgraded by director request', () => {
    assert.equal(nsfwLevelForV5('两名成年人发生性交并达到高潮', 0), 3);
    assert.equal(nsfwLevelForV5('成年女子慢慢脱下衣服', 0), 2);
    assert.equal(nsfwLevelForV5('两个成年人接吻', 0), 1);
});

test('MMR selection keeps strong distant moments without duplicate paragraphs', () => {
    const story = [
        '她推开院门。',
        '她在院里普通地说了几句话。',
        '师父从背后握住她的手纠正木剑角度。',
        '她重新挥剑，剑风卷起落叶。',
        '两人进入厨房。',
        '她认真烹鱼，把鱼汤递给师父。',
        '两人继续普通对话。',
        '夜里她们走到湖心亭。',
        '师父在月光下拥抱她。',
    ].join('\n\n');
    const state = buildStateTimeline(story, { characters: [{ name: '她', identity: 'adult woman', defaultOutfit: 'blue hanfu' }], events: [] }, {});
    const fallback = buildFallbackCandidatesV5(story, state);
    const plan = selectShotsV5({ story, directorShots: fallback, fallbackShots: [], minimum: 3, maximum: 5, requestedCount: 3 });
    const indexes = plan.shots.map(shot => shot.paragraphIndex);
    assert.ok(indexes.includes(2) || indexes.includes(3));
    assert.ok(indexes.includes(8));
    assert.ok(indexes.some(index => index >= 4 && index <= 7));
    assert.equal(new Set(indexes).size, indexes.length);
});

test('adult quota preserves explicit stage without requiring rigid early-middle-late slots', () => {
    const story = [
        '她在庭院练剑。',
        '她挥剑劈开落叶。',
        '两人回到卧室。',
        '两名成年人慢慢脱下衣服。',
        '两名成年人发生性交。',
        '两人达到高潮。',
        '清晨她穿好汉服。',
        '她走到湖边看日出。',
    ].join('\n\n');
    const timeline = buildStateTimeline(story, { characters: [], events: [] }, {});
    const fallback = buildFallbackCandidatesV5(story, timeline);
    const plan = selectShotsV5({ story, directorShots: fallback, fallbackShots: [], minimum: 3, maximum: 5, requestedCount: 4 });
    assert.ok(plan.shots.some(shot => shot.nsfwLevel >= 2));
    assert.ok(plan.shots.some(shot => shot.paragraphIndex >= 6));
    assert.ok(plan.shots.some(shot => shot.nsfwLevel === 0));
    assert.ok(plan.diagnostics.adultQuota <= 3);
});
