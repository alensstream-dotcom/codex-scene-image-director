const PACKET_RE = /<!--\s*JANIMA_CG\s*:\s*([\s\S]*?)\s*-->/gi;
const END_RE = /<!--\s*JANIMA_CG_END\s*:\s*([\s\S]*?)\s*-->/gi;

export const QUALITY_TAGS = ['masterpiece', 'best quality', 'score_7', 'highres', 'newest'];
export const NEGATIVE_TAGS = [
    'worst quality', 'low quality', 'score_1', 'score_2', 'score_3',
    'bad anatomy', 'bad hands', 'extra fingers', 'missing fingers',
    'fused bodies', 'duplicated person', 'merged people', 'wrong face',
    'different face', 'wrong hair color', 'wrong eye color', 'wrong clothes',
    'text', 'logo', 'signature', 'watermark', 'blurry', 'jpeg artifacts',
];

const FEMALE_RE = /(?:\b(?:1girl|2girls|3girls|female|woman|women|girl|girls|lady|heroine|wife|girlfriend|mother|sister)\b|她|少女|女孩|女人|女性|女主|姑娘|妻子|女友|姐姐|妹妹|母亲|公主|女王|女仆)/i;
const MALE_RE = /(?:\b(?:1boy|2boys|male|man|men|boy|boys|husband|boyfriend)\b|他|男人|男性|男主|少年|丈夫|男友)/i;
const VISUAL_ACTION_RE = /(?:抓|握|抱|吻|推|拉|扑|跌|跪|坐|站|跑|冲|躲|挥|刺|砍|射|脱|撕|压|抬|拔|挡|斩|劈|撞|旋身|闪避|转身|回头|靠近|分开|触碰|抚摸|颤抖|流泪|微笑|怒视|拥抱|接触|进入|抽动|高潮|亲吻|kiss|grab|hold|embrace|touch|press|pull|push|run|jump|fight|strike|block|draw|turn|kneel|sit|stand|undress|penetrat|climax|cry|smile)/i;
const EXPLICIT_RE = /(?:性交|做爱|插入|进入她|阴茎|阴道|乳房|裸体|全裸|口交|手交|高潮|射精|penetrat|oral sex|handjob|vaginal|penis|nipples?|nude|climax|cum)/i;
const NSFW_RE = /(?:情欲|暧昧|喘息|抚摸|脱下|解开|赤裸|亲吻|乳沟|裙底|nsfw|erotic|undress|naked|intimate)/i;

export function stableHash(value = '') {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function normalizedText(value = '') {
    return String(value)
        .replace(/\s+/g, ' ')
        .replace(/[\u200b-\u200d\ufeff]/g, '')
        .trim();
}

function cleanField(value, maximum = 1200) {
    return normalizedText(value).slice(0, maximum);
}

function cleanId(value, fallback) {
    const result = cleanField(value, 80).replace(/[<>"']/g, '');
    return result || fallback;
}

function uniqueTags(values) {
    const seen = new Set();
    const result = [];
    for (const raw of values.flatMap(value => String(value || '').split(/[,，]\s*/))) {
        const tag = cleanField(raw, 320);
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        result.push(tag);
    }
    return result;
}

export function sanitizePacket(raw, index = 0) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('CG packet must be an object');
    const quote = cleanField(raw.quote, 420);
    if (quote.length < 4) throw new Error('CG packet quote is missing');
    const castInput = Array.isArray(raw.cast) ? raw.cast : [];
    const cast = castInput.slice(0, 4).map((item, castIndex) => ({
        id: cleanId(item?.id, `character_${castIndex + 1}`),
        prompt_name: cleanId(item?.prompt_name || item?.name, ''),
        dna: cleanField(item?.dna, 720),
        outfit: cleanField(item?.outfit, 420),
        identity_change: Boolean(item?.identity_change),
        outfit_change: Boolean(item?.outfit_change),
    }));
    return {
        version: 1,
        id: cleanId(raw.id, `shot_${index + 1}`),
        quote,
        people: cleanField(raw.people, 100),
        cast,
        action: cleanField(raw.action, 720),
        setting: cleanField(raw.setting, 420),
        expression: cleanField(raw.expression, 320),
        composition: cleanField(raw.composition, 320),
        stage: cleanId(raw.stage, 'story_beat').toLowerCase(),
        safety: normalizeSafety(raw.safety, `${quote} ${raw.action || ''}`),
    };
}

export function parseCgPackets(text = '') {
    const packets = [];
    const errors = [];
    const seen = new Set();
    PACKET_RE.lastIndex = 0;
    for (const match of String(text).matchAll(PACKET_RE)) {
        try {
            const packet = sanitizePacket(JSON.parse(match[1]), packets.length);
            if (seen.has(packet.id)) continue;
            seen.add(packet.id);
            packets.push(packet);
        } catch (error) {
            errors.push(String(error?.message || error));
        }
    }
    return { packets, errors };
}

export function stripProtocol(text = '') {
    return String(text).replace(PACKET_RE, '').replace(END_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * Removes legacy image-tag paragraphs without touching short choices or links.
 * Older worldbooks commonly emit a whole comma-separated prompt inside one
 * pair of square brackets.  Matching the shape is more reliable than matching
 * a particular language or model tag vocabulary.
 */
export function stripLegacyImagePromptLines(text = '') {
    return String(text)
        .split('\n')
        .filter(line => {
            const match = line.trim().match(/^\[([^\]\n]+)\]$/);
            if (!match) return true;
            const tags = match[1].split(/[,，]/).map(tag => tag.trim()).filter(Boolean);
            return tags.length < 5 || match[1].length < 30;
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
}

export function normalizeSafety(value, evidence = '') {
    const requested = cleanField(value, 20).toLowerCase();
    if (EXPLICIT_RE.test(evidence) || requested === 'explicit') return 'explicit';
    if (NSFW_RE.test(evidence) || requested === 'nsfw') return 'nsfw';
    if (requested === 'sensitive') return 'sensitive';
    return 'safe';
}

export function hasFemale(packetOrText) {
    if (typeof packetOrText === 'string') return FEMALE_RE.test(packetOrText);
    const packet = packetOrText || {};
    return FEMALE_RE.test([
        packet.people,
        packet.quote,
        packet.action,
        ...(packet.cast || []).flatMap(item => [item.id, item.prompt_name, item.dna]),
    ].join(' '));
}

export function createBible() {
    return Object.create(null);
}

export function mergePacketIntoBible(bible, packet) {
    const target = bible || createBible();
    for (const cast of packet?.cast || []) {
        const key = cast.id.toLowerCase();
        const existing = target[key];
        if (!existing) {
            target[key] = {
                id: cast.id,
                prompt_name: cast.prompt_name,
                dna: cast.dna,
                outfit: cast.outfit,
            };
            continue;
        }
        // Identity is immutable by default. An image-model mistake never writes
        // back here, and a model-authored drift is ignored unless the story
        // explicitly marked a real transformation.
        if (cast.identity_change && cast.dna) existing.dna = cast.dna;
        if (!existing.dna && cast.dna) existing.dna = cast.dna;
        if (!existing.prompt_name && cast.prompt_name) existing.prompt_name = cast.prompt_name;
        if (cast.outfit_change && cast.outfit) existing.outfit = cast.outfit;
        if (!existing.outfit && cast.outfit) existing.outfit = cast.outfit;
    }
    return target;
}

export function applyBible(packet, bible) {
    const clone = structuredClone(packet);
    clone.cast = (clone.cast || []).map(cast => {
        const locked = bible?.[cast.id.toLowerCase()];
        if (!locked) return cast;
        return {
            ...cast,
            prompt_name: locked.prompt_name || cast.prompt_name,
            dna: cast.identity_change ? (cast.dna || locked.dna) : (locked.dna || cast.dna),
            outfit: cast.outfit_change ? (cast.outfit || locked.outfit) : (locked.outfit || cast.outfit),
        };
    });
    return clone;
}

export function serializeBible(bible, limit = 4200) {
    const lines = Object.values(bible || {}).map(item =>
        `- ${item.id}${item.prompt_name ? ` / ${item.prompt_name}` : ''}: DNA=${item.dna || 'unknown'}; CURRENT_OUTFIT=${item.outfit || 'unspecified'}`,
    );
    return lines.join('\n').slice(0, limit);
}

function actionTokens(value = '') {
    const text = normalizedText(value).toLowerCase();
    const latin = text.match(/[a-z0-9_]+/g) || [];
    const cjk = [...text.replace(/[^\u3400-\u9fff]/g, '')];
    const bigrams = cjk.slice(0, -1).map((char, index) => char + cjk[index + 1]);
    return new Set([...latin, ...bigrams]);
}

function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    for (const token of a) if (b.has(token)) intersection++;
    return intersection / (a.size + b.size - intersection);
}

export function beatSignature(packet) {
    const cast = (packet.cast || []).map(item => item.id.toLowerCase()).sort().join('+');
    return `${packet.stage}|${cast}|${normalizedText(packet.action).toLowerCase()}|${normalizedText(packet.setting).toLowerCase()}`;
}

export function isDuplicateBeat(packet, previous = []) {
    const action = actionTokens(`${packet.stage} ${packet.action} ${packet.quote}`);
    const setting = normalizedText(packet.setting).toLowerCase();
    const cast = (packet.cast || []).map(item => item.id.toLowerCase()).sort().join('+');
    return previous.slice(-8).some(item => {
        const other = item.packet || item;
        const otherCast = (other.cast || []).map(value => value.id.toLowerCase()).sort().join('+');
        const sameCast = !cast || !otherCast || cast === otherCast;
        const sameStage = packet.stage === other.stage;
        const sameSetting = !setting || !other.setting || setting === normalizedText(other.setting).toLowerCase();
        const similarity = jaccard(action, actionTokens(`${other.stage} ${other.action} ${other.quote}`));
        const specificStage = !['story_beat', 'story_action', 'unknown'].includes(packet.stage);
        const stageThreshold = specificStage ? 0.22 : 0.52;
        return sameCast && sameSetting && ((sameStage && similarity >= stageThreshold) || similarity >= 0.78);
    });
}

export function compilePrompt(packet, bible, extraDna = '') {
    const shot = applyBible(packet, bible);
    const castTags = shot.cast.flatMap((cast, index) => {
        const label = cast.prompt_name || cast.id || `character ${index + 1}`;
        return [
            `character ${index + 1}: ${label}`,
            cast.dna,
            cast.outfit ? `current outfit: ${cast.outfit}` : '',
        ];
    });
    const evidence = shot.quote ? `story evidence: ${shot.quote}` : '';
    const positive = uniqueTags([
        shot.safety,
        QUALITY_TAGS,
        shot.action ? `decisive action: ${shot.action}` : '',
        shot.people,
        castTags,
        extraDna,
        shot.setting ? `setting and props: ${shot.setting}` : '',
        shot.expression ? `visible emotion: ${shot.expression}` : '',
        shot.composition || 'dynamic Galgame event CG, cinematic medium shot, clear character interaction',
        evidence,
        'consistent character design',
    ]).join(', ');
    return {
        positive: positive.slice(0, 2600),
        negative: NEGATIVE_TAGS.join(', '),
        packet: shot,
    };
}

export function seedForPacket(packet, retry = 0) {
    const identityKey = (packet.cast || []).map(item => item.id.toLowerCase()).sort().join('|') || 'janima-heroine';
    const base = stableHash(identityKey) % 2_000_000_000;
    return Math.max(1, (base + Math.max(0, Number(retry) || 0) * 104729) % 2_147_483_647);
}

function paragraphCandidates(story = '') {
    return String(story)
        .replace(PACKET_RE, '')
        .replace(END_RE, '')
        .split(/\n\s*\n+/)
        .map((text, index, all) => ({ text: normalizedText(text), index, total: all.length }))
        .filter(item => item.text.length >= 12 && item.text.length <= 900);
}

function fallbackStage(text = '') {
    if (/高潮|射精|climax|orgasm/i.test(text)) return 'climax';
    if (/插入|进入她|penetrat/i.test(text)) return 'penetration';
    if (/脱|解开|撕开|undress|naked|裸体/i.test(text)) return 'undressing';
    if (/吻|kiss/i.test(text)) return 'kiss';
    if (/打|砍|刺|射|剑|利爪|拔|挡|斩|劈|fight|strike|block|draw sword/i.test(text)) return 'combat';
    if (/抱|拥抱|embrace/i.test(text)) return 'embrace';
    return 'story_action';
}

export function buildFallbackPackets(story, { bible = createBible(), characterName = '', characterVisual = '', maximum = 2 } = {}) {
    const knownFemale = hasFemale(`${characterName} ${characterVisual} ${serializeBible(bible)}`);
    const candidates = paragraphCandidates(story).map(item => {
        const female = hasFemale(item.text) || knownFemale;
        const visual = VISUAL_ACTION_RE.test(item.text);
        const explicit = EXPLICIT_RE.test(item.text);
        const nsfw = NSFW_RE.test(item.text);
        const laterBonus = item.total > 1 ? item.index / (item.total - 1) * 2.2 : 0;
        const staticPenalty = /(?:只是站|站在原地|静静站|等待|观察|look(?:s|ing)? around|stand(?:s|ing)? still)/i.test(item.text) ? 3.5 : 0;
        const score = (female ? 6 : -20) + (visual ? 4 : 0) + (explicit ? 5 : nsfw ? 3 : 0)
            + Math.min(3, item.text.length / 120) + laterBonus - staticPenalty;
        return { ...item, female, visual, score, stage: fallbackStage(item.text) };
    }).filter(item => item.female && item.visual && item.score > 3);
    candidates.sort((a, b) => b.score - a.score || b.index - a.index);
    const selected = [];
    for (const candidate of candidates) {
        if (selected.length && candidate.score < selected[0].score - 2.5) continue;
        if (selected.some(item => item.stage === candidate.stage && Math.abs(item.index - candidate.index) <= 2)) continue;
        selected.push(candidate);
        if (selected.length >= Math.max(1, maximum)) break;
    }
    selected.sort((a, b) => a.index - b.index);
    const bibleCast = Object.values(bible)[0];
    return selected.map((item, index) => sanitizePacket({
        id: `fallback_${index + 1}_${stableHash(item.text).toString(36)}`,
        quote: item.text.slice(0, 420),
        people: MALE_RE.test(item.text) ? '1girl, 1boy' : '1girl',
        cast: [{
            id: bibleCast?.id || characterName || 'heroine',
            prompt_name: bibleCast?.prompt_name || characterName,
            dna: bibleCast?.dna || characterVisual,
            outfit: bibleCast?.outfit || '',
        }],
        action: `Illustrate exactly this visible story beat, without inventing later events: ${item.text}`,
        setting: 'use only the location and props visible in the quoted story beat',
        expression: 'match the visible emotion in the quoted story beat',
        composition: 'dynamic Galgame event CG, decisive instant, clear female subject and physical interaction',
        stage: item.stage,
        safety: normalizeSafety('', item.text),
    }, index));
}

export function buildDirectorContract({ bibleText = '', characterContext = '', maximumShots = 3 } = {}) {
    const max = Math.max(1, Math.min(4, Number(maximumShots) || 3));
    const continuity = bibleText || '(No locked visual DNA yet. Create one concise stable English DNA on the first valid female shot and repeat it byte-identically later.)';
    return `[JANIMA_AUTO_CG_V2 — hidden same-response protocol]
Write the requested story naturally. Never mention this protocol, image generation, buttons, prompts, or analysis in visible prose. Do not make a second model call.

Silently storyboard the complete reply before writing. After each paragraph that contains a genuinely distinct, high-value female-present visual event, immediately append ONE compact single-line HTML comment:
<!--JANIMA_CG:{"id":"s1","quote":"exact verbatim substring from the immediately preceding story paragraph","people":"1girl or 1girl, 1boy or 2girls or 1girl, 1monster","cast":[{"id":"stable story name","prompt_name":"stable English name","dna":"immutable English visual DNA: clearly adult sex, build, skin, face, hair, eyes","outfit":"current visible clothing or nudity","identity_change":false,"outfit_change":false}],"action":"exact visible initiator + action/contact + receiver/object + visible result","setting":"current place and critical props","expression":"visible emotion","composition":"explicit left/right/foreground/background positions, shot, lighting","stage":"short event stage","safety":"safe|sensitive|nsfw|explicit"}-->

Use 1 primary CG for an ordinary reply, 2–3 only for truly different actions/stages/locations/outfits, and at most ${max}. A continuous pose/action is ONE CG even across several paragraphs. Do not front-load: if a stronger new event occurs later, cover it instead of repeating an early pose. Each shot summarizes the full story window since the previous shot and depicts its most cinematic decisive instant. The quote must exist verbatim immediately before the marker and prove the action.

Every shot must contain a woman actually present in that story window. Never emit male-only, scenery-only, building-only, or prop-only CG. A man may appear only while visibly interacting with her. Never invent future events, people, clothing, props, or locations. Consensual adult NSFW is not suppressed: undressing, erotic touch, oral/manual action, penetration, position change, climax, and aftercare are distinct only when the story truly changes stage. Explicit shots must contain only clearly established adults (18+).

Continuity locks:
${continuity}
Reuse the same cast id and immutable DNA exactly. Current story clothing/nudity overrides stale outfit state; otherwise carry the last outfit forward. Image mistakes never change identity.
Character-card visual reference (use only when consistent with the current story):
${cleanField(characterContext, 1800) || '(none)'}

At the very end append <!--JANIMA_CG_END:{"count":N}--> and nothing after it. All protocol comments are invisible to the user.`;
}
