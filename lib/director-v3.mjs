import { splitStoryParagraphs } from './scene-anchor.mjs';

const STORYBOARD_RE = /<!--\s*JANIMA_V3\s*:\s*([\s\S]*?)\s*-->/gi;
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const FEMALE_RE = /(?:她|夫人|小姐|姑娘|姐姐|妹妹|女子|女人|少女|女主|女友|妻子|母亲|公主|女王|女仆|师姐|师妹|师父|woman|women|girl|girls|heroine|wife|girlfriend|lady|female)/i;
const MALE_RE = /(?:他|男子|男人|男主|丈夫|男友|公子|少年|man|men|boy|boys|husband|boyfriend|male)/i;
const MINOR_RE = /(?:未成年|小学生|初中生|幼女|萝莉|儿童|child|minor|underage|loli|\b(?:[0-9]|1[0-7])\s*(?:岁|years? old|yo)\b)/i;
const VISUAL_RE = /(?:走|跑|坐|站|跪|躺|推|拉|抱|搂|吻|抓|握|拔|挥|劈|刺|练|舞|跳|凑|回头|转身|探头|开门|关门|递|喂|抚|摸|按|脱|穿|进入|抽动|高潮|弹琴|抚琴|举剑|出剑|剑招|步法|微笑|流泪|脸红|颤抖|walk|run|sit|stand|kneel|lie|push|pull|embrace|kiss|grab|hold|draw|swing|stab|turn|peek|open|feed|touch|undress|penetrat|climax|play)/i;
const CHANGE_RE = /(?:换上|换下|脱下|穿上|走进|来到|离开|转场|房间|卧室|浴室|教室|街道|庭院|亭|湖边|树林|竹林|夜晚|清晨|changed clothes|entered|arrived|left|bedroom|bathroom|classroom|street|courtyard|pavilion|lakeside|forest|night|morning)/i;
const INTIMATE_RE = /(?:亲吻|接吻|拥抱|抚摸|爱抚|脱下|解开|暧昧|喘息|赤裸|kiss|embrace|caress|undress|intimate|erotic|naked)/i;
const EXPLICIT_RE = /(?:性交|做爱|性行为|插入|进入她|口交|手交|裸体|全裸|高潮|射精|阴道|阴茎|乳房|乳头|骑乘|后入|penetrat|intercourse|oral sex|handjob|nude|orgasm|climax|cum|cowgirl|doggystyle)/i;

export const DEFAULT_V3_POSITIVE = 'masterpiece, best quality, score_7, highres, newest, anime illustration, visual novel event CG, clean lineart, detailed eyes, detailed face, detailed clothing, coherent anatomy, coherent hands, cinematic composition, expressive pose, detailed environment';
export const DEFAULT_V3_NEGATIVE = 'worst quality, low quality, score_1, score_2, score_3, blurry, lowres, bad anatomy, bad hands, extra fingers, missing fingers, fused fingers, extra limbs, malformed limbs, fused bodies, duplicated person, cloned face, wrong face, different face, wrong hair color, wrong eye color, wrong clothes, inconsistent outfit, unrelated character, unrelated scene, generic portrait, empty pose, multiple views, split screen, comic panel, collage, white border, large empty border, tiny subject, cropped head, text, logo, signature, watermark, artist name, jpeg artifacts';

function clean(value = '', maximum = 2200) {
    return String(value || '').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function clamp(value, minimum, maximum, fallback = minimum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function uniqueTags(values) {
    const result = [];
    const seen = new Set();
    for (const raw of values.flatMap(value => String(value || '').split(/[,，]\s*/))) {
        const tag = clean(raw, 260);
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        result.push(tag);
    }
    return result;
}

function englishTags(value = '') {
    return uniqueTags([value]).filter(tag => !CJK_RE.test(tag) && /[a-z]/i.test(tag));
}

function normalizedAnchor(value = '') {
    return clean(value, 900).replace(/[“”「」『』]/g, '"').replace(/\s+/g, ' ').trim();
}

function safetyFor(text = '', requested = '') {
    const value = String(requested || '').toLowerCase();
    if (value === 'explicit' || EXPLICIT_RE.test(text)) return 'explicit';
    if (value === 'nsfw' || INTIMATE_RE.test(text)) return 'nsfw';
    if (value === 'sensitive') return 'sensitive';
    return 'safe';
}

export function stageForV3(text = '', requested = '') {
    const stage = clean(requested, 80).toLowerCase();
    if (stage && !['story', 'scene', 'story_action', 'unknown'].includes(stage)) return stage;
    if (/事后|余韵|依偎|aftercare/i.test(text)) return 'aftercare';
    if (/高潮|射精|orgasm|climax|cum/i.test(text)) return 'climax';
    if (/骑乘|跨坐|cowgirl|后入|doggystyle|体位/i.test(text)) return 'position_change';
    if (/插入|进入她|性交|做爱|性行为|penetrat|intercourse/i.test(text)) return 'penetration';
    if (/口交|oral sex/i.test(text)) return 'oral';
    if (/手交|handjob/i.test(text)) return 'manual';
    if (/脱下|解开|裸体|赤裸|undress|nude|naked/i.test(text)) return 'undressing';
    if (/亲吻|接吻|kiss/i.test(text)) return 'kiss';
    if (/拥抱|抱紧|搂住|embrace|hug/i.test(text)) return 'embrace';
    if (/抚琴|弹琴|琴弦|古琴|guqin|zither/i.test(text)) return 'music';
    if (/木剑|真剑|拔剑|挥剑|剑招|练剑|sword/i.test(text)) return 'sword_action';
    if (/走进|来到|离开|entered|arrived|left/i.test(text)) return 'location_change';
    if (/换上|换下|穿上|changed clothes|outfit/i.test(text)) return 'outfit_change';
    return 'story_action';
}

function peopleFor(text = '') {
    const female = FEMALE_RE.test(text);
    const male = MALE_RE.test(text);
    const twoWomen = /(?:她们|两名女子|两个女人|二女|姐妹|师姐妹|2girls|two women|two girls)/i.test(text);
    if (twoWomen && male) return '2girls, 1boy';
    if (twoWomen) return '2girls';
    if (female && male) return '1girl, 1boy';
    return '1girl';
}

function styleTags(text = '') {
    if (/(?:古代|江湖|武林|修仙|仙门|师姐|师妹|夫人|公子|小姐|木剑|真剑|剑法|古琴|亭|竹林|hanfu|wuxia|ancient china|xianxia)/i.test(text)) {
        return ['ancient Chinese fantasy', 'xianxia', 'hanfu', 'traditional Chinese environment'];
    }
    if (/(?:教室|学校|校服|classroom|school)/i.test(text)) return ['modern school setting'];
    if (/(?:办公室|都市|手机|汽车|office|city|smartphone|car)/i.test(text)) return ['modern setting'];
    return ['visual novel scene'];
}

function actionTags(text = '', stage = '') {
    const tags = [];
    const add = (pattern, value) => { if (pattern.test(text)) tags.push(value); };
    add(/纠正.*(?:握剑|姿势)|手.*覆.*手|握住.*手.*剑|guiding.*hand/i, 'female master guiding her disciple hand over hand, both hands holding the same wooden sword, close teaching interaction');
    add(/木剑|练剑|剑招|步法|挥剑|sword practice|wooden sword/i, 'woman practicing swordsmanship, wooden sword in hand, visible sword stance');
    add(/真剑|剑身|剑鞘|拔出.*剑|draw.*sword/i, 'woman drawing a real Chinese sword from its scabbard, reflective blade');
    add(/抚琴|弹琴|琴弦|古琴|guqin|zither/i, 'woman seated and playing a guqin, both hands touching the strings');
    add(/做鱼|烹鱼|厨房|下厨|cook.*fish|kitchen/i, 'woman cooking fish in a traditional kitchen, food and cookware visible');
    add(/亲吻|接吻|kiss/i, 'adult lovers kissing, lips touching, visible mutual contact');
    add(/拥抱|抱紧|搂住|embrace|hug/i, 'adult lovers embracing, visible body contact');
    add(/牵手|拉着.*手|holding hands/i, 'holding hands, visible hand contact');
    add(/递|喂|feed|offer/i, 'handing an object to another character, visible interaction');
    add(/推开门|开门|door/i, 'opening a door');
    add(/探头|peek/i, 'peeking through a doorway');
    add(/回头|turn.*head/i, 'looking back over her shoulder');
    add(/跑|奔|冲|run/i, 'dynamic running motion');
    add(/脱下|解开|褪下|undress/i, 'clearly adult woman undressing, clothing visibly being removed');
    add(/全裸|裸体|赤裸|nude|naked/i, 'clearly adult nude woman');
    add(/抚摸|爱抚|caress|fondle/i, 'consensual adult intimate touching');
    add(/口交|oral sex/i, 'consensual adult oral sex');
    add(/手交|handjob/i, 'consensual adult handjob');
    add(/性交|做爱|性行为|插入|进入她|penetrat|intercourse/i, 'consensual adult intercourse, explicit penetration, clear body positioning');
    add(/骑乘|跨坐|cowgirl/i, 'adult woman straddling her partner, cowgirl position');
    add(/后入|doggystyle/i, 'consensual adult rear-entry position');
    add(/高潮|射精|orgasm|climax|cum/i, 'consensual adult sexual climax, flushed face, visible climax reaction');
    add(/事后|余韵|依偎|aftercare/i, 'adult lovers embracing during aftercare');
    if (!tags.length) {
        if (stage === 'location_change') tags.push('woman arriving in the newly established location, visible movement and environment');
        else tags.push('clear visible physical action from the selected story moment');
    }
    return tags;
}

function settingTags(text = '') {
    const tags = [];
    const add = (pattern, value) => { if (pattern.test(text)) tags.push(value); };
    add(/厨房|灶台|kitchen/i, 'traditional kitchen, stove, cookware and food visible');
    add(/房间|卧房|卧室|床榻|bedroom|room/i, 'inside a furnished bedroom');
    add(/书房|书桌|书架|study|bookshelf/i, 'traditional study room, desk and bookshelves');
    add(/庭院|院子|courtyard/i, 'traditional Chinese courtyard');
    add(/湖心亭|亭中|亭子|pavilion/i, 'lakeside Chinese pavilion');
    add(/湖边|湖面|lakeside|lake/i, 'beside a misty lake');
    add(/竹林|bamboo/i, 'bamboo grove');
    add(/树林|森林|forest/i, 'forest');
    add(/教室|classroom/i, 'classroom interior');
    add(/街道|街上|street/i, 'street');
    add(/夜|灯笼|moon|night/i, 'night lighting, warm lantern light');
    add(/清晨|morning|dawn/i, 'soft morning light');
    return tags.length ? tags : ['environment exactly matching the selected story paragraph'];
}

function expressionTags(text = '') {
    const tags = [];
    const add = (pattern, value) => { if (pattern.test(text)) tags.push(value); };
    add(/微笑|笑|smile/i, 'gentle smile');
    add(/脸红|羞|blush/i, 'blushing');
    add(/哭|眼泪|泪|tears|cry/i, 'tears in her eyes');
    add(/生气|怒|angry/i, 'angry expression');
    add(/紧张|害怕|fear|nervous/i, 'tense expression');
    add(/喘息|呻吟|pant|moan/i, 'flushed face, heavy breathing');
    return tags.length ? tags : ['expression matching the selected story moment'];
}

function compositionTags(text = '', safety = 'safe') {
    if (safety === 'explicit') return ['intimate medium close-up', 'all adult participants clearly visible', 'clear contact and body positioning', 'main action unobstructed'];
    if (safety === 'nsfw') return ['romantic medium close-up', 'both faces visible', 'clear physical interaction'];
    if (/剑|跑|冲|跃|fight|sword|run/i.test(text)) return ['dynamic full-body shot', 'clear limb positions', 'cinematic action composition'];
    if (/琴|坐|桌|亭|pavilion/i.test(text)) return ['medium shot', 'hands and important prop fully visible', 'balanced environmental composition'];
    return ['cinematic medium shot', 'main subjects large in frame', 'clear action and environment'];
}

function localNegative(text = '') {
    const tags = [];
    if (/(?:古代|江湖|武林|修仙|师姐|师妹|木剑|古琴|亭|竹林)/i.test(text)) {
        tags.push('western military uniform', 'red military coat', 'epaulettes', 'red cape', 'modern school uniform', 'futuristic armor', 'European palace interior');
    }
    if (/木剑|真剑|剑法|剑招/i.test(text)) tags.push('gun', 'modern weapon', 'empty hands');
    if (/抚琴|琴弦|古琴/i.test(text)) tags.push('piano', 'guitar', 'violin', 'empty hands');
    if (/厨房|做鱼|烹鱼/i.test(text)) tags.push('empty kitchen', 'no food', 'modern restaurant');
    return tags;
}

function promptQuality(prompt = '') {
    const tags = englishTags(prompt);
    let score = tags.length * 2;
    if (/(?:holding|touching|kissing|embracing|drawing|playing|cooking|running|sitting|kneeling|undressing|penetration|straddling|guiding)/i.test(prompt)) score += 25;
    if (/(?:courtyard|bedroom|kitchen|pavilion|lake|forest|classroom|street|room|environment)/i.test(prompt)) score += 12;
    if (/(?:medium shot|close-up|full-body|composition|lighting|foreground|background)/i.test(prompt)) score += 12;
    if (/generic portrait|standing pose|looking at viewer/i.test(prompt)) score -= 30;
    return score;
}

export function stripV3Protocol(text = '') {
    STORYBOARD_RE.lastIndex = 0;
    return String(text || '').replace(STORYBOARD_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

export function resolveV3Anchor(story = '', anchor = '') {
    const wanted = normalizedAnchor(anchor);
    const paragraphs = splitStoryParagraphs(story);
    if (!wanted || wanted.length < 4) return null;
    for (const paragraph of paragraphs) {
        const text = normalizedAnchor(paragraph.text);
        if (text.includes(wanted) || wanted.includes(text)) return { paragraphIndex: paragraph.index, paragraph: paragraph.text };
    }
    const fragments = [120, 88, 64, 42, 26, 16]
        .filter(length => wanted.length >= length)
        .flatMap(length => [wanted.slice(0, length), wanted.slice(-length)]);
    for (const fragment of fragments) {
        const found = paragraphs.find(paragraph => normalizedAnchor(paragraph.text).includes(fragment));
        if (found) return { paragraphIndex: found.index, paragraph: found.text };
    }
    return null;
}

function sanitizeContinuity(raw = {}) {
    return {
        characters: (Array.isArray(raw.characters) ? raw.characters : [])
            .map(value => clean(value, 160))
            .filter(Boolean)
            .slice(0, 4),
        outfit: clean(raw.outfit, 400),
        location: clean(raw.location, 300),
    };
}

function sanitizeShot(raw = {}, story = '', index = 0) {
    const anchor = clean(raw.anchor || raw.anchor_quote || raw.quote, 700);
    const resolved = resolveV3Anchor(story, anchor);
    if (!resolved) throw new Error(`shot ${index + 1}: anchor not found in visible story`);
    const rawPrompt = clean(raw.prompt || raw.visual_prompt, 2400);
    const prompt = englishTags(rawPrompt).join(', ');
    if (englishTags(prompt).length < 6 || promptQuality(prompt) < 20) throw new Error(`shot ${index + 1}: prompt is too generic or not English visual tags`);
    const evidence = `${resolved.paragraph} ${raw.type || ''} ${raw.safety || ''} ${rawPrompt}`;
    const safety = safetyFor(evidence, raw.safety);
    if (['nsfw', 'explicit'].includes(safety) && MINOR_RE.test(evidence)) throw new Error(`shot ${index + 1}: adult image contains minor evidence`);
    return {
        id: clean(raw.id || `shot_${index + 1}`, 80),
        anchor,
        paragraph: resolved.paragraph,
        paragraphIndex: resolved.paragraphIndex,
        priority: Math.round(clamp(raw.priority, 0, 100, 60)),
        type: stageForV3(evidence, raw.type || raw.scene_type || raw.stage),
        safety,
        mustDraw: Boolean(raw.must_draw ?? raw.mustDraw ?? ['nsfw', 'explicit'].includes(safety)),
        prompt,
        negative: englishTags(raw.negative).join(', '),
        continuity: sanitizeContinuity(raw.continuity),
        source: 'model',
    };
}

export function parseV3Storyboard(text = '', story = stripV3Protocol(text)) {
    const errors = [];
    const blocks = [];
    STORYBOARD_RE.lastIndex = 0;
    for (const match of String(text || '').matchAll(STORYBOARD_RE)) blocks.push(match[1]);
    if (!blocks.length) return { shots: [], errors: ['V3 storyboard block missing'], requestedCount: 0 };
    let raw;
    try {
        raw = JSON.parse(blocks.at(-1));
    } catch (error) {
        return { shots: [], errors: [`V3 storyboard JSON invalid: ${error?.message || error}`], requestedCount: 0 };
    }
    const sourceShots = Array.isArray(raw?.shots) ? raw.shots : [];
    const shots = [];
    const ids = new Set();
    for (const [index, item] of sourceShots.entries()) {
        try {
            const shot = sanitizeShot(item, story, index);
            if (ids.has(shot.id)) shot.id = `${shot.id}_${index + 1}`;
            ids.add(shot.id);
            shots.push(shot);
        } catch (error) {
            errors.push(String(error?.message || error));
        }
    }
    return {
        shots,
        errors,
        requestedCount: Math.round(clamp(raw?.shot_count ?? raw?.count, 0, 5, shots.length)),
    };
}

export function desiredShotCountV3(story = '', { minimum = 3, maximum = 5 } = {}) {
    const paragraphs = splitStoryParagraphs(story).filter(item => item.text.length >= 10);
    const text = paragraphs.map(item => item.text).join('\n');
    const explicitStages = new Set(paragraphs
        .map(item => stageForV3(item.text))
        .filter(stage => ['undressing', 'oral', 'manual', 'penetration', 'position_change', 'climax', 'aftercare'].includes(stage)));
    const changes = (text.match(new RegExp(CHANGE_RE.source, 'gi')) || []).length;
    let count = minimum;
    if (paragraphs.length >= 7 || text.length >= 950 || changes >= 2 || INTIMATE_RE.test(text)) count = 4;
    if (paragraphs.length >= 11 || text.length >= 1600 || explicitStages.size >= 2) count = 5;
    return Math.max(minimum, Math.min(maximum, count));
}

function candidateScore(shot = {}, totalParagraphs = 1) {
    let score = Number(shot.priority || 0);
    if (shot.source === 'model') score += 55;
    if (shot.mustDraw) score += 90;
    if (shot.safety === 'explicit') score += 180;
    else if (shot.safety === 'nsfw') score += 100;
    if (VISUAL_RE.test(`${shot.paragraph} ${shot.prompt}`)) score += 30;
    if (CHANGE_RE.test(`${shot.paragraph} ${shot.prompt}`)) score += 18;
    score += totalParagraphs > 1 ? (shot.paragraphIndex / (totalParagraphs - 1)) * 15 : 0;
    score += Math.min(30, promptQuality(shot.prompt) / 4);
    return score;
}

function makeLocalShot(paragraph, index, all) {
    const window = all.slice(Math.max(0, index - 2), index + 1).map(item => item.text).join(' ');
    const stage = stageForV3(window);
    const safety = safetyFor(window);
    const prompt = uniqueTags([
        peopleFor(window),
        safety,
        styleTags(window),
        actionTags(window, stage),
        settingTags(window),
        expressionTags(window),
        compositionTags(window, safety),
    ]).join(', ');
    let priority = 35;
    if (safety === 'explicit') priority = 98;
    else if (safety === 'nsfw') priority = 88;
    else if (VISUAL_RE.test(paragraph.text)) priority += 25;
    if (CHANGE_RE.test(window)) priority += 15;
    priority += all.length > 1 ? Math.round(index / (all.length - 1) * 10) : 0;
    return {
        id: `fallback_${index + 1}_${stableHashText(paragraph.text).toString(36)}`,
        anchor: paragraph.text,
        paragraph: paragraph.text,
        paragraphIndex: paragraph.index,
        priority: Math.min(100, priority),
        type: stage,
        safety,
        mustDraw: ['nsfw', 'explicit'].includes(safety),
        prompt,
        negative: uniqueTags(localNegative(window)).join(', '),
        continuity: { characters: [], outfit: '', location: settingTags(window)[0] || '' },
        source: 'fallback',
    };
}

function stableHashText(value = '') {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function buildFallbackShotsV3(story = '', { maximum = 5 } = {}) {
    const paragraphs = splitStoryParagraphs(story).filter(item => item.text.length >= 10);
    const storyHasFemale = FEMALE_RE.test(story);
    const candidates = paragraphs.map((paragraph, index, all) => {
        const shot = makeLocalShot(paragraph, index, all);
        let score = candidateScore(shot, all.length);
        if (!VISUAL_RE.test(paragraph.text) && shot.safety === 'safe') score -= 45;
        if (!(FEMALE_RE.test(all.slice(Math.max(0, index - 2), index + 1).map(item => item.text).join(' ')) || storyHasFemale)) score -= 100;
        return { shot, score };
    });
    return candidates
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || b.shot.paragraphIndex - a.shot.paragraphIndex)
        .slice(0, Math.max(1, maximum))
        .map(item => item.shot);
}

function dedupeShots(shots = []) {
    const result = [];
    const seen = new Set();
    for (const shot of shots) {
        const key = `${shot.paragraphIndex}:${shot.type}:${clean(shot.prompt, 180).toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(shot);
    }
    return result;
}

function criticalStoryStages(story = '') {
    const paragraphs = splitStoryParagraphs(story);
    const result = [];
    const seen = new Set();
    for (const paragraph of paragraphs) {
        const stage = stageForV3(paragraph.text);
        const safety = safetyFor(paragraph.text);
        if (!['nsfw', 'explicit'].includes(safety)) continue;
        const key = stage === 'story_action' ? `${stage}:${paragraph.index}` : stage;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ stage, safety, paragraphIndex: paragraph.index, paragraph: paragraph.text });
    }
    return result;
}

export function selectStoryboardV3({
    story = '',
    modelShots = [],
    fallbackShots = [],
    minimum = 3,
    maximum = 5,
} = {}) {
    const desired = desiredShotCountV3(story, { minimum, maximum });
    const paragraphs = splitStoryParagraphs(story);
    const candidates = dedupeShots([...modelShots, ...fallbackShots]);
    const selected = [];
    const selectedKeys = new Set();
    const add = shot => {
        if (!shot || selected.length >= maximum) return false;
        const key = `${shot.paragraphIndex}:${shot.type}:${shot.id}`;
        if (selectedKeys.has(key)) return false;
        selectedKeys.add(key);
        selected.push(shot);
        return true;
    };

    // Hard coverage: every distinct adult NSFW/explicit stage occupies a slot until the cap.
    for (const required of criticalStoryStages(story)) {
        const matching = candidates
            .filter(shot => shot.type === required.stage || shot.paragraphIndex === required.paragraphIndex)
            .sort((a, b) => candidateScore(b, paragraphs.length) - candidateScore(a, paragraphs.length));
        let candidate = matching[0];
        if (!candidate) {
            const paragraph = paragraphs.find(item => item.index === required.paragraphIndex);
            if (paragraph) candidate = makeLocalShot(paragraph, required.paragraphIndex, paragraphs);
        }
        add(candidate);
        if (selected.length >= maximum) break;
    }

    const ranked = candidates.sort((a, b) => candidateScore(b, paragraphs.length) - candidateScore(a, paragraphs.length));
    for (const shot of ranked) {
        if (selected.length >= desired) break;
        if (selected.some(item => item.paragraphIndex === shot.paragraphIndex && item.type === shot.type)) continue;
        add(shot);
    }
    for (const shot of ranked) {
        if (selected.length >= desired) break;
        add(shot);
    }

    return {
        desired,
        shots: selected.slice(0, maximum).sort((a, b) => a.paragraphIndex - b.paragraphIndex || b.priority - a.priority),
        diagnostics: {
            modelCount: modelShots.length,
            fallbackCount: fallbackShots.length,
            criticalStages: criticalStoryStages(story).map(item => item.stage),
        },
    };
}

export function composeV3Prompt(shot = {}, {
    fixedPositive = DEFAULT_V3_POSITIVE,
    fixedNegative = DEFAULT_V3_NEGATIVE,
} = {}) {
    const positive = uniqueTags([
        fixedPositive,
        shot.safety || 'safe',
        shot.prompt,
        shot.continuity?.outfit,
        shot.continuity?.location,
    ]).filter(tag => !CJK_RE.test(tag)).join(', ').slice(0, 2200);
    const negative = uniqueTags([
        fixedNegative,
        shot.negative,
    ]).filter(tag => !CJK_RE.test(tag)).join(', ').slice(0, 1800);
    return { positive, negative };
}

export function seedForV3Shot(shot = {}, retry = 0) {
    const base = stableHashText(`${shot.id}|${shot.anchor}|${shot.prompt}`) % 2_000_000_000;
    return Math.max(1, (base + Math.max(0, Number(retry) || 0) * 104729) % 2_147_483_647);
}

export function buildDirectorV3Contract({
    minimum = 3,
    maximum = 5,
    card = {},
    continuityMemory = '',
} = {}) {
    return `[JANIMA_AUTO_CG_V3 — direct storyboard protocol]
Write the requested story naturally. Do not mention image generation, prompts, JSON, analysis, or this protocol in visible prose.

AFTER finishing the complete visible reply, review the whole reply from beginning to end. Choose ${minimum}–${maximum} genuinely distinct, high-value visual moments and write each image prompt directly. Do not first split the scene into action/setting/expression fields and do not ask another model.

Shot count:
- 3 for an ordinary substantial reply.
- 4 for a long reply, meaningful location/outfit change, combat progression, or intimacy progression.
- 5 for a long multi-stage reply or two or more distinct adult explicit stages.
- Never pad with weak static portraits. A stronger later scene replaces a weaker early scene.

Hard coverage rules:
- If the visible reply contains any clearly adult NSFW/explicit event, at least one NSFW/explicit shot MUST be present.
- If it contains distinct adult stages such as undressing, oral/manual action, penetration, position change, climax, and aftercare, preserve as many distinct stages as the ${maximum}-shot cap allows.
- Later explicit scenes must not be omitted because early ordinary dialogue already used the slots.
- Never create sexual imagery for a minor or a character described as under 18.

Shot quality rules:
- Select decisive physical interactions, relationship changes, combat instants, outfit/location changes, strong expressions, important props in use, and cinematic adult intimacy.
- Reject scenery-only shots, male-only shots, generic standing portraits, ordinary talking, or a woman merely looking at the viewer unless that is genuinely the strongest available moment.
- anchor must be an exact 15–160 character substring copied from the selected visible paragraph. It is only a DOM anchor, not an image prompt.
- prompt must be a COMPLETE English comma-separated scene prompt: exact people count, named character visual identity, current clothing or nudity, exact action/contact/result, body positions, current location, important props, expression, framing, lighting, and atmosphere.
- prompt must describe the selected moment only. Never copy Chinese prose into prompt, negative, type, continuity outfit, or continuity location.
- The plugin adds universal quality tags separately. Spend prompt space on the actual scene.
- For ancient Chinese/xianxia/wuxia stories, use established details such as hanfu, robes, courtyard, pavilion, lake, bamboo grove, guqin, wooden sword, Chinese sword. Never invent western uniforms, capes, epaulettes, futuristic armor, modern school uniforms, or European palaces.
- Use the active character card appearance only when the exact card character name is one of the shot characters. Active card: ${clean(card.name, 120) || '(none)'}. Card visual reference: ${clean(card.visual, 1000) || '(none)'}.

Continuity memory from prior accepted shots (use only for exactly matching character names):
${clean(continuityMemory, 1800) || '(none)'}

Append exactly ONE final single-line HTML comment and nothing after it:
<!--JANIMA_V3:{"version":3,"shot_count":3,"shots":[{"id":"s1","anchor":"exact substring copied from visible paragraph","priority":95,"type":"teaching_interaction","safety":"safe","must_draw":true,"prompt":"2girls, named adult female master, named adult female disciple, exact hair and eye colors, current hanfu, master standing behind disciple, hand over hand sword guidance, both hands gripping the same wooden sword, training courtyard, focused expressions, upper-body medium shot, warm afternoon sunlight","negative":"western uniform, modern weapon, empty hands","continuity":{"characters":["exact names"],"outfit":"current English clothing tags","location":"current English location tags"}}]}-->

shot_count must equal shots.length. Every object must contain id, anchor, priority, type, safety, must_draw, prompt, negative, and continuity.`;
}
