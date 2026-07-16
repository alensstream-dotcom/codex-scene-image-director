const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const MINOR_RE = /(?:未成年|小学生|初中生|幼女|萝莉|儿童|child|minor|underage|loli|\b(?:[0-9]|1[0-7])\s*(?:岁|years? old|yo)\b)/i;
const VISUAL_RE = /(?:走|跑|坐|站|跪|躺|推|拉|抱|搂|吻|抓|握|拔|挥|劈|刺|练|舞|跳|凑|回头|转身|探头|开门|关门|递|喂|抚|摸|按|脱|穿|进入|抽动|高潮|弹琴|抚琴|举剑|出剑|剑招|步法|微笑|流泪|脸红|颤抖|做饭|做鱼|烹鱼|烹饪|下厨|walk|run|sit|stand|kneel|lie|push|pull|embrace|kiss|grab|hold|draw|swing|stab|turn|peek|open|feed|touch|undress|penetrat|climax|play|cook)/i;
const RELATION_RE = /(?:握住.*手|手.*覆.*手|抱住|搂住|亲吻|接吻|对视|依偎|靠在|压住|跨坐|喂|扶住|牵手|hand over hand|embrace|kiss|eye contact|straddl|feed|hold hands)/i;
const LOCATION_RE = /(?:来到|走进|进入|离开|回到|庭院|院子|厨房|卧室|房间|书房|亭|湖边|竹林|树林|街道|教室|浴室|entered|arrived|left|courtyard|kitchen|bedroom|study|pavilion|lake|forest|street|classroom|bathroom)/i;
const OUTFIT_RE = /(?:穿着|身穿|换上|换下|脱下|解开|披着|裹着|着一袭|衣着|服饰|裙|袍|衫|衣|甲|盔|制服|校服|斗篷|披风|长靴|鞋|内衣|裸体|赤裸|wearing|dressed in|changed into|outfit|uniform|robe|hanfu|dress|skirt|shirt|coat|armor|lingerie|nude|naked)/i;
const INTIMATE_RE = /(?:亲吻|接吻|拥抱|抚摸|爱抚|暧昧|喘息|依偎|kiss|embrace|caress|intimate|erotic tension|aftercare)/i;
const NUDITY_RE = /(?:脱下|解开|褪下|赤裸|裸体|全裸|乳房|乳头|裸露|undress|nude|naked|bare breasts?|nipples?|explicit touching)/i;
const SEX_RE = /(?:性交|做爱|性行为|插入|进入她|口交|手交|高潮|射精|阴道|阴茎|骑乘|后入|penetrat|intercourse|oral sex|handjob|orgasm|climax|cum|cowgirl|doggystyle)/i;
const SCHOOL_RE = /(?:学院|学校|校园|教室|校服|学生制服|school|academy|classroom|school uniform|student uniform)/i;
const ANCIENT_RE = /(?:古代|江湖|武林|修仙|仙门|师姐|师妹|师父|木剑|真剑|剑法|古琴|亭|竹林|汉服|长袍|hanfu|wuxia|xianxia|ancient china)/i;
const POLLUTION_RE = /(?:school uniform|academy uniform|student uniform|school blazer|blazer|necktie|school cape|western military uniform|military coat|epaulettes|red cape|futuristic armor)/i;

export const DEFAULT_V5_POSITIVE = 'masterpiece, best quality, score_7_up, highres, newest, anime illustration, visual novel event CG, cohesive single scene, detailed face, detailed eyes, detailed clothing, coherent anatomy, coherent hands, natural interaction, cinematic composition, detailed environment';
export const DEFAULT_V5_NEGATIVE = 'worst quality, low quality, score_1, score_2, score_3, lowres, blurry, bad anatomy, bad hands, extra fingers, missing fingers, fused fingers, extra limbs, malformed limbs, fused bodies, duplicated person, cloned face, wrong face, changed face, wrong hair color, wrong eye color, wrong clothes, changed outfit, outfit substitution, unrelated character, unrelated scene, generic portrait, empty pose, multiple views, split screen, comic panel, collage, white border, huge empty background, tiny subject, cropped head, text, logo, signature, watermark, artist name, jpeg artifacts';

function clean(value = '', maximum = 2600) {
    return String(value || '').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function clamp(value, minimum, maximum, fallback = minimum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function uniqueTags(values) {
    const result = [];
    const seen = new Set();
    for (const raw of values.flatMap(value => Array.isArray(value) ? value : String(value || '').split(/[,，]\s*/))) {
        const tag = clean(raw, 420);
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        result.push(tag);
    }
    return result;
}

function englishTags(value = '') {
    return uniqueTags([value]).filter(tag => /[a-z]/i.test(tag) && !CJK_RE.test(tag));
}

function normalizeText(value = '') {
    return clean(value, 100000).replace(/[“”「」『』]/g, '"').replace(/[‘’]/g, "'");
}

function extractJson(value = '') {
    const source = String(value || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
        .replace(/```(?:json)?\s*/gi, '')
        .replace(/```/g, '')
        .trim();
    const start = source.indexOf('{');
    if (start < 0) throw new Error('没有找到 JSON 对象');
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index++) {
        const char = source[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '{') depth++;
        else if (char === '}' && --depth === 0) return JSON.parse(source.slice(start, index + 1));
    }
    throw new Error('JSON 不完整');
}

export function splitStoryWithSpans(value = '') {
    const raw = String(value || '').replace(/\r/g, '').trim();
    if (!raw) return [];
    let pieces = [...raw.matchAll(/(?:^|\n\s*\n+)([\s\S]*?)(?=\n\s*\n+|$)/g)]
        .map(match => ({ raw: match[1], start: match.index + match[0].indexOf(match[1]) }))
        .filter(item => normalizeText(item.raw));
    if (pieces.length <= 1) {
        pieces = [...raw.matchAll(/(?:^|\n+)([^\n]+)(?=\n|$)/g)]
            .map(match => ({ raw: match[1], start: match.index + match[0].indexOf(match[1]) }))
            .filter(item => normalizeText(item.raw));
    }
    return pieces.map((item, index) => {
        const text = normalizeText(item.raw);
        const start = raw.indexOf(item.raw, Math.max(0, item.start));
        const end = start + item.raw.length;
        return {
            index,
            text,
            raw: item.raw,
            start,
            end,
            before: normalizeText(raw.slice(Math.max(0, start - 80), start)),
            after: normalizeText(raw.slice(end, Math.min(raw.length, end + 80))),
        };
    });
}

export function makeAnchorSpec(paragraph = {}) {
    return {
        quote: clean(paragraph.text, 1800),
        before: clean(paragraph.before, 180),
        after: clean(paragraph.after, 180),
        rawStart: Number(paragraph.start || 0),
        rawEnd: Number(paragraph.end || 0),
    };
}

export function nsfwLevelForV5(text = '', requested = 0) {
    const detected = SEX_RE.test(text) ? 3 : NUDITY_RE.test(text) ? 2 : INTIMATE_RE.test(text) ? 1 : 0;
    return Math.max(detected, Math.trunc(clamp(requested, 0, 3, 0)));
}

export function stageForV5(text = '', requested = '') {
    const stage = clean(requested, 80).toLowerCase().replace(/\s+/g, '_');
    if (/事后|余韵|依偎|aftercare/i.test(text)) return 'aftercare';
    if (/高潮|射精|orgasm|climax|cum/i.test(text)) return 'climax';
    if (/骑乘|跨坐|cowgirl|后入|doggystyle|体位/i.test(text)) return 'position_change';
    if (/插入|进入她|性交|做爱|性行为|penetrat|intercourse/i.test(text)) return 'penetration';
    if (/口交|oral sex/i.test(text)) return 'oral';
    if (/手交|handjob/i.test(text)) return 'manual';
    if (/脱下|解开|褪下|裸体|赤裸|undress|nude|naked/i.test(text)) return 'undressing';
    if (/亲吻|接吻|kiss/i.test(text)) return 'kiss';
    if (/拥抱|抱紧|搂住|embrace|hug/i.test(text)) return 'embrace';
    if (/抚琴|弹琴|琴弦|古琴|guqin|zither/i.test(text)) return 'music';
    if (/木剑|真剑|拔剑|挥剑|剑招|练剑|sword/i.test(text)) return 'sword_action';
    if (/做饭|烹饪|烹鱼|厨房|cook|kitchen/i.test(text)) return 'cooking';
    if (/走进|来到|离开|entered|arrived|left/i.test(text)) return 'location_change';
    if (/换上|换下|穿上|changed clothes|outfit/i.test(text)) return 'outfit_change';
    if (stage && !['story', 'scene', 'story_action', 'unknown'].includes(stage)) return stage;
    return 'story_action';
}

function validateEvidence(paragraph, evidence = '', pattern = null) {
    const wanted = normalizeText(evidence);
    if (!wanted || !normalizeText(paragraph.text).includes(wanted)) return false;
    return !pattern || pattern.test(wanted);
}

function normalizeIdentity(raw = {}) {
    return {
        name: clean(raw.name, 120),
        identity: englishTags(raw.identity || raw.appearance || raw.identity_tags).join(', '),
        defaultOutfit: englishTags(raw.default_outfit || raw.defaultOutfit || raw.outfit).join(', '),
    };
}

export function parseStateResponse(value = '', story = '') {
    const raw = extractJson(value);
    const paragraphs = splitStoryWithSpans(story);
    const characters = (Array.isArray(raw.characters) ? raw.characters : [])
        .map(normalizeIdentity)
        .filter(item => item.name || item.identity);
    const events = [];
    const errors = [];
    for (const [index, item] of (Array.isArray(raw.events) ? raw.events : []).entries()) {
        const paragraphIndex = Math.trunc(clamp(item.paragraph_index ?? item.paragraphIndex, 0, Math.max(0, paragraphs.length - 1), -1));
        const paragraph = paragraphs[paragraphIndex];
        if (!paragraph) {
            errors.push(`event ${index + 1}: paragraph_index 无效`);
            continue;
        }
        const locationEvidence = clean(item.location_evidence || item.locationEvidence, 300);
        const location = validateEvidence(paragraph, locationEvidence, LOCATION_RE)
            ? englishTags(item.location).join(', ')
            : '';
        const outfitUpdates = [];
        for (const update of (Array.isArray(item.outfit_updates) ? item.outfit_updates : [])) {
            const evidence = clean(update.evidence, 300);
            const outfit = englishTags(update.outfit).join(', ');
            if (!clean(update.name, 120) || !outfit || !validateEvidence(paragraph, evidence, OUTFIT_RE)) continue;
            outfitUpdates.push({ name: clean(update.name, 120), outfit, evidence });
        }
        const present = (Array.isArray(item.characters_present) ? item.characters_present : [])
            .map(name => clean(name, 120)).filter(Boolean).slice(0, 6);
        const evidence = `${paragraph.text} ${item.stage || ''}`;
        events.push({
            paragraphIndex,
            charactersPresent: present,
            location,
            locationEvidence,
            outfitUpdates,
            stage: stageForV5(evidence, item.stage),
            nsfwLevel: nsfwLevelForV5(evidence, item.nsfw_level ?? item.nsfwLevel),
        });
    }
    return { characters, events, errors, raw };
}

function registryMap(characters = [], priorMemory = {}) {
    const map = new Map();
    for (const [name, entry] of Object.entries(priorMemory || {})) {
        map.set(name.toLowerCase(), { name, identity: clean(entry.identity, 1200), defaultOutfit: clean(entry.outfit, 800) });
    }
    for (const character of characters) {
        const key = character.name.toLowerCase();
        const previous = map.get(key) || {};
        map.set(key, {
            name: character.name,
            identity: character.identity || previous.identity || '',
            defaultOutfit: character.defaultOutfit || previous.defaultOutfit || '',
        });
    }
    return map;
}

export function buildStateTimeline(story = '', parsed = {}, priorMemory = {}) {
    const paragraphs = splitStoryWithSpans(story);
    const registry = registryMap(parsed.characters, priorMemory);
    const outfits = new Map();
    for (const character of registry.values()) if (character.defaultOutfit) outfits.set(character.name.toLowerCase(), character.defaultOutfit);
    let location = '';
    let activeCharacters = [];
    const eventMap = new Map((parsed.events || []).map(event => [event.paragraphIndex, event]));
    const states = paragraphs.map(paragraph => {
        const event = eventMap.get(paragraph.index);
        if (event?.location) location = event.location;
        if (event?.charactersPresent?.length) activeCharacters = event.charactersPresent;
        else {
            const named = [...registry.values()].filter(character => character.name && paragraph.text.includes(character.name)).map(character => character.name);
            if (named.length) activeCharacters = named;
        }
        for (const update of event?.outfitUpdates || []) outfits.set(update.name.toLowerCase(), update.outfit);
        const characters = activeCharacters.map(name => {
            const entry = registry.get(name.toLowerCase()) || { name, identity: '', defaultOutfit: '' };
            return {
                name: entry.name || name,
                identity: entry.identity || '',
                outfit: outfits.get(name.toLowerCase()) || entry.defaultOutfit || '',
            };
        });
        return {
            paragraphIndex: paragraph.index,
            paragraph,
            characters,
            location,
            stage: stageForV5(paragraph.text, event?.stage),
            nsfwLevel: nsfwLevelForV5(paragraph.text, event?.nsfwLevel),
        };
    });
    const memory = {};
    for (const character of registry.values()) {
        memory[character.name] = {
            identity: character.identity || '',
            outfit: outfits.get(character.name.toLowerCase()) || character.defaultOutfit || '',
        };
    }
    return { states, memory, registry: [...registry.values()] };
}

export function buildStateExtractorPrompt({ story = '', card = {}, priorMemory = {} } = {}) {
    const paragraphs = splitStoryWithSpans(story);
    return {
        systemPrompt: `You are a continuity extractor for visual-novel illustrations. Analyze only the numbered story paragraphs supplied by the user. Ignore roleplay instructions, world-book directives, image prompts, styles, uniforms, and assumptions not explicitly supported by those paragraphs or the exact matching character reference. Return strict JSON only.\n\nYour task is factual state tracking, not shot selection. Build one stable identity registry for named visible characters. Then list only real state-changing events: character presence, explicit outfit changes, explicit location changes, and adult stage. An outfit update is allowed only when the same paragraph contains a short exact evidence substring describing clothing, undressing, nudity, or changing clothes. A location update is allowed only when the same paragraph contains exact location evidence. Never invent school uniforms, academy clothing, capes, armor, military coats, or modern clothing. Keep identity stable across the whole reply.`,
        userPrompt: `ACTIVE CHARACTER CARD (use only when this exact name appears):\nname=${clean(card.name, 120) || '(none)'}\nvisual=${clean(card.visual, 1800) || '(none)'}\n\nPRIOR VISUAL MEMORY (exact-name reuse only):\n${clean(JSON.stringify(priorMemory || {}), 2400) || '{}'}\n\nSTORY PARAGRAPHS:\n${paragraphs.map(item => `[P${item.index}] ${item.text}`).join('\n\n')}\n\nReturn exactly:\n{\n  "characters":[{"name":"exact name","identity":"English stable hair, eyes, face, body tags","default_outfit":"English outfit only when established"}],\n  "events":[{\n    "paragraph_index":0,\n    "characters_present":["exact names"],\n    "location":"English location tags or empty",\n    "location_evidence":"exact substring from this paragraph or empty",\n    "outfit_updates":[{"name":"exact name","outfit":"English exact current outfit or nudity tags","evidence":"exact clothing substring from this paragraph"}],\n    "stage":"story_action",\n    "nsfw_level":0\n  }]\n}\n\nUse nsfw_level 0 ordinary, 1 sensual contact, 2 undressing/nudity/explicit touching, 3 explicit sexual action. Never sexualize a minor.`,
    };
}

function normalizeCandidate(raw = {}, story = '', timeline = {}, index = 0) {
    const paragraphs = splitStoryWithSpans(story);
    const paragraphIndex = Math.trunc(clamp(raw.paragraph_index ?? raw.paragraphIndex, 0, Math.max(0, paragraphs.length - 1), -1));
    const paragraph = paragraphs[paragraphIndex];
    if (!paragraph) throw new Error(`candidate ${index + 1}: paragraph_index 无效`);
    const state = timeline.states?.[paragraphIndex] || {};
    const evidence = `${paragraph.text} ${raw.stage || ''} ${raw.action || ''}`;
    const nsfwLevel = nsfwLevelForV5(evidence, raw.nsfw_level ?? raw.nsfwLevel);
    if (nsfwLevel > 0 && MINOR_RE.test(evidence)) throw new Error(`candidate ${index + 1}: 成人镜头含未成年证据`);
    const action = englishTags(raw.action).join(', ');
    const expression = englishTags(raw.expression).join(', ');
    const camera = englishTags(raw.camera).join(', ');
    const atmosphere = englishTags(raw.atmosphere).join(', ');
    if (uniqueTags([action, expression, camera, atmosphere]).length < 5) throw new Error(`candidate ${index + 1}: 画面信息不足`);
    return {
        id: clean(raw.id || `candidate_${index + 1}`, 80),
        paragraphIndex,
        paragraph: paragraph.text,
        anchorSpec: makeAnchorSpec(paragraph),
        sceneBlock: clean(raw.scene_block || raw.sceneBlock || `p${paragraphIndex}`, 120),
        importance: Math.round(clamp(raw.importance, 0, 100, 50)),
        reason: clean(raw.reason, 500),
        stage: stageForV5(evidence, raw.stage || state.stage),
        nsfwLevel,
        mustDraw: Boolean(raw.must_draw ?? raw.mustDraw ?? nsfwLevel > 0),
        action,
        expression,
        camera,
        atmosphere,
        state,
        source: 'director',
    };
}

export function parseDirectorResponse(value = '', story = '', timeline = {}) {
    const raw = extractJson(value);
    const shots = [];
    const errors = [];
    for (const [index, item] of (Array.isArray(raw.candidates) ? raw.candidates : []).entries()) {
        try { shots.push(normalizeCandidate(item, story, timeline, index)); }
        catch (error) { errors.push(String(error?.message || error)); }
    }
    return {
        targetCount: Math.round(clamp(raw.target_count ?? raw.targetCount, 3, 5, 3)),
        shots,
        errors,
        raw,
    };
}

export function buildDirectorPromptV5({ story = '', timeline = {}, minimum = 3, maximum = 5 } = {}) {
    const paragraphs = splitStoryWithSpans(story);
    const compactStates = (timeline.states || []).map(state => ({
        paragraph_index: state.paragraphIndex,
        characters: state.characters,
        location: state.location,
        stage: state.stage,
        nsfw_level: state.nsfwLevel,
    }));
    return {
        systemPrompt: `You are a visual-novel CG director. The continuity state table is already frozen and authoritative. Do not change character identity, outfit, location, or adult level. Analyze the complete reply and propose 8-12 genuinely strong candidate CG moments. Return strict JSON only.\n\nChoose decisive visible action, meaningful interaction, relationship change, combat, emotion, important props in use, outfit/location transitions, and distinct adult stages. Reject ordinary dialogue, empty scenery, male-only portraits, generic standing poses, repeated actions, and candidates that differ only by nearby wording. Do not force equal early/middle/late distribution; quality is primary. Still cover distant strong moments instead of clustering around one local passage. One scene block should normally yield one candidate.\n\nFor adult scenes, candidate action must depict the exact stage from the frozen state: kissing, undressing, nudity, oral/manual action, penetration, position change, climax, or aftercare. Never downgrade an explicit state to an ordinary romantic portrait.`,
        userPrompt: `FROZEN CONTINUITY STATES:\n${JSON.stringify(compactStates)}\n\nSTORY PARAGRAPHS:\n${paragraphs.map(item => `[P${item.index}] ${item.text}`).join('\n\n')}\n\nReturn exactly:\n{\n  "target_count":3,\n  "candidates":[{\n    "id":"c1",\n    "paragraph_index":0,\n    "scene_block":"stable block id",\n    "importance":95,\n    "reason":"why this is one of the best CG moments",\n    "stage":"story_action",\n    "nsfw_level":0,\n    "must_draw":true,\n    "action":"English exact visible action, contact, body positions and props",\n    "expression":"English visible expression tags",\n    "camera":"English framing, angle and composition tags",\n    "atmosphere":"English lighting and atmosphere tags"\n  }]\n}\n\nTarget count must be ${minimum}-${maximum}. Candidate count should be 8-12 when enough drawable events exist. Use only supplied paragraph indices.`,
    };
}

function fallbackAction(text = '', stage = '') {
    const tags = [];
    const add = (pattern, tag) => { if (pattern.test(text)) tags.push(tag); };
    add(/纠正.*(?:握剑|姿势)|手.*覆.*手|握住.*手.*剑/i, 'adult female master guiding her disciple hand over hand, both hands gripping the same wooden sword');
    add(/木剑|练剑|剑招|步法|挥剑/i, 'adult woman practicing swordsmanship with a wooden sword, visible sword stance');
    add(/抚琴|弹琴|琴弦|古琴/i, 'adult woman seated and playing a guqin, both hands touching the strings');
    add(/做鱼|烹鱼|厨房|下厨|烹饪/i, 'adult woman cooking fish in a traditional kitchen, cookware and food visible');
    add(/亲吻|接吻/i, 'adult lovers kissing, lips touching, mutual physical contact');
    add(/拥抱|抱紧|搂住/i, 'adult lovers embracing, visible body contact');
    add(/脱下|解开|褪下/i, 'clearly adult character undressing, clothing visibly being removed');
    add(/全裸|裸体|赤裸/i, 'clearly adult nude character, bare skin');
    add(/口交/i, 'consensual adult oral sex, explicit sexual action');
    add(/手交/i, 'consensual adult handjob, explicit sexual action');
    add(/性交|做爱|性行为|插入|进入她/i, 'consensual adult intercourse, explicit penetration, clear body positioning');
    add(/骑乘|跨坐/i, 'adult woman straddling her partner, cowgirl position');
    add(/后入/i, 'consensual adult rear-entry position');
    add(/高潮|射精/i, 'consensual adult sexual climax, flushed face, visible climax reaction');
    add(/事后|余韵|依偎/i, 'adult lovers embracing during aftercare');
    if (!tags.length) tags.push(stage === 'location_change' ? 'character arriving in the newly established location' : 'clear visible physical action from the selected story paragraph');
    return tags.join(', ');
}

export function buildFallbackCandidatesV5(story = '', timeline = {}) {
    return splitStoryWithSpans(story)
        .map(paragraph => {
            const state = timeline.states?.[paragraph.index] || {};
            const nsfwLevel = nsfwLevelForV5(paragraph.text, state.nsfwLevel);
            const stage = stageForV5(paragraph.text, state.stage);
            return {
                id: `fallback_${paragraph.index}`,
                paragraphIndex: paragraph.index,
                paragraph: paragraph.text,
                anchorSpec: makeAnchorSpec(paragraph),
                sceneBlock: `fallback_${stage}_${paragraph.index}`,
                importance: nsfwLevel === 3 ? 100 : nsfwLevel === 2 ? 96 : nsfwLevel === 1 ? 86 : VISUAL_RE.test(paragraph.text) ? 65 : 35,
                reason: 'local fallback',
                stage,
                nsfwLevel,
                mustDraw: nsfwLevel > 0,
                action: fallbackAction(paragraph.text, stage),
                expression: nsfwLevel > 0 ? 'expression and arousal matching the exact adult scene' : 'expression matching the selected story moment',
                camera: nsfwLevel >= 2 ? 'intimate medium close-up, clear body positions, main action unobstructed' : 'cinematic medium shot, main subjects large in frame, clear action and environment',
                atmosphere: 'lighting and atmosphere matching the selected story moment',
                state,
                source: 'fallback',
            };
        })
        .filter(shot => shot.nsfwLevel > 0 || VISUAL_RE.test(shot.paragraph) || RELATION_RE.test(shot.paragraph) || LOCATION_RE.test(shot.paragraph));
}

function tokenSet(value = '') {
    return new Set(clean(value, 2000).toLowerCase().split(/[^a-z0-9\u3400-\u9fff]+/).filter(token => token.length >= 2));
}

function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    for (const token of a) if (b.has(token)) intersection++;
    return intersection / (a.size + b.size - intersection);
}

function baseScore(shot) {
    let score = Number(shot.importance || 0);
    if (shot.source === 'director') score += 35;
    if (shot.mustDraw) score += 45;
    score += shot.nsfwLevel * 38;
    if (RELATION_RE.test(`${shot.paragraph} ${shot.action}`)) score += 22;
    if (VISUAL_RE.test(`${shot.paragraph} ${shot.action}`)) score += 16;
    if (LOCATION_RE.test(shot.paragraph)) score += 7;
    if (/generic portrait|standing pose|looking at viewer/i.test(shot.action)) score -= 45;
    return score;
}

function similarity(a, b, paragraphCount) {
    let value = 0;
    if (a.sceneBlock === b.sceneBlock) value += 0.7;
    if (a.stage === b.stage) value += 0.18;
    value += jaccard(tokenSet(`${a.action} ${a.paragraph}`), tokenSet(`${b.action} ${b.paragraph}`)) * 0.65;
    const distance = Math.abs(a.paragraphIndex - b.paragraphIndex) / Math.max(1, paragraphCount - 1);
    if (distance < 0.08) value += 0.45;
    else if (distance < 0.18) value += 0.22;
    return Math.min(1.4, value);
}

function desiredCount(story = '', requested = 3, minimum = 3, maximum = 5) {
    const paragraphs = splitStoryWithSpans(story);
    const visual = paragraphs.filter(item => VISUAL_RE.test(item.text) || RELATION_RE.test(item.text)).length;
    const stages = new Set(paragraphs.filter(item => nsfwLevelForV5(item.text) > 0).map(item => stageForV5(item.text)));
    let count = Math.max(minimum, Math.min(maximum, Number(requested) || minimum));
    if (visual >= 7 || stages.size >= 2 || story.length >= 1000) count = Math.max(count, 4);
    if (visual >= 11 || stages.size >= 4 || story.length >= 1800) count = maximum;
    return count;
}

function criticalAdultStages(story = '') {
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
    const paragraphCount = splitStoryWithSpans(story).length;
    const desired = desiredCount(story, requestedCount, minimum, maximum);
    const candidates = [...directorShots, ...fallbackShots]
        .sort((a, b) => (b.source === 'director') - (a.source === 'director') || baseScore(b) - baseScore(a))
        .filter((shot, index, all) => all.findIndex(other => other.paragraphIndex === shot.paragraphIndex && other.stage === shot.stage) === index);
    const selected = [];
    const used = new Set();
    const add = shot => {
        if (!shot || used.has(shot.id) || selected.some(item => item.paragraphIndex === shot.paragraphIndex) || selected.length >= maximum) return false;
        selected.push(shot);
        used.add(shot.id);
        return true;
    };

    const adultStages = criticalAdultStages(story);
    const adultQuota = adultStages.length === 0 ? 0 : desired >= 5 && adultStages.length >= 3 ? 3 : desired >= 4 && adultStages.length >= 2 ? 2 : 1;
    for (const required of adultStages.slice(0, adultQuota)) {
        const match = candidates
            .filter(shot => shot.stage === required.stage || shot.paragraphIndex === required.paragraphIndex)
            .sort((a, b) => baseScore(b) - baseScore(a))[0];
        add(match);
    }

    while (selected.length < desired) {
        let best = null;
        let bestScore = -Infinity;
        for (const candidate of candidates) {
            if (used.has(candidate.id) || selected.some(item => item.paragraphIndex === candidate.paragraphIndex)) continue;
            const maxSimilarity = selected.length ? Math.max(...selected.map(item => similarity(candidate, item, paragraphCount))) : 0;
            const span = selected.length
                ? Math.max(...selected.map(item => Math.abs(item.paragraphIndex - candidate.paragraphIndex))) / Math.max(1, paragraphCount - 1)
                : 0;
            const noveltyBonus = selected.length && span > 0.45 ? 10 : 0;
            const value = baseScore(candidate) + noveltyBonus - maxSimilarity * 72;
            if (value > bestScore) {
                best = candidate;
                bestScore = value;
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
            adultStages,
            selected: selected.map(shot => ({ paragraphIndex: shot.paragraphIndex, score: baseScore(shot), stage: shot.stage, source: shot.source })),
        },
    };
}

function peopleTag(characters = []) {
    const count = characters.length;
    if (count <= 0) return 'story characters';
    if (count === 1) return '1girl';
    if (count === 2) return '2people';
    return `${count}people`;
}

function adultTags(stage, level) {
    if (level === 0) return ['safe non-explicit story scene'];
    const base = level === 1
        ? ['adult romantic intimacy', 'sensual physical contact matching the exact story action']
        : level === 2
            ? ['nsfw', 'clearly adult erotic scene', 'adult nudity or explicit touching matching the exact story action', 'uncensored']
            : ['nsfw', 'explicit consensual adult sexual scene', 'exact sexual action and body positions from the selected story moment', 'uncensored', 'clear physical contact'];
    const map = {
        kiss: ['adult lovers kissing', 'lips touching'],
        embrace: ['adult lovers embracing', 'close body contact'],
        undressing: ['adult character undressing', 'clothing visibly removed', 'bare skin'],
        oral: ['consensual adult oral sex', 'explicit sexual action'],
        manual: ['consensual adult handjob', 'explicit sexual action'],
        penetration: ['consensual adult intercourse', 'explicit penetration', 'clear body positioning'],
        position_change: ['consensual adult sex position', 'clear body positioning'],
        climax: ['adult sexual climax', 'orgasm', 'flushed face', 'visible climax reaction'],
        aftercare: ['adult lovers during aftercare', 'post-coital embrace'],
    };
    return [...base, ...(map[stage] || [])];
}

export function composePromptV5(shot = {}, {
    fixedPositive = DEFAULT_V5_POSITIVE,
    fixedNegative = DEFAULT_V5_NEGATIVE,
    manualCharacterLock = '',
    manualOutfitLock = '',
} = {}) {
    const state = shot.state || {};
    const characterTags = (state.characters || []).flatMap(character => [
        character.name,
        manualCharacterLock || character.identity,
        manualOutfitLock || character.outfit ? `exact current outfit, ${manualOutfitLock || character.outfit}` : '',
    ]);
    let positive = uniqueTags([
        adultTags(shot.stage, shot.nsfwLevel),
        fixedPositive,
        peopleTag(state.characters),
        characterTags,
        state.location ? `exact current location, ${state.location}` : 'location exactly matching the selected story paragraph',
        shot.action,
        shot.expression,
        shot.camera,
        shot.atmosphere,
        'do not change character identity, hair color, eye color, face, body type, outfit, era, or location',
    ]);
    if (!SCHOOL_RE.test(shot.paragraph)) positive = positive.filter(tag => !POLLUTION_RE.test(tag));
    if (ANCIENT_RE.test(shot.paragraph) || ANCIENT_RE.test(state.location)) {
        positive = uniqueTags(['ancient Chinese fantasy, period-accurate Chinese clothing and environment', positive]);
    }
    if (shot.nsfwLevel > 0) positive = positive.filter(tag => !/(?:^|\b)(?:sfw|safe|fully clothed|modest clothing|non-explicit)(?:\b|$)/i.test(tag));

    let negative = uniqueTags([
        fixedNegative,
        shot.nsfwLevel === 0 ? 'nsfw, explicit sex, nude, naked' : 'censored, mosaic censoring, black bars, strategically covered, vague romance, ordinary standing pose',
        !SCHOOL_RE.test(shot.paragraph) ? 'school uniform, academy uniform, student uniform, school blazer, necktie, western military uniform, epaulettes, red cape' : '',
        'different outfit, alternate costume, wrong location, wrong era',
    ]);
    if (shot.nsfwLevel > 0) negative = negative.filter(tag => !/(?:no nudity|no nude|no sex|non-explicit|fully clothed|modest clothing)/i.test(tag));
    return { positive: positive.join(', ').slice(0, 2800), negative: negative.join(', ').slice(0, 2200) };
}

function stableHash(value = '') {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function seedForShotV5(shot = {}, retry = 0) {
    const identity = (shot.state?.characters || []).map(item => `${item.name}:${item.identity}:${item.outfit}`).join('|');
    return Math.max(1, (stableHash(`${identity}|${shot.stage}|${shot.paragraphIndex}`) + Math.max(0, Number(retry) || 0) * 104729) % 2147483647);
}
