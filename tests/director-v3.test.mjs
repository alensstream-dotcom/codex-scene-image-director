import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDirectorV3Contract,
    buildFallbackShotsV3,
    composeV3Prompt,
    desiredShotCountV3,
    parseV3Storyboard,
    selectStoryboardV3,
    stripV3Protocol,
} from '../lib/director-v3.mjs';

function block(shots) {
    return `<!--JANIMA_V3:${JSON.stringify({ version: 3, shot_count: shots.length, shots })}-->`;
}

const richPrompt = '2girls, adult female master with black hair, adult female disciple with brown hair, white hanfu, blue training robe, master standing behind disciple, hand over hand sword guidance, both hands gripping the same wooden sword, traditional Chinese courtyard, focused expressions, upper body medium shot, warm afternoon sunlight';

test('parses one final V3 storyboard with direct English prompts', () => {
    const story = '师父站到青青身后，握住她的手腕。\n\n她的手覆在青青手背上，一点点纠正木剑的角度。\n\n青青重新挥出一剑，剑风掠过院中的落叶。';
    const text = `${story}\n${block([{
        id: 's1',
        anchor: '她的手覆在青青手背上，一点点纠正木剑的角度。',
        priority: 98,
        type: 'teaching_interaction',
        safety: 'safe',
        must_draw: true,
        prompt: richPrompt,
        negative: 'western uniform, modern weapon, empty hands',
        continuity: { characters: ['师父', '青青'], outfit: 'white hanfu, blue training robe', location: 'traditional Chinese courtyard' },
    }])}`;
    const parsed = parseV3Storyboard(text, story);
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.shots.length, 1);
    assert.equal(parsed.shots[0].paragraphIndex, 1);
    assert.equal(parsed.shots[0].source, 'model');
    assert.match(parsed.shots[0].prompt, /hand over hand sword guidance/);
    assert.doesNotMatch(parsed.shots[0].prompt, /她的手/);
    assert.equal(stripV3Protocol(text), story);
});

test('rejects hallucinated anchors and Chinese image prompts', () => {
    const story = '她在庭院中练剑。';
    const text = `${story}\n${block([
        {
            id: 'bad-anchor', anchor: '她在西式宫殿里穿着红军装。', priority: 90, type: 'portrait', safety: 'safe',
            prompt: richPrompt, negative: '', continuity: {},
        },
        {
            id: 'bad-prompt', anchor: '她在庭院中练剑。', priority: 90, type: 'sword_action', safety: 'safe',
            prompt: '一个女孩，在庭院练剑，阳光很好，画面精美', negative: '', continuity: {},
        },
    ])}`;
    const parsed = parseV3Storyboard(text, story);
    assert.equal(parsed.shots.length, 0);
    assert.equal(parsed.errors.length, 2);
});

test('uses adaptive 3-5 count and reserves later explicit stages', () => {
    const story = [
        '她们在院中谈论剑法。',
        '师姐带她走进卧室。',
        '两名成年女子亲吻。',
        '师姐慢慢脱下彼此的衣物。',
        '两名成年女子进行口交。',
        '她们变换体位继续做爱。',
        '两人同时达到高潮。',
        '事后她们依偎在床上。',
        '清晨的光落在被褥上。',
        '她替师妹重新披上外衣。',
        '两人离开卧室。',
    ].join('\n\n');
    assert.equal(desiredShotCountV3(story, { minimum: 3, maximum: 5 }), 5);
    const safe = [0, 1, 8, 9, 10].map((paragraphIndex, index) => ({
        id: `safe-${index}`,
        anchor: story.split(/\n\n/)[paragraphIndex],
        paragraph: story.split(/\n\n/)[paragraphIndex],
        paragraphIndex,
        priority: 95 - index,
        type: index === 0 ? 'talk' : 'location_change',
        safety: 'safe',
        mustDraw: false,
        prompt: '2girls, adult women, hanfu, visible interaction, traditional bedroom, medium shot, detailed environment, warm light',
        negative: '', continuity: {}, source: 'model',
    }));
    const fallback = buildFallbackShotsV3(story, { maximum: 5 });
    const plan = selectStoryboardV3({ story, modelShots: safe, fallbackShots: fallback, minimum: 3, maximum: 5 });
    assert.equal(plan.shots.length, 5);
    assert.ok(plan.shots.some(shot => shot.type === 'undressing'));
    assert.ok(plan.shots.some(shot => ['oral', 'position_change', 'penetration'].includes(shot.type)));
    assert.ok(plan.shots.some(shot => shot.type === 'climax'));
    assert.ok(plan.shots.some(shot => shot.type === 'aftercare'));
});

test('fallback directly describes high-value story actions instead of generic portraits', () => {
    const story = '师父走到青青身后。\n\n她的手覆在青青手背上，纠正木剑的角度。\n\n随后她们来到厨房，青青认真烹鱼。\n\n傍晚两人走到湖边寻找师姐。';
    const shots = buildFallbackShotsV3(story, { maximum: 5 });
    const teaching = shots.find(shot => /hand over hand sword guidance/.test(shot.prompt));
    const kitchen = shots.find(shot => /cooking fish/.test(shot.prompt));
    assert.ok(teaching, 'teaching interaction should be selected');
    assert.ok(kitchen, 'cooking action should be selected');
    assert.doesNotMatch(teaching.prompt, /generic portrait/);
});

test('fixed prompts are prepended without rebuilding the scene', () => {
    const shot = {
        safety: 'safe',
        prompt: richPrompt,
        negative: 'western uniform, empty hands',
        continuity: { outfit: 'white hanfu, blue training robe', location: 'traditional Chinese courtyard' },
    };
    const compiled = composeV3Prompt(shot, {
        fixedPositive: 'masterpiece, best quality',
        fixedNegative: 'bad anatomy, bad hands',
    });
    assert.match(compiled.positive, /^masterpiece, best quality/);
    assert.match(compiled.positive, /hand over hand sword guidance/);
    assert.match(compiled.negative, /bad hands/);
    assert.match(compiled.negative, /western uniform/);
});

test('director contract requires one final block and hard adult coverage', () => {
    const contract = buildDirectorV3Contract({ minimum: 3, maximum: 5, card: { name: '青青', visual: 'adult woman, brown hair' } });
    assert.match(contract, /exactly ONE final single-line HTML comment/);
    assert.match(contract, /at least one NSFW\/explicit shot MUST be present/);
    assert.match(contract, /do not first split the scene into action\/setting\/expression fields/i);
    assert.match(contract, /Active card: 青青/);
});
