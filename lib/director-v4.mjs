import { splitStoryParagraphs } from './scene-anchor.mjs';

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const FEMALE_RE = /(?:她|女子|女人|少女|女主|女友|妻子|夫人|小姐|姑娘|师姐|师妹|师父|woman|women|girl|girls|female|wife|girlfriend|lady)/i;
const VISUAL_RE = /(?:走|跑|坐|站|跪|躺|推|拉|抱|吻|抓|握|拔|挥|劈|刺|练|舞|跳|回头|转身|探头|开门|递|喂|抚|摸|按|脱|穿|进入|抽动|高潮|弹琴|做饭|烹饪|walk|run|sit|stand|kneel|lie|push|pull|embrace|kiss|grab|hold|draw|swing|stab|turn|peek|open|feed|touch|undress|penetrat|climax|play|cook)/i;
const CHANGE_RE = /(?:换上|换下|脱下|穿上|走进|来到|离开|转场|房间|卧室|浴室|教室|街道|庭院|亭|湖边|树林|竹林|夜晚|清晨|changed clothes|entered|arrived|left|bedroom|bathroom|classroom|street|courtyard|pavilion|lakeside|forest|night|morning)/i;
const MINOR_RE = /(?:未成年|小学生|初中生|幼女|萝莉|儿童|child|minor|underage|loli|\b(?:[0-9]|1[0-7])\s*(?:岁|years? old|yo)\b)/i;
const INTIMATE_RE = /(?:亲吻|接吻|拥抱|抚摸|爱抚|脱下|解开|暧昧|喘息|赤裸|事后|余韵|依偎|kiss|embrace|caress|undress|intimate|erotic|naked|aftercare)/i;
const EXPLICIT_RE = /(?:性交|做爱|性行为|插入|进入她|口交|手交|裸体|全裸|高潮|射精|阴道|阴茎|乳房|乳头|骑乘|后入|penetrat|intercourse|oral sex|handjob|nude|orgasm|climax|cum|cowgirl|doggystyle)/i;

export const DEFAULT_V4_POSITIVE = 'masterpiece, best quality, highres, newest, anime visual novel event CG, cohesive single scene, detailed face, detailed eyes, detailed clothing, coherent anatomy, coherent hands, natural interaction, cinematic composition, detailed environment';
export const DEFAULT_V4_NEGATIVE = 'worst quality, low quality, lowres, blurry, bad anatomy, bad hands, extra fingers, missing fingers, fused fingers, extra limbs, malformed limbs, fused bodies, duplicated person, cloned face, wrong face, different face, wrong hair color, wrong eye color, wrong clothes, inconsistent outfit, unrelated character, unrelated scene, generic portrait, empty pose, multiple views, split screen, comic panel, collage, white border, large empty border, tiny subject, cropped head, text, logo, signature, watermark, artist name, jpeg artifacts';

function clean(value = '', maximum = 2400) {
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
        const tag = clean(raw, 300);
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

function stripCodeFences(value = '') {
    return String(value || '').replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
}

export function extractJsonObject(value = '') {
    const text = stripCodeFences(value)
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
        .trim();
    const start = text.indexOf('{');
    if (start < 0) throw new Error('planner did not return JSON');
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
        const char = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) return text.slice(start, index + 1);
        }
    }
    throw new Error('planner JSON is incomplete');
}

export function stageForText(text = '', requested = '') {
    const stage = clean(requested, 80).toLowerCase().replace(/\s+/g, '_');
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
    if (/做饭|烹饪|厨房|cook|kitchen/i.test(text)) return 'cooking';
    if (/走进|来到|离开|entered|arrived|left/i.test(text)) return 'location_change';
    if (/换上|换下|穿上|changed clothes|outfit/i.test(text)) return 'outfit_change';
    return 'story_action';
}

export function nsfwLevelForText(text = '', requested = 0) {
    const requestedLevel = Number.isFinite(Number(requested))
        ? Math.max(0, Math.min(3, Math.round(Number(requested))))
        : 0;
    const detectedLevel = EXPLICIT_RE.test(text) ? 3 : INTIMATE_RE.test(text) ? 1 : 0;
    return Math.max(requestedLevel, detectedLevel);
}

function normalizeCharacter(raw = {}) {
    return {
        name: clean(raw.name, 120),
        identity: englishTags(raw.identity || raw.identity_tags || raw.appearance).join(', '),
        outfit: englishTags(raw.outfit || raw.outfit_tags || raw.clothing).join(', '),
    };
}

function normalizeShot(raw = {}, story = '', index = 0) {
    const paragraphs = splitStoryParagraphs(story);
    const paragraphIndex = Math.trunc(clamp(raw.paragraph_index ?? raw.paragraphIndex, 0, Math.max(0, paragraphs.length - 1), -1));
    if (paragraphIndex < 0 || !paragraphs[paragraphIndex]) throw new Error(`shot ${index + 1}: invalid paragraph_index`);
    const paragraph = paragraphs[paragraphIndex].text;
    const evidence = `${paragraph} ${raw.stage || ''} ${raw.action_tags || ''} ${raw.positive || ''}`;
    const nsfwLevel = nsfwLevelForText(evidence, raw.nsfw_level ?? raw.nsfwLevel);
    if (nsfwLevel > 0 && MINOR_RE.test(evidence)) throw new Error(`shot ${index + 1}: minor evidence in adult shot`);
    const fields = {
        people: englishTags(raw.people).join(', '),
        characterTags: englishTags(raw.character_tags || raw.characterTags).join(', '),
        outfitTags: englishTags(raw.outfit_tags || raw.outfitTags).join(', '),
        settingTags: englishTags(raw.setting_tags || raw.settingTags).join(', '),
        actionTags: englishTags(raw.action_tags || raw.actionTags).join(', '),
        expressionTags: englishTags(raw.expression_tags || raw.expressionTags).join(', '),
        cameraTags: englishTags(raw.camera_tags || raw.cameraTags).join(', '),
        positive: englishTags(raw.positive || raw.prompt).join(', '),
        negative: englishTags(raw.negative).join(', '),
    };
    const visualTagCount = uniqueTags(Object.values(fields)).length;
    if (visualTagCount < 7) throw new Error(`shot ${index + 1}: insufficient visual detail`);
    return {
        id: clean(raw.id || `shot_${index + 1}`, 80),
        paragraphIndex,
        paragraph,
        anchor: paragraph,
        block: clean(raw.block || raw.scene_block || raw.sceneBlock || `p${paragraphIndex}`, 120),
        importance: Math.round(clamp(raw.importance ?? raw.priority, 0, 100, 60)),
        nsfwLevel,
        stage: stageForText(evidence, raw.stage),
        mustDraw: Boolean(raw.must_draw ?? raw.mustDraw ?? nsfwLevel > 0),
        ...fields,
        source: 'planner',
    };
}

export function parsePlannerResponse(value = '', story = '') {
    const json = extractJsonObject(value);
    const raw = JSON.parse(json);
    const errors = [];
    const characters = (Array.isArray(raw.characters) ? raw.characters : []).map(normalizeCharacter).filter(item => item.name || item.identity);
    const shots = [];
    for (const [index, item] of (Array.isArray(raw.shots) ? raw.shots : []).entries()) {
        try {
            shots.push(normalizeShot(item, story, index));
        } catch (error) {
            errors.push(String(error?.message || error));
        }
    }
    return {
        targetCount: Math.round(clamp(raw.target_count ?? raw.targetCount, 3, 5, 3)),
        characters,
        shots,
        errors,
        raw,
    };
}

export function desiredShotCountV4(story = '', { minimum = 3, maximum = 5 } = {}) {
    const paragraphs = splitStoryParagraphs(story).filter(item => item.text.length >= 8);
    const text = paragraphs.map(item => item.text).join('\n');
    const adultStages = new Set(paragraphs.map(item => stageForText(item.text)).filter(stage => ['undressing', 'oral', 'manual', 'penetration', 'position_change', 'climax', 'aftercare'].includes(stage)));
    const changes = (text.match(new RegExp(CHANGE_RE.source, 'gi')) || []).length;
    let count = minimum;
    if (paragraphs.length >= 7 || text.length >= 900 || changes >= 2 || INTIMATE_RE.test(text)) count = 4;
    if (paragraphs.length >= 11 || text.length >= 1550 || adultStages.size >= 2) count = 5;
    return Math.max(minimum, Math.min(maximum, count));
}

function fallbackAction(text = '', stage = '') {
    const tags = [];
    const add = (re, tag) => { if (re.test(text)) tags.push(tag); };
    add(/纠正.*(?:握剑|姿势)|手.*覆.*手|握住.*手.*剑/i, 'adult female master guiding her disciple hand over hand, both hands gripping the same wooden sword');
    add(/木剑|练剑|剑招|步法|挥剑/i, 'adult woman practicing swordsmanship with a wooden sword, visible sword stance');
    add(/真剑|剑身|剑鞘|拔出.*剑/i, 'adult woman drawing a Chinese sword from its scabbard, reflective blade');
    add(/抚琴|弹琴|琴弦|古琴/i, 'adult woman seated and playing a guqin, both hands touching the strings');
    add(/做鱼|烹鱼|厨房|下厨/i, 'adult woman cooking fish in a traditional kitchen, cookware and food visible');
    add(/亲吻|接吻/i, 'adult lovers kissing, lips touching, mutual physical contact');
    add(/拥抱|抱紧|搂住/i, 'adult lovers embracing, visible body contact');
    add(/脱下|解开|褪下/i, 'clearly adult woman undressing, clothing visibly being removed');
    add(/全裸|裸体|赤裸/i, 'clearly adult nude woman, bare skin');
    add(/口交/i, 'consensual adult oral sex, explicit sexual action');
    add(/手交/i, 'consensual adult handjob, explicit sexual action');
    add(/性交|做爱|性行为|插入|进入她/i, 'consensual adult intercourse, explicit penetration, clear body positioning');
    add(/骑乘|跨坐/i, 'adult woman straddling her partner, cowgirl position');
    add(/后入/i, 'consensual adult rear-entry position');
    add(/高潮|射精/i, 'consensual adult sexual climax, flushed face, visible climax reaction');
    add(/事后|余韵|依偎/i, 'adult lovers embracing during aftercare');
    if (!tags.length) tags.push(stage === 'location_change' ? 'adult woman arriving in the newly established location' : 'clear visible physical action from the selected story paragraph');
    return tags.join(', ');
}

function fallbackSetting(text = '') {
    const tags = [];
    const add = (re, tag) => { if (re.test(text)) tags.push(tag); };
    add(/厨房|灶台/i, 'traditional kitchen, stove, cookware and food visible');
    add(/房间|卧房|卧室|床榻/i, 'furnished bedroom interior');
    add(/书房|书桌|书架/i, 'traditional study room, desk and bookshelves');
    add(/庭院|院子/i, 'traditional Chinese courtyard');
    add(/湖心亭|亭中|亭子/i, 'lakeside Chinese pavilion');
    add(/湖边|湖面/i, 'beside a misty lake');
    add(/竹林/i, 'bamboo grove');
    add(/树林|森林/i, 'forest');
    add(/教室/i, 'classroom interior');
    add(/街道|街上/i, 'street');
    return tags.join(', ') || 'environment exactly matching the selected story paragraph';
}

function fallbackOutfit(text = '') {
    if (/(?:古代|江湖|武林|修仙|仙门|师姐|师妹|师父|木剑|真剑|剑法|古琴|亭|竹林)/i.test(text)) return 'period-accurate hanfu or Chinese robes exactly matching the story';
    return 'exact current clothing described in the story';
}

function makeFallbackShot(paragraph, index, all) {
    const window = all.slice(Math.max(0, index - 2), index + 1).map(item => item.text).join(' ');
    const nsfwLevel = nsfwLevelForText(window);
    const stage = stageForText(window);
    return {
        id: `fallback_${paragraph.index}`,
        paragraphIndex: paragraph.index,
        paragraph: paragraph.text,
        anchor: paragraph.text,
        block: `fallback_${stage}_${paragraph.index}`,
        importance: nsfwLevel === 3 ? 100 : nsfwLevel > 0 ? 92 : VISUAL_RE.test(paragraph.text) ? 70 : 40,
        nsfwLevel,
        stage,
        mustDraw: nsfwLevel > 0,
        people: FEMALE_RE.test(window) ? '1girl' : '',
        characterTags: 'adult female character exactly matching the story description',
        outfitTags: fallbackOutfit(window),
        settingTags: fallbackSetting(window),
        actionTags: fallbackAction(window, stage),
        expressionTags: nsfwLevel > 0 ? 'expression and arousal matching the exact adult scene' : 'expression matching the selected story moment',
        cameraTags: nsfwLevel >= 2 ? 'intimate medium close-up, clear body positions, main action unobstructed' : 'cinematic medium shot, main subjects large in frame, clear action and environment',
        positive: '',
        negative: '',
        source: 'fallback',
    };
}

export function buildFallbackShotsV4(story = '') {
    const paragraphs = splitStoryParagraphs(story).filter(item => item.text.length >= 8);
    const hasFemale = FEMALE_RE.test(story);
    return paragraphs.map((paragraph, index, all) => makeFallbackShot(paragraph, index, all))
        .filter(shot => hasFemale && (shot.nsfwLevel > 0 || VISUAL_RE.test(shot.paragraph) || CHANGE_RE.test(shot.paragraph)));
}

function requiredAdultStages(story = '') {
    const paragraphs = splitStoryParagraphs(story);
    const result = [];
    const seen = new Set();
    for (const paragraph of paragraphs) {
        const level = nsfwLevelForText(paragraph.text);
        if (level === 0) continue;
        const stage = stageForText(paragraph.text);
        const key = level >= 2 ? stage : `intimate:${stage}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ paragraphIndex: paragraph.index, stage, nsfwLevel: level });
    }
    const weights = { penetration: 160, position_change: 150, climax: 145, oral: 140, manual: 135, undressing: 110, aftercare: 105, kiss: 70, embrace: 60 };
    return result.sort((a, b) => (b.nsfwLevel * 1000 + (weights[b.stage] || 0) + b.paragraphIndex) - (a.nsfwLevel * 1000 + (weights[a.stage] || 0) + a.paragraphIndex));
}

function shotScore(shot, paragraphCount) {
    let score = Number(shot.importance || 0);
    if (shot.source === 'planner') score += 45;
    if (shot.mustDraw) score += 80;
    score += shot.nsfwLevel * 80;
    if (VISUAL_RE.test(`${shot.paragraph} ${shot.actionTags}`)) score += 20;
    if (CHANGE_RE.test(shot.paragraph)) score += 12;
    score += paragraphCount > 1 ? (shot.paragraphIndex / (paragraphCount - 1)) * 6 : 0;
    return score;
}

function zoneFor(index, count) {
    if (count <= 1) return 'middle';
    const ratio = index / (count - 1);
    if (ratio < 0.34) return 'early';
    if (ratio < 0.67) return 'middle';
    return 'late';
}

export function selectShotsV4({ story = '', plannerShots = [], fallbackShots = [], minimum = 3, maximum = 5, requestedCount = 3 } = {}) {
    const paragraphs = splitStoryParagraphs(story);
    const desired = Math.max(minimum, Math.min(maximum, Math.max(requestedCount, desiredShotCountV4(story, { minimum, maximum }))));
    const candidates = [...plannerShots, ...fallbackShots].filter((shot, index, all) => all.findIndex(other => other.paragraphIndex === shot.paragraphIndex && other.stage === shot.stage && other.source === shot.source) === index);
    const selected = [];
    const usedParagraphs = new Set();
    const usedBlocks = new Set();
    const add = (shot, force = false) => {
        if (!shot || selected.length >= maximum || usedParagraphs.has(shot.paragraphIndex)) return false;
        if (!force && usedBlocks.has(shot.block)) return false;
        if (!force && selected.some(item => Math.abs(item.paragraphIndex - shot.paragraphIndex) < 2)) return false;
        selected.push(shot);
        usedParagraphs.add(shot.paragraphIndex);
        usedBlocks.add(shot.block);
        return true;
    };

    for (const required of requiredAdultStages(story)) {
        const matches = candidates.filter(shot => shot.stage === required.stage || shot.paragraphIndex === required.paragraphIndex)
            .sort((a, b) => shotScore(b, paragraphs.length) - shotScore(a, paragraphs.length));
        add(matches[0], true);
        if (selected.length >= maximum) break;
    }

    const ranked = candidates.slice().sort((a, b) => shotScore(b, paragraphs.length) - shotScore(a, paragraphs.length));
    for (const zone of ['early', 'middle', 'late']) {
        if (selected.length >= desired) break;
        if (selected.some(shot => zoneFor(shot.paragraphIndex, paragraphs.length) === zone)) continue;
        const candidate = ranked.find(shot => zoneFor(shot.paragraphIndex, paragraphs.length) === zone && !usedParagraphs.has(shot.paragraphIndex));
        add(candidate);
    }
    for (const shot of ranked) {
        if (selected.length >= desired) break;
        add(shot);
    }
    for (const shot of ranked) {
        if (selected.length >= desired) break;
        add(shot, true);
    }

    return {
        desired,
        shots: selected.sort((a, b) => a.paragraphIndex - b.paragraphIndex),
        diagnostics: {
            plannerCount: plannerShots.length,
            fallbackCount: fallbackShots.length,
            requiredAdultStages: requiredAdultStages(story),
            zones: selected.map(shot => zoneFor(shot.paragraphIndex, paragraphs.length)),
        },
    };
}

function adultStageTags(stage, level) {
    if (level === 0) return [];
    const base = level >= 2 ? ['nsfw', 'explicit adult scene', 'clearly adult characters', 'erotic scene matching the exact story action'] : ['adult romantic intimacy', 'physical contact matching the exact story action'];
    const map = {
        kiss: ['adult lovers kissing', 'lips touching'],
        embrace: ['adult lovers embracing', 'close body contact'],
        undressing: ['adult woman undressing', 'clothing visibly removed', 'bare skin'],
        oral: ['consensual adult oral sex', 'explicit sexual action'],
        manual: ['consensual adult handjob', 'explicit sexual action'],
        penetration: ['consensual adult intercourse', 'explicit penetration', 'clear body positioning'],
        position_change: ['consensual adult sex position', 'clear body positioning'],
        climax: ['adult sexual climax', 'orgasm', 'flushed face', 'visible climax reaction'],
        aftercare: ['adult lovers during aftercare', 'post-coital embrace'],
    };
    return [...base, ...(map[stage] || [])];
}

function sanitizeAdultNegative(tags, level) {
    if (level === 0) return tags;
    const conflict = /^(?:sfw|safe|fully clothed|clothed|no nudity|no nude|no sex|nsfw|nude|naked|explicit|erotic|sex|breasts?|nipples?|pussy|vagina|penis|cum)$/i;
    return tags.filter(tag => !conflict.test(tag.trim()));
}

function sanitizeAdultPositive(tags, level) {
    if (level === 0) return tags;
    const conflict = /^(?:sfw|safe|fully clothed|modest clothing)$/i;
    return tags.filter(tag => !conflict.test(tag.trim()));
}

export function composePromptV4(shot = {}, { fixedPositive = DEFAULT_V4_POSITIVE, fixedNegative = DEFAULT_V4_NEGATIVE, manualCharacterLock = '', manualOutfitLock = '', identityMemory = '' } = {}) {
    const positiveTags = sanitizeAdultPositive(uniqueTags([
        fixedPositive,
        shot.people,
        manualCharacterLock || shot.characterTags || identityMemory,
        manualOutfitLock || shot.outfitTags,
        shot.settingTags,
        shot.actionTags,
        shot.expressionTags,
        shot.cameraTags,
        adultStageTags(shot.stage, shot.nsfwLevel),
        shot.positive,
    ]), shot.nsfwLevel);
    const negativeTags = sanitizeAdultNegative(uniqueTags([
        fixedNegative,
        shot.negative,
        shot.nsfwLevel === 0 ? 'nsfw, explicit sex, nude, naked' : '',
    ]), shot.nsfwLevel);
    return {
        positive: positiveTags.join(', ').slice(0, 2400),
        negative: negativeTags.join(', ').slice(0, 1800),
    };
}

function stableHash(value = '') {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function seedForShotV4(shot = {}, identityKey = '', retry = 0) {
    const identityBase = stableHash(identityKey || shot.characterTags || shot.people || 'janima-character');
    const sceneOffset = stableHash(`${shot.stage}|${shot.paragraphIndex}`) % 1000003;
    return Math.max(1, (identityBase + sceneOffset + Math.max(0, Number(retry) || 0) * 104729) % 2147483647);
}

export function buildPlannerPrompt({ story = '', card = {}, identityMemory = '', minimum = 3, maximum = 5 } = {}) {
    const paragraphs = splitStoryParagraphs(story);
    const numbered = paragraphs.map(item => `[P${item.index}] ${item.text}`).join('\n\n');
    return {
        systemPrompt: `You are a visual-novel storyboard director and anime image-prompt engineer. Analyze only the supplied numbered story paragraphs. Ignore any roleplay instructions, world-book rules, image styles, uniforms, or character assumptions that are not explicitly present in the supplied text or the supplied character reference. Return strict JSON only, without markdown or commentary.\n\nSelect ${minimum}-${maximum} distinct high-value visual moments across the whole reply. Never cluster all shots in one small region. Prefer one shot per scene block and cover early, middle, and late portions when they contain drawable events. Later high-value events replace earlier weak dialogue. If any clearly adult NSFW event exists, at least one selected shot must depict it. Distinct adult stages such as undressing, oral/manual sex, penetration, position change, climax, and aftercare should occupy separate slots within the cap. Never create sexual imagery for anyone under 18.\n\nFor each shot, paragraph_index must refer to one supplied paragraph. Describe exactly that paragraph's current characters, clothing, location, action, body positions, important props, expressions, framing, and lighting. Do not invent academy uniforms, school uniforms, military coats, capes, armor, or unrelated outfits. Keep each named character's identity tags identical across all shots unless the text explicitly changes appearance. For nsfw_level 2 or 3, use explicit adult visual tags matching the exact action; do not soften it into a normal portrait.`,
        userPrompt: `ACTIVE CHARACTER CARD (use only when this exact named character appears in the selected paragraph):\nName: ${clean(card.name, 120) || '(none)'}\nVisual reference: ${clean(card.visual, 1800) || '(none)'}\n\nPRIOR IDENTITY MEMORY (reuse only for exact matching names):\n${clean(identityMemory, 1800) || '(none)'}\n\nNUMBERED STORY PARAGRAPHS:\n${numbered}\n\nReturn this exact JSON shape:\n{\n  "target_count": 3,\n  "characters": [\n    {"name":"exact name","identity":"English comma tags for stable face, hair, eyes, body","outfit":"English comma tags for current outfit"}\n  ],\n  "shots": [\n    {\n      "id":"s1",\n      "paragraph_index":0,\n      "block":"distinct scene block id",\n      "importance":95,\n      "nsfw_level":0,\n      "stage":"story_action",\n      "must_draw":true,\n      "people":"1girl or 1girl, 1boy or 2girls",\n      "character_tags":"stable English identity tags for every visible character",\n      "outfit_tags":"exact current clothing or nudity in English tags",\n      "setting_tags":"exact location, era, important background objects",\n      "action_tags":"exact visible action and contact, including body parts and positions",\n      "expression_tags":"visible expressions",\n      "camera_tags":"framing, angle, composition, lighting",\n      "positive":"extra English scene tags only",\n      "negative":"scene-specific contradictions to forbid"\n    }\n  ]\n}\n\nRules: target_count must equal shots.length and be ${minimum}-${maximum}. Use paragraph indices from the supplied list. Use English comma-separated visual tags in all tag fields.`,
    };
}
