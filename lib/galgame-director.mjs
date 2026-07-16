import {
    applyBible,
    buildFallbackPackets,
    compilePrompt,
    createBible,
    extractNarrativeStory,
    hasFemale,
    isDuplicateBeat,
    mergePacketIntoBible,
    normalizedText,
    sanitizePacket,
    serializeBible,
    stableHash,
    stripLegacyImagePromptLines,
} from './director-core.mjs';

export const DIRECTOR_SCHEMA = 1;
export const DEFAULT_DIRECTOR_SETTINGS = Object.freeze({
    enabled: true,
    autoGenerate: true,
    apiUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    minimumShots: 3,
    maximumShots: 6,
    timeoutMs: 9000,
    temperature: 0.2,
    maxTokens: 1800,
});

const SEXUAL_RE = /(?:性交|性行为|做爱|插入|阴茎|阴道|裸体|全裸|口交|手交|高潮|射精|骑乘位|后入|penetrat|intercourse|sexual|oral sex|handjob|vaginal|penis|nude|climax|orgasm|cum|sex\b)/i;
const ADULT_RE = /(?:成年|成人|18\+|1[89]\s*岁|[2-9]\d\s*岁|adult|woman|wife|mother)/i;
const MINOR_RE = /(?:幼女|小女孩|儿童|未成年|小学生|初中生|婴儿|child|minor|underage|loli|elementary school|middle school|\b(?:[0-9]|1[0-7])\s*(?:岁|years? old)\b)/i;
const FEMALE_RE = /(?:她|少女|女孩|女人|女性|女主|姑娘|妻子|女友|姐姐|妹妹|母亲|公主|女王|女仆|\b(?:1girl|2girls|female|woman|women|girl|girls|heroine|wife|girlfriend)\b)/i;
const ACTION_RE = /(?:抓|握|扣|拽|抱|搂|吻|贴|靠|推|拉|扑|跌|跪|坐|站|跑|冲|跃|跳|躲|挥|刺|砍|射|脱|撕|压|抬|拔|挡|斩|劈|撞|转身|回头|触碰|抚摸|流泪|微笑|怒视|进入|抽动|高潮|亲吻|grab|hold|embrace|kiss|touch|press|pull|push|run|jump|fight|strike|block|kneel|sit|stand|undress|penetrat|climax|cry|smile)/gi;
const OLD_PROMPT_RE = /^\s*\[([^\]\n]{40,})\]\s*$/gm;

function clamp(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function text(value, maximum = 1200) {
    return normalizedText(value).slice(0, maximum);
}

function unique(values) {
    return [...new Set(values.map(value => text(value, 420)).filter(Boolean))];
}

function stripCodeFence(value = '') {
    return String(value).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function extractJsonObject(value = '') {
    const clean = stripCodeFence(value);
    try {
        return JSON.parse(clean);
    } catch {
        const first = clean.indexOf('{');
        const last = clean.lastIndexOf('}');
        if (first < 0 || last <= first) throw new Error('导演模型没有返回 JSON');
        return JSON.parse(clean.slice(first, last + 1));
    }
}

export function normalizeDirectorSettings(input = {}) {
    return {
        ...DEFAULT_DIRECTOR_SETTINGS,
        ...input,
        enabled: input.enabled !== false,
        autoGenerate: input.autoGenerate !== false,
        apiUrl: String(input.apiUrl || DEFAULT_DIRECTOR_SETTINGS.apiUrl).replace(/\/+$/, ''),
        apiKey: String(input.apiKey || ''),
        model: String(input.model || DEFAULT_DIRECTOR_SETTINGS.model),
        minimumShots: Math.round(clamp(input.minimumShots, 1, 4, DEFAULT_DIRECTOR_SETTINGS.minimumShots)),
        maximumShots: Math.round(clamp(input.maximumShots, 3, 6, DEFAULT_DIRECTOR_SETTINGS.maximumShots)),
        timeoutMs: Math.round(clamp(input.timeoutMs, 3000, 20000, DEFAULT_DIRECTOR_SETTINGS.timeoutMs)),
        temperature: clamp(input.temperature, 0, 1, DEFAULT_DIRECTOR_SETTINGS.temperature),
        maxTokens: Math.round(clamp(input.maxTokens, 600, 3000, DEFAULT_DIRECTOR_SETTINGS.maxTokens)),
    };
}

export function cleanStory(raw = '') {
    return extractNarrativeStory(stripLegacyImagePromptLines(String(raw).replace(OLD_PROMPT_RE, '')));
}

export function desiredShotCount(story, settings = {}) {
    const config = normalizeDirectorSettings(settings);
    const clean = cleanStory(story);
    if (!hasFemale(clean) && !FEMALE_RE.test(clean)) return 0;
    const actions = clean.match(ACTION_RE)?.length || 0;
    const paragraphs = clean.split(/\n\s*\n|\n/).filter(line => text(line).length >= 16).length;
    if (clean.length < 70) return 1;
    if (clean.length < 120) return Math.min(2, config.maximumShots);
    const extra = Math.floor(Math.max(0, actions - 7) / 4) + Math.floor(Math.max(0, paragraphs - 7) / 3);
    return Math.min(config.maximumShots, Math.max(config.minimumShots, config.minimumShots + extra));
}

export function buildDirectorMessages({ story, lastUserMessage = '', bible = {}, settings = {} }) {
    const config = normalizeDirectorSettings(settings);
    const clean = cleanStory(story).slice(0, 9000);
    const wanted = desiredShotCount(clean, config);
    const system = `You are a fast storyboard director for an anime visual-novel image generator. Return one strict JSON object only, with keys "characters" and "scenes". Do not explain.

Select ${wanted} shots when the reply has enough genuinely different visual beats; never exceed ${config.maximumShots}. Cover the whole reply: normally one strong beat from the early, middle, and late portions; fast multi-stage plots may use 4-6. Never front-load all shots. A continuous pose or repeated action is one shot even if described in several paragraphs. Each next shot must summarize the plot window after the previous shot and depict that window's most cinematic, emotionally strong, visible instant. Do not miss an actual action/stage change.

Every scene must contain at least one woman who actually appears before that anchor. Never output a male-only, scenery-only, building-only, object-only, or invented-person scene. If a man is relevant, show him interacting with the woman rather than alone. Do not use future events. Adult consensual NSFW is allowed and should follow the exact current stage. Sexual scenes are forbidden if any depicted person's age is minor or not clearly adult.

For each character return: {"name":"stable story name","english_name":"stable English name","sex":"female|male","age":"adult|minor|unknown","identity":"concise immutable English Danbooru appearance tags: age, build, skin, face, hair style/color, eye color","outfit":"current visible English clothing tags","outfit_changed":false}. Reuse locked identity byte-for-byte unless the story explicitly transforms appearance. Carry clothing forward unless this reply explicitly changes it.

For each scene return: {"anchor":"an exact 12-80 character verbatim substring ending at or just after the chosen story instant","female_names":["names"],"stage":"short unique action/stage key","action_key":"concise subject-action-object-result","people":"1girl|1girl, 1boy|2girls","prompt":"concise English Danbooru/action/location/composition tags for exactly that instant","safety":"safe|nsfw|explicit"}. Anchors must occur verbatim in STORY. Prompts must keep the named woman's identity and outfit, show both characters when interacting, and use a dynamic visual-novel event-CG composition.

Physical accuracy is mandatory. Put the exact subject + body part + contact + direction + visible result at the start of action_key and prompt. Distinguish wrist-grabbing from hand-holding, hugging, or merely standing close; distinguish feeding from holding food; distinguish an attempted action from its completed result. Describe where both characters' hands, mouths, bodies, and relevant props are in the decisive frame. Prefer one unambiguous action over a bag of vague mood tags. Never soften, replace, or skip a key action just because a nearby pose is easier to draw.`;
    const user = `LOCKED CHARACTER BIBLE (authoritative; may be empty):
${serializeBible(bible, 3600) || '(empty)'}

LAST USER MESSAGE (context only; never anchor here):
${text(lastUserMessage, 1600) || '(none)'}

STORY TO STORYBOARD:
${clean}`;
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function characterFromModel(raw = {}) {
    const name = text(raw.name || raw.id || raw.english_name, 80);
    if (!name) return null;
    const sex = text(raw.sex, 16).toLowerCase();
    const age = text(raw.age, 16).toLowerCase();
    return {
        id: name,
        prompt_name: text(raw.english_name || name, 80),
        sex: sex === 'male' ? 'male' : 'female',
        age: ['adult', 'minor', 'unknown'].includes(age) ? age : 'unknown',
        dna: text(raw.identity || raw.dna, 620),
        outfit: text(raw.outfit, 360),
        identity_change: Boolean(raw.identity_changed || raw.identity_change),
        outfit_change: Boolean(raw.outfit_changed || raw.outfit_change),
    };
}

function isSexualMinor(packet, charactersByName, windowText = '') {
    if (!SEXUAL_RE.test(`${packet.safety} ${packet.action} ${packet.quote} ${windowText}`)) return false;
    return (packet.cast || []).some(cast => {
        const item = charactersByName.get(cast.id.toLowerCase());
        const evidence = `${item?.age || ''} ${cast.dna || ''}`;
        return item?.age === 'minor' || MINOR_RE.test(evidence) || (!ADULT_RE.test(evidence) && item?.age !== 'adult');
    });
}

function sourceIndex(story, anchor, after = 0) {
    const exact = story.indexOf(anchor, after);
    if (exact >= 0) return exact;
    const compact = text(anchor, 100);
    if (compact.length < 8) return -1;
    return story.indexOf(compact, after);
}

export function parseDirectorResponse(rawContent, { story, bible = createBible(), settings = {} } = {}) {
    const config = normalizeDirectorSettings(settings);
    const clean = cleanStory(story);
    const data = typeof rawContent === 'string' ? extractJsonObject(rawContent) : rawContent;
    const characters = (Array.isArray(data?.characters) ? data.characters : [])
        .map(characterFromModel).filter(Boolean);
    const charactersByName = new Map();
    for (const character of characters) {
        charactersByName.set(character.id.toLowerCase(), character);
        charactersByName.set(character.prompt_name.toLowerCase(), character);
    }

    const prepared = [];
    let cursor = 0;
    for (const [index, scene] of (Array.isArray(data?.scenes) ? data.scenes : []).entries()) {
        const anchor = text(scene?.anchor, 160);
        const position = sourceIndex(clean, anchor, cursor);
        if (position < 0) continue;
        cursor = position + anchor.length;
        const requestedNames = Array.isArray(scene.female_names) ? scene.female_names : [];
        const cast = unique(requestedNames).map(name => charactersByName.get(name.toLowerCase()))
            .filter(item => item?.sex !== 'male');
        if (!cast.length && requestedNames.length > 0 && FEMALE_RE.test(anchor)) {
            const onlyFemale = characters.filter(item => item.sex !== 'male');
            if (onlyFemale.length === 1) cast.push(onlyFemale[0]);
        }
        if (!cast.length) continue;
        const packet = sanitizePacket({
            id: `director_${index + 1}_${stableHash(anchor).toString(36)}`,
            quote: anchor,
            people: text(scene.people, 40) || (/(?:他|男人|男主|1boy|male)/i.test(anchor) ? '1girl, 1boy' : '1girl'),
            cast,
            action: text(scene.action_key || scene.prompt, 680),
            setting: text(scene.prompt, 620),
            expression: text(scene.expression, 220),
            composition: text(scene.composition, 260) || 'dynamic anime visual novel event CG, decisive instant, clear female subject',
            stage: text(scene.stage, 60) || `beat_${index + 1}`,
            safety: text(scene.safety, 20),
        }, index);
        const storyWindow = clean.slice(prepared.at(-1)?.end || 0, position + anchor.length);
        if (isSexualMinor(packet, charactersByName, storyWindow)) continue;
        if (prepared.some(item => item.packet.stage === packet.stage
            && item.packet.cast.map(value => value.id.toLowerCase()).join('|') === packet.cast.map(value => value.id.toLowerCase()).join('|'))
            || isDuplicateBeat(packet, prepared.map(item => item.packet))) continue;
        const locked = applyBible(packet, bible);
        const compiled = compilePrompt(locked, bible);
        prepared.push({
            packet: locked,
            anchor,
            position,
            end: position + anchor.length,
            prompt: compiled.positive,
            negative: compiled.negative,
        });
        if (prepared.length >= config.maximumShots) break;
    }
    return { characters, scenes: prepared, raw: data };
}

function fallbackScenes(story, bible, maximum) {
    const known = Object.values(bible || {}).find(item => hasFemale(`${item.id} ${item.prompt_name} ${item.dna}`));
    const packets = buildFallbackPackets(story, {
        bible,
        characterName: known?.id || '',
        characterVisual: known?.dna || '',
        maximum,
    });
    const clean = cleanStory(story);
    let cursor = 0;
    return packets.map(packet => {
        const position = sourceIndex(clean, packet.quote, cursor);
        cursor = Math.max(cursor, position + packet.quote.length);
        const compiled = compilePrompt(packet, bible);
        return { packet, anchor: packet.quote, position, end: position + packet.quote.length, prompt: compiled.positive, negative: compiled.negative };
    }).filter(scene => scene.position >= 0);
}

export function completeScenes({ story, parsedScenes = [], bible = createBible(), settings = {} }) {
    const config = normalizeDirectorSettings(settings);
    const wanted = desiredShotCount(story, config);
    if (!wanted) return [];
    const merged = [...parsedScenes];
    if (merged.length < wanted) {
        for (const fallback of fallbackScenes(story, bible, config.maximumShots)) {
            if (merged.some(scene => scene.anchor === fallback.anchor || isDuplicateBeat(fallback.packet, merged.map(item => item.packet)))) continue;
            merged.push(fallback);
        }
    }
    merged.sort((a, b) => a.position - b.position);
    return merged.slice(0, config.maximumShots);
}

export function mergeCharactersIntoBible(bible = createBible(), characters = []) {
    for (const character of characters) {
        if (character.sex === 'male') continue;
        mergePacketIntoBible(bible, { cast: [character] });
    }
    return bible;
}

export function insertInlinePrompts(rawMessage, scenes = []) {
    let result = String(rawMessage || '');
    const insertions = [];
    let cursor = 0;
    for (const scene of [...scenes].sort((a, b) => a.position - b.position)) {
        const anchor = String(scene.anchor || '');
        const index = result.indexOf(anchor, cursor);
        if (index < 0 || !scene.prompt) continue;
        const end = index + anchor.length;
        cursor = end;
        insertions.push({ index: end, marker: `\n\n[${String(scene.prompt).replace(/[\[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim()}]\n\n` });
    }
    for (const insertion of insertions.sort((a, b) => b.index - a.index)) {
        const nearby = result.slice(insertion.index, insertion.index + insertion.marker.length + 16);
        if (nearby.includes(insertion.marker.trim())) continue;
        result = result.slice(0, insertion.index) + insertion.marker + result.slice(insertion.index);
    }
    return { message: result.replace(/\n{4,}/g, '\n\n\n'), inserted: insertions.length };
}

export function processingKey(rawMessage) {
    return stableHash(cleanStory(rawMessage)).toString(36);
}
