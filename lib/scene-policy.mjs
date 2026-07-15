const NSFW_RE = /(?:nsfw|explicit|性交|做爱|插入|进入她|口交|手交|裸体|全裸|高潮|射精|乳房|阴道|阴茎|penetrat|oral sex|handjob|nude|orgasm|climax|cum)/i;
const INTIMATE_RE = /(?:亲吻|接吻|拥抱|抚摸|爱抚|脱下|解开|暧昧|喘息|kiss|embrace|caress|undress|intimate|erotic)/i;
const ACTION_RE = /(?:推|拉|抱|吻|抓|握|坐|跪|跑|跳|转身|回头|探头|开门|关门|递|喂|脱|进入|抽动|高潮|push|pull|hold|kiss|grab|sit|kneel|run|jump|turn|peek|open|feed|undress|penetrat|climax)/i;
const CHANGE_RE = /(?:换上|换下|脱下|穿上|走进|来到|离开|转场|门外|房间|浴室|卧室|教室|街道|夜晚|清晨|outfit change|changed clothes|entered|arrived|left|bedroom|bathroom|classroom|street|night)/i;
const MINOR_RE = /(?:未成年|小学生|初中生|幼女|萝莉|儿童|child|minor|underage|loli|\b(?:[0-9]|1[0-7])\s*(?:岁|years? old|yo)\b)/i;

export const DEFAULT_FIXED_POSITIVE = 'masterpiece, best quality, score_7, highres, newest, anime illustration, visual novel event CG, clean lineart, detailed eyes, detailed clothing, natural pose, detailed background';
export const DEFAULT_FIXED_NEGATIVE = 'worst quality, low quality, score_1, score_2, score_3, blurry, lowres, bad anatomy, bad hands, extra fingers, missing fingers, fused bodies, duplicated person, merged people, cloned face, wrong face, different face, wrong hair color, wrong eye color, wrong clothes, multiple views, split screen, comic panel, collage, frame, white border, large empty border, tiny subject, text, logo, signature, watermark, artist name, jpeg artifacts';

function uniqueTags(values) {
    const seen = new Set();
    const result = [];
    for (const raw of values.flatMap(value => String(value || '').split(/[,，]\s*/))) {
        const tag = raw.trim();
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        result.push(tag);
    }
    return result;
}

export function desiredShotCount(story = '', { minimum = 3, maximum = 5 } = {}) {
    const text = String(story || '');
    const paragraphs = text.split(/\n\s*\n+/).map(value => value.trim()).filter(value => value.length >= 12);
    const explicitHits = (text.match(new RegExp(NSFW_RE.source, 'gi')) || []).length;
    const intimateHits = (text.match(new RegExp(INTIMATE_RE.source, 'gi')) || []).length;
    const changes = (text.match(new RegExp(CHANGE_RE.source, 'gi')) || []).length;
    let count = minimum;
    if (paragraphs.length >= 7 || text.length >= 1000 || changes >= 2 || intimateHits >= 2) count = 4;
    if (paragraphs.length >= 11 || text.length >= 1700 || explicitHits >= 2 || (explicitHits >= 1 && changes >= 2)) count = 5;
    return Math.max(minimum, Math.min(maximum, count));
}

export function packetPriority(packet = {}, index = 0, total = 1) {
    const evidence = [packet.quote, packet.action, packet.setting, packet.expression, packet.stage, packet.safety].join(' ');
    const safety = String(packet.safety || '').toLowerCase();
    let score = 0;
    if (safety === 'explicit' || NSFW_RE.test(evidence)) score += 120;
    else if (safety === 'nsfw' || INTIMATE_RE.test(evidence)) score += 70;
    if (ACTION_RE.test(evidence)) score += 25;
    if (CHANGE_RE.test(evidence)) score += 18;
    if (/(?:outfit|dress|uniform|lingerie|nude|clothes|服装|衣服|裙|制服|内衣|裸体)/i.test(evidence)) score += 15;
    if (/(?:door|bed|sofa|desk|bathroom|bedroom|classroom|street|门|床|沙发|书桌|浴室|卧室|教室|街道)/i.test(evidence)) score += 8;
    score += total > 1 ? (index / (total - 1)) * 12 : 0;
    return score;
}

export function selectPacketsAdaptive(packets = [], story = '', maximum = 5) {
    const desired = desiredShotCount(story, { minimum: 3, maximum });
    const scored = packets.map((packet, index, all) => ({ packet, index, score: packetPriority(packet, index, all.length) }));
    scored.sort((a, b) => b.score - a.score || b.index - a.index);
    const selected = [];
    const stages = new Set();
    for (const item of scored) {
        const stage = String(item.packet?.stage || 'story_action').toLowerCase();
        const safety = String(item.packet?.safety || '').toLowerCase();
        const critical = safety === 'explicit' || safety === 'nsfw' || NSFW_RE.test(`${item.packet?.quote} ${item.packet?.action}`);
        if (!critical && stages.has(stage)) continue;
        selected.push(item);
        stages.add(stage);
        if (selected.length >= desired) break;
    }
    if (selected.length < desired) {
        for (const item of scored) {
            if (selected.includes(item)) continue;
            selected.push(item);
            if (selected.length >= desired) break;
        }
    }
    return selected.sort((a, b) => a.index - b.index).map(item => item.packet);
}

export function adultSceneAllowed(packet = {}, context = '') {
    if (!['nsfw', 'explicit'].includes(String(packet.safety || '').toLowerCase())) return true;
    const evidence = `${context} ${(packet.cast || []).map(item => `${item.id} ${item.dna}`).join(' ')}`;
    if (MINOR_RE.test(evidence)) return false;
    return /(?:adult|woman|women|wife|girlfriend|teacher|mother|成年|成人|女人|女性|妻子|女友|老师|母亲)/i.test(evidence)
        || (packet.cast || []).length > 0;
}

export function cleanCompiledPrompt(compiled = {}, packet = {}, {
    fixedPositive = DEFAULT_FIXED_POSITIVE,
    fixedNegative = DEFAULT_FIXED_NEGATIVE,
} = {}) {
    const positiveParts = uniqueTags([compiled.positive]);
    const cleaned = positiveParts.filter(tag => {
        if (/[\u3400-\u9fff\uf900-\ufaff]/.test(tag)) return false;
        if (/^(?:story evidence|original story action|identity reference|current outfit)\s*:/i.test(tag)) return false;
        return true;
    });
    const people = String(packet.people || '').trim();
    const safety = String(packet.safety || 'safe').trim();
    const positive = uniqueTags([
        fixedPositive,
        safety,
        people,
        cleaned,
        packet.composition,
    ]).join(', ');
    const negative = uniqueTags([fixedNegative, compiled.negative]).join(', ');
    return { ...compiled, positive: positive.slice(0, 1800), negative: negative.slice(0, 1800) };
}
