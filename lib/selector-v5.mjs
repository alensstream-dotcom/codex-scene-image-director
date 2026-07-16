import { nsfwLevelForV5, splitStoryWithSpans, stageForV5 } from './director-v5.mjs';

const STRONG_ACTION_RE = /(?:握住.*手|手.*覆.*手|纠正.*姿势|挥剑|劈开|烹鱼|做鱼|递给|喂|拥抱|抱住|亲吻|接吻|脱下|裸体|性交|口交|手交|高潮|hand over hand|sword|cook|feed|embrace|kiss|undress|intercourse|oral sex|handjob|climax)/i;
const RELATION_RE = /(?:握住.*手|手.*覆.*手|抱住|搂住|亲吻|接吻|依偎|靠在|压住|跨坐|喂|扶住|牵手|hand over hand|embrace|kiss|straddl|feed|hold hands)/i;
const TRANSITION_ONLY_RE = /^(?:.{0,12})?(?:走进|来到|离开|回到|进入|推开门|走到|沿着).{0,24}$/i;
const VISUAL_RE = /(?:走|跑|坐|站|跪|躺|推|拉|抱|搂|吻|抓|握|拔|挥|劈|刺|练|舞|跳|凑|回头|转身|探头|开门|关门|递|喂|抚|摸|按|脱|穿|进入|抽动|高潮|弹琴|抚琴|举剑|出剑|剑招|步法|微笑|流泪|脸红|颤抖|做饭|做鱼|烹鱼|烹饪|下厨|walk|run|sit|stand|kneel|lie|push|pull|embrace|kiss|grab|hold|draw|swing|stab|turn|peek|open|feed|touch|undress|penetrat|climax|play|cook)/i;

function clean(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function tokenSet(value = '') {
    return new Set(clean(value).toLowerCase().split(/[^a-z0-9\u3400-\u9fff]+/).filter(token => token.length >= 2));
}

function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    for (const token of a) if (b.has(token)) intersection++;
    return intersection / (a.size + b.size - intersection);
}

function baseScore(shot) {
    const text = `${shot.paragraph || ''} ${shot.action || ''}`;
    let score = Number(shot.importance || 0);
    if (shot.source === 'director') score += 34;
    if (shot.mustDraw) score += 42;
    score += Number(shot.nsfwLevel || 0) * 36;
    if (STRONG_ACTION_RE.test(text)) score += 26;
    if (RELATION_RE.test(text)) score += 18;
    if (VISUAL_RE.test(text)) score += 10;
    if (TRANSITION_ONLY_RE.test(clean(shot.paragraph))) score -= 24;
    if (/generic portrait|standing pose|looking at viewer/i.test(text)) score -= 50;
    return score;
}

function similarity(a, b, paragraphCount) {
    let value = 0;
    if (a.sceneBlock === b.sceneBlock) value += 0.75;
    if (a.stage === b.stage) value += 0.18;
    value += jaccard(tokenSet(`${a.action} ${a.paragraph}`), tokenSet(`${b.action} ${b.paragraph}`)) * 0.7;
    const distance = Math.abs(a.paragraphIndex - b.paragraphIndex) / Math.max(1, paragraphCount - 1);
    if (distance < 0.08) value += 0.5;
    else if (distance < 0.18) value += 0.25;
    return Math.min(1.5, value);
}

function desiredCount(story = '', requested = 3, minimum = 3, maximum = 5) {
    const paragraphs = splitStoryWithSpans(story);
    const strong = paragraphs.filter(item => STRONG_ACTION_RE.test(item.text) || RELATION_RE.test(item.text)).length;
    const adultStages = new Set(paragraphs.filter(item => nsfwLevelForV5(item.text) > 0).map(item => stageForV5(item.text)));
    let count = Math.max(minimum, Math.min(maximum, Number(requested) || minimum));
    if (strong >= 5 || adultStages.size >= 2 || story.length >= 1000) count = Math.max(count, 4);
    if (strong >= 9 || adultStages.size >= 4 || story.length >= 1800) count = maximum;
    return count;
}

function adultStages(story = '') {
    const weights = { penetration: 180, position_change: 170, climax: 165, oral: 160, manual: 150, undressing: 125, aftercare: 100, kiss: 70, embrace: 60 };
    const seen = new Set();
    return splitStoryWithSpans(story)
        .map(paragraph => ({ paragraphIndex: paragraph.index, stage: stageForV5(paragraph.text), nsfwLevel: nsfwLevelForV5(paragraph.text) }))
        .filter(item => item.nsfwLevel > 0)
        .filter(item => {
            const key = `${item.nsfwLevel >= 2 ? 'explicit' : 'intimate'}:${item.stage}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => (b.nsfwLevel * 1000 + (weights[b.stage] || 0) + b.paragraphIndex) - (a.nsfwLevel * 1000 + (weights[a.stage] || 0) + a.paragraphIndex));
}

export function selectShotsV5({ story = '', directorShots = [], fallbackShots = [], minimum = 3, maximum = 5, requestedCount = 3 } = {}) {
    const paragraphs = splitStoryWithSpans(story);
    const paragraphCount = paragraphs.length;
    const desired = desiredCount(story, requestedCount, minimum, maximum);
    const candidates = [...directorShots, ...fallbackShots]
        .sort((a, b) => (b.source === 'director') - (a.source === 'director') || baseScore(b) - baseScore(a))
        .filter((shot, index, all) => all.findIndex(other => other.paragraphIndex === shot.paragraphIndex && other.stage === shot.stage) === index);
    const selected = [];
    const usedIds = new Set();
    const add = shot => {
        if (!shot || usedIds.has(shot.id) || selected.some(item => item.paragraphIndex === shot.paragraphIndex) || selected.length >= maximum) return false;
        selected.push(shot);
        usedIds.add(shot.id);
        return true;
    };

    const required = adultStages(story);
    const adultQuota = required.length === 0 ? 0 : desired >= 5 && required.length >= 3 ? 3 : desired >= 4 && required.length >= 2 ? 2 : 1;
    for (const stage of required.slice(0, adultQuota)) {
        const candidate = candidates
            .filter(shot => shot.stage === stage.stage || shot.paragraphIndex === stage.paragraphIndex)
            .sort((a, b) => baseScore(b) - baseScore(a))[0];
        add(candidate);
    }

    while (selected.length < desired) {
        const selectedAdult = selected.filter(item => item.nsfwLevel > 0).length;
        let best = null;
        let bestValue = -Infinity;
        for (const candidate of candidates) {
            if (usedIds.has(candidate.id) || selected.some(item => item.paragraphIndex === candidate.paragraphIndex)) continue;
            const maxSimilarity = selected.length ? Math.max(...selected.map(item => similarity(candidate, item, paragraphCount))) : 0;
            const minDistance = selected.length
                ? Math.min(...selected.map(item => Math.abs(item.paragraphIndex - candidate.paragraphIndex))) / Math.max(1, paragraphCount - 1)
                : 1;
            const spreadBonus = minDistance * 34;
            const adultSaturationPenalty = candidate.nsfwLevel > 0 && selectedAdult >= adultQuota ? 95 : 0;
            const value = baseScore(candidate) + spreadBonus - maxSimilarity * 72 - adultSaturationPenalty;
            if (value > bestValue) {
                best = candidate;
                bestValue = value;
            }
        }
        if (!add(best)) break;
    }

    return {
        desired,
        shots: selected.sort((a, b) => a.paragraphIndex - b.paragraphIndex),
        diagnostics: {
            directorCount: directorShots.length,
            fallbackCount: fallbackShots.length,
            adultQuota,
            adultStages: required,
            selected: selected.map(shot => ({ paragraphIndex: shot.paragraphIndex, score: baseScore(shot), stage: shot.stage, source: shot.source })),
        },
    };
}
