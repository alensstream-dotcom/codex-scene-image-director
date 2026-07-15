import { ANIMA_NATIVE_QUALITY_TAGS, ANIMA_SAFETY_TAGS } from './anima-workflow.mjs';
import {
    extractImagePrompts,
    paragraphRanges,
    parseDeclaredImageCount,
    reinforcePromptLocal,
    storyActionPhase,
    storyActionTypes,
} from './rescue-core.mjs';

const PACKET_RE = /<!--\s*JANIMA_SHOT\s*:\s*(\{[\s\S]*?\})\s*-->/g;
const STORYBOARD_RE = /<!--\s*JANIMA_STORYBOARD_V2\s*:\s*(\{[\s\S]*?\})\s*-->/g;
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const FEMALE_STORY_RE = /(?:她|她们|少女|女孩|女生|女人|女性|女士|姑娘|女王|女皇|公主|圣女|魔女|女仆|姐姐|妹妹|母亲|妻子|女友|女朋友|老婆|新娘|\b(?:she|her|woman|women|girl|girls|female|lady|queen|princess|witch|maid|wife|girlfriend|bride)\b)/i;
const FEMALE_DNA_RE = /\b(?:adult woman|adult women|woman|women|girl|girls|female)\b/i;
const PEOPLE_RE = /^(?:[1-6]girls?|1girl and 1boy|2girls and 1boy|3girls and 1boy)$/i;
const CHANGE_RE = /(?:变身|变化|变成|染成|剪短|长出|失去|疤痕|换脸|换了?身体|换上|换下|脱下|解开|撕开|衣.{0,4}(?:滑落|散开)|裸体|赤裸|\b(?:transform(?:s|ed|ing)?|change[sd]? (?:her |his )?(?:appearance|body|hair|eyes)|dyed? (?:her |his )?hair|cut (?:her |his )?hair|grew (?:horns|wings|a tail)|change[sd]? into|remove[sd]? .*clothes|undress(?:es|ed|ing)?|unbutton(?:s|ed|ing)?|nude|naked)\b)/i;
const OUTFIT_CHANGE_RE = /(?:换上|换下|脱下|解开|撕开|衣.{0,4}(?:滑落|散开)|裸体|赤裸|\b(?:change[sd]? into|remove[sd]? .*clothes|undress(?:es|ed|ing)?|unbutton(?:s|ed|ing)?|nude|naked)\b)/i;
const ADULT_PHASES = new Set(['erotic_touch', 'manual_stimulation', 'oral_sex', 'penetration', 'position_change', 'climax']);
const REQUIRED_STRINGS = ['id', 'quote', 'people', 'action', 'setting', 'expression', 'composition', 'safety'];
const ENGLISH_FIELDS = ['prompt_name', 'dna', 'outfit'];
const QUOTE_PUNCTUATION = new Map([
    ['。', '.'], ['，', ','], ['、', ','], ['；', ';'], ['：', ':'],
    ['！', '!'], ['？', '?'], ['“', '"'], ['”', '"'], ['‘', "'"], ['’', "'"],
    ['（', '('], ['）', ')'], ['【', '['], ['】', ']'], ['—', '-'], ['…', '...'],
]);

function clean(value, maximum = 500) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function clonePacket(value) {
    return JSON.parse(JSON.stringify(value));
}

function canonicalQuoteView(value = '') {
    const characters = [];
    const starts = [];
    const ends = [];
    let offset = 0;
    for (const rawCharacter of String(value)) {
        const start = offset;
        offset += rawCharacter.length;
        if (/\s/u.test(rawCharacter)) continue;
        const normalized = QUOTE_PUNCTUATION.get(rawCharacter) || rawCharacter.normalize('NFKC');
        for (const character of normalized) {
            characters.push(QUOTE_PUNCTUATION.get(character) || character);
            starts.push(start);
            ends.push(offset);
        }
    }
    return { value: characters.join(''), starts, ends };
}

/**
 * Finds a quote only inside the supplied story range. Exact text remains the
 * first choice; the fallback tolerates whitespace plus Chinese/ASCII
 * punctuation changes without permitting a paraphrase or a ledger self-match.
 */
export function findQuoteEvidence(text = '', quote = '', options = {}) {
    const source = String(text).replace(/\r\n?/g, '\n');
    const needle = String(quote ?? '').trim();
    const from = Math.max(0, Math.min(source.length, Number(options.from || 0)));
    const to = Math.max(from, Math.min(source.length, Number(options.to ?? source.length)));
    const preferLast = options.preferLast === true;
    if (!needle) return { start: -1, end: -1, exact: false };

    const segment = source.slice(from, to);
    const exactIndex = preferLast ? segment.lastIndexOf(needle) : segment.indexOf(needle);
    if (exactIndex >= 0) {
        return { start: from + exactIndex, end: from + exactIndex + needle.length, exact: true };
    }

    const haystack = canonicalQuoteView(segment);
    const canonicalNeedle = canonicalQuoteView(needle).value;
    if (!canonicalNeedle) return { start: -1, end: -1, exact: false };
    const canonicalIndex = preferLast
        ? haystack.value.lastIndexOf(canonicalNeedle)
        : haystack.value.indexOf(canonicalNeedle);
    if (canonicalIndex < 0) return { start: -1, end: -1, exact: false };
    return {
        start: from + haystack.starts[canonicalIndex],
        end: from + haystack.ends[canonicalIndex + canonicalNeedle.length - 1],
        exact: false,
    };
}

function packetCast(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 6).map(item => ({
        id: clean(item?.id, 80),
        prompt_name: clean(item?.prompt_name, 80),
        dna: clean(item?.dna, 420),
        outfit: clean(item?.outfit, 260),
        identity_change: item?.identity_change === true,
        outfit_change: item?.outfit_change === true,
    }));
}

export function normalizeShotPacket(value = {}) {
    return {
        id: clean(value.id, 40),
        // Preserve interior whitespace so "verbatim" really means byte-for-byte
        // evidence from the story, not a whitespace-normalized paraphrase.
        quote: String(value.quote ?? '').trim().slice(0, 360),
        people: clean(value.people, 60),
        cast: packetCast(value.cast),
        action: clean(value.action, 420),
        setting: clean(value.setting, 260),
        expression: clean(value.expression, 260),
        composition: clean(value.composition, 320),
        safety: clean(value.safety, 24).toLowerCase(),
        ...(clean(value.style, 80) ? { style: clean(value.style, 80) } : {}),
    };
}

export function extractShotPackets(text = '') {
    const source = String(text).replace(/\r\n?/g, '\n');
    const records = [];
    let match;
    PACKET_RE.lastIndex = 0;
    while ((match = PACKET_RE.exec(source))) {
        let packet = null;
        let parseError = '';
        try {
            packet = normalizeShotPacket(JSON.parse(match[1]));
        } catch (error) {
            parseError = error.message;
        }
        records.push({
            index: records.length,
            start: match.index,
            end: match.index + match[0].length,
            raw: match[0],
            json: match[1],
            packet,
            parseError,
        });
    }
    return records;
}

export function extractStoryboardLedgers(text = '') {
    const source = String(text).replace(/\r\n?/g, '\n');
    const records = [];
    let match;
    STORYBOARD_RE.lastIndex = 0;
    while ((match = STORYBOARD_RE.exec(source))) {
        let payload = null;
        let parseError = '';
        try {
            const parsed = JSON.parse(match[1]);
            if (!parsed || !Array.isArray(parsed.shots)) throw new Error('分镜账本缺少 shots 数组');
            payload = {
                version: 2,
                shots: parsed.shots.slice(0, 6).map(normalizeShotPacket),
            };
        } catch (error) {
            parseError = error.message;
        }
        records.push({
            index: records.length,
            start: match.index,
            end: match.index + match[0].length,
            raw: match[0],
            json: match[1],
            payload,
            parseError,
        });
    }
    return records;
}

function castKey(item) {
    return clean(item?.id, 80).toLocaleLowerCase();
}

function storyNamesVisible(windowText, cast) {
    if (FEMALE_STORY_RE.test(windowText)) return true;
    return cast.some(item => FEMALE_DNA_RE.test(item.dna) && item.id && windowText.includes(item.id));
}

function validateEnglish(label, value, issues) {
    if (CJK_RE.test(value)) issues.push({ code: `${label}_contains_cjk`, message: `${label} 必须是英文图像语义` });
}

export function validateShotPacket(record, text = '', options = {}) {
    const source = String(text).replace(/\r\n?/g, '\n');
    const packet = record?.packet;
    const previousBoundary = Math.max(0, Number(options.previousBoundary || 0));
    const issues = [];
    if (record?.parseError || !packet) {
        issues.push({ code: 'packet_json_invalid', message: record?.parseError || '证据包不是 JSON' });
        return { ok: false, issues, quoteStart: -1, windowText: source.slice(previousBoundary, record?.start || 0) };
    }
    for (const field of REQUIRED_STRINGS) {
        if (!packet[field]) issues.push({ code: `missing_${field}`, message: `证据包缺少 ${field}` });
    }
    if (packet.quote.length < 6) issues.push({ code: 'quote_too_short', message: '原文证据过短，无法唯一绑定剧情' });
    if (!PEOPLE_RE.test(packet.people)) issues.push({ code: 'people_invalid', message: 'people 必须是准确的女性在场人数标签' });
    if (!ANIMA_SAFETY_TAGS.includes(packet.safety)) issues.push({ code: 'safety_invalid', message: 'safety 不是 Anima 支持的安全等级' });
    if (!packet.cast.length) issues.push({ code: 'cast_missing', message: '证据包没有在场人物' });
    if (!packet.cast.some(item => FEMALE_DNA_RE.test(item.dna))) issues.push({ code: 'female_cast_missing', message: 'Galgame 镜头缺少成年女性 DNA' });
    packet.cast.forEach((item, index) => {
        if (!item.id) issues.push({ code: 'cast_id_missing', castIndex: index, message: '人物缺少稳定 id' });
        for (const field of ENGLISH_FIELDS) {
            if (!item[field]) issues.push({ code: `cast_${field}_missing`, castIndex: index, message: `人物缺少 ${field}` });
            validateEnglish(`cast_${field}`, item[field], issues);
        }
    });
    ['people', 'action', 'setting', 'expression', 'composition', 'style'].forEach(field => {
        if (packet[field]) validateEnglish(field, packet[field], issues);
    });

    const quoteMatch = options.quoteMatch || findQuoteEvidence(source, packet.quote, {
        from: previousBoundary,
        to: record.start,
        preferLast: true,
    });
    const quoteStart = quoteMatch.start;
    const quoteEnd = quoteMatch.end;
    if (quoteStart < previousBoundary || quoteStart < 0) {
        issues.push({ code: 'quote_not_in_window', message: '原文证据不在上一张图之后到当前按钮之前' });
    } else if (record.start - quoteEnd > Number(options.maxEvidenceDistance || 2400)) {
        issues.push({ code: 'quote_too_far', message: '证据包离对应原文过远' });
    }
    const windowText = source.slice(previousBoundary, record.start)
        .replace(/<!--\s*JANIMA_SHOT\s*:[\s\S]*?-->/g, ' ')
        .replace(/\[[^\]\n]+\]/g, ' ');
    if (!storyNamesVisible(windowText, packet.cast)) {
        issues.push({ code: 'female_not_in_story_window', message: '该取材窗口没有能与证据包对应的女性' });
    }

    const quoteActions = storyActionTypes(packet.quote).filter(action => !['turn', 'reveal'].includes(action));
    const actionActions = storyActionTypes(packet.action);
    const quotePhase = storyActionPhase(quoteActions);
    const actionPhase = storyActionPhase(actionActions);
    const actionOverlap = quoteActions.some(action => actionActions.includes(action));
    if (quotePhase !== 'reaction' && actionPhase !== 'reaction' && quotePhase !== actionPhase && !actionOverlap) {
        issues.push({ code: 'action_phase_mismatch', message: `原文动作阶段 ${quotePhase} 与 Prompt 动作 ${actionPhase} 不一致` });
    }
    if (ADULT_PHASES.has(quotePhase) && packet.safety !== 'explicit') {
        issues.push({ code: 'adult_safety_mismatch', message: '明确成人动作必须使用 explicit，不能被降级或漏图' });
    }
    if (packet.cast.some(item => item.identity_change) && !CHANGE_RE.test(packet.quote)) {
        issues.push({ code: 'unsupported_identity_change', message: '原文未明确改变外貌，禁止换脸、换发色或换体型' });
    }
    if (packet.cast.some(item => item.outfit_change) && !OUTFIT_CHANGE_RE.test(packet.quote)) {
        issues.push({ code: 'unsupported_outfit_change', message: '原文未明确换装或脱衣，禁止改变服装状态' });
    }
    return { ok: issues.length === 0, issues, quoteStart, quoteEnd, quotePhase, actionPhase, windowText };
}

export function createCharacterRegistry(packetRecords = []) {
    const registry = new Map();
    for (const record of packetRecords) {
        const packet = record?.packet || record;
        for (const member of packet?.cast || []) {
            const key = castKey(member);
            if (!key) continue;
            const previous = registry.get(key);
            if (!previous) {
                registry.set(key, clonePacket(member));
                continue;
            }
            // Identity is first-seen authoritative. A later packet may only
            // mutate the fields whose own quote explicitly authorized change.
            registry.set(key, clonePacket({
                ...previous,
                ...(member.identity_change ? {
                    prompt_name: member.prompt_name,
                    dna: member.dna,
                    identity_change: true,
                } : {}),
                ...(member.outfit_change ? {
                    outfit: member.outfit,
                    outfit_change: true,
                } : {}),
            }));
        }
    }
    return registry;
}

export function reconcileShotPacket(packet, registry = new Map()) {
    const next = clonePacket(packet);
    next.cast = next.cast.map(member => {
        const key = castKey(member);
        const previous = registry.get(key);
        const current = { ...member };
        if (previous) {
            if (!current.identity_change) {
                current.prompt_name = previous.prompt_name;
                current.dna = previous.dna;
            }
            if (!current.outfit_change) current.outfit = previous.outfit;
        }
        registry.set(key, clonePacket(current));
        return current;
    });
    return next;
}

function fieldTags(value = '') {
    return clean(value, 1200).split(/[,;]+/).map(item => item.trim()).filter(Boolean);
}

export function buildPromptFromShotPacket(packet) {
    const castTags = packet.cast.flatMap(member => [
        member.prompt_name,
        ...fieldTags(member.dna),
        ...fieldTags(member.outfit),
    ]);
    const multi = packet.cast.length > 1 ? ['separate bodies', 'clear body separation'] : [];
    const style = packet.style && /^@[A-Za-z0-9_.-]+$/.test(packet.style) ? [packet.style] : [];
    const tags = [
        ...ANIMA_NATIVE_QUALITY_TAGS,
        packet.safety,
        packet.people,
        'female focus',
        ...style,
        ...multi,
        ...castTags,
        ...fieldTags(packet.action),
        ...fieldTags(packet.expression),
        ...fieldTags(packet.setting),
        ...fieldTags(packet.composition),
        'anime coloring',
        'visual novel CG',
    ];
    return reinforcePromptLocal(tags.join(', '));
}

export function serializeShotPacket(packet) {
    return `<!--JANIMA_SHOT:${JSON.stringify(packet)}-->`;
}

export function serializeStoryboardLedger(value) {
    const shots = Array.isArray(value) ? value : value?.shots;
    return `<!--JANIMA_STORYBOARD_V2:${JSON.stringify({ version: 2, shots: (shots || []).map(normalizeShotPacket) })}-->`;
}

/**
 * Converts a single hidden end-of-reply storyboard ledger into inline native
 * Chatu8 prompts. The model creates the story and semantic ledger in one
 * foreground response; this function is deterministic and never calls an LLM.
 */
export function repairStoryboardFromLedger(text = '', options = {}) {
    const source = String(text).replace(/\r\n?/g, '\n');
    const ledgers = extractStoryboardLedgers(source);
    const ledger = [...ledgers].reverse().find(item => item.payload && !item.parseError);
    if (!ledger) {
        return {
            changed: false,
            text: source,
            shots: [],
            errors: [{ code: 'no_storyboard_ledger', message: '同次回复没有有效的隐藏分镜账本' }],
        };
    }

    const registry = options.registry instanceof Map ? options.registry : new Map();
    const ranges = paragraphRanges(source).filter(item => item.start < ledger.start);
    const usedIds = new Set();
    const usedParagraphs = new Set();
    const errors = [];
    const shots = [];
    let previousQuoteEnd = 0;

    for (let index = 0; index < ledger.payload.shots.length; index++) {
        const packet = ledger.payload.shots[index];
        const issues = [];
        const quoteMatch = findQuoteEvidence(source, packet.quote, {
            from: previousQuoteEnd,
            to: ledger.start,
        });
        const quoteStart = quoteMatch.start;
        const quoteEnd = quoteMatch.end;
        const synthetic = { packet, start: ledger.start, end: ledger.end, index };
        const validation = validateShotPacket(synthetic, source, {
            previousBoundary: previousQuoteEnd,
            maxEvidenceDistance: Number.MAX_SAFE_INTEGER,
            quoteMatch,
        });
        issues.push(...validation.issues);

        if (quoteStart < 0 || quoteEnd > ledger.start) {
            issues.push({ code: 'ledger_quote_not_in_order', message: '账本原句不存在、重复使用或时间顺序错误' });
        }
        if (packet.id && usedIds.has(packet.id)) issues.push({ code: 'duplicate_shot_id', message: '分镜 id 重复' });
        if (packet.id) usedIds.add(packet.id);

        const paragraph = quoteStart < 0 ? null : ranges.find(item => quoteStart >= item.start && quoteStart < item.end);
        if (!paragraph) issues.push({ code: 'ledger_quote_paragraph_missing', message: '无法把分镜原句绑定到正文段落' });
        if (paragraph && usedParagraphs.has(paragraph.index)) {
            issues.push({ code: 'duplicate_shot_paragraph', message: '同一段连续动作不得堆叠多个按钮' });
        }

        const quoteActions = storyActionTypes(packet.quote).filter(action => !['turn', 'reveal'].includes(action));
        const actionActions = storyActionTypes(packet.action);
        if (quoteActions.length && !actionActions.some(action => quoteActions.includes(action))) {
            issues.push({ code: 'action_semantics_mismatch', message: '分镜动作没有覆盖锚定原句的核心物理动作' });
        }

        if (issues.length) {
            errors.push(...issues.map(issue => ({ ...issue, shotIndex: index })));
            continue;
        }

        const reconciled = reconcileShotPacket(packet, registry);
        usedParagraphs.add(paragraph.index);
        shots.push({
            packet: reconciled,
            prompt: buildPromptFromShotPacket(reconciled),
            quoteStart,
            quoteEnd,
            paragraphIndex: paragraph.index,
            insertAt: paragraph.end,
            actionPhase: validation.quotePhase,
        });
        previousQuoteEnd = quoteEnd;
    }

    const operations = [];
    for (const prompt of extractImagePrompts(source)) operations.push({ start: prompt.start, end: prompt.end, value: '' });
    for (const marker of parseDeclaredImageCount(source).matches) operations.push({ start: marker.index, end: marker.index + marker.raw.length, value: '' });
    for (const record of extractShotPackets(source)) operations.push({ start: record.start, end: record.end, value: '' });
    for (const record of ledgers) operations.push({ start: record.start, end: record.end, value: '' });
    for (const shot of shots) operations.push({ start: shot.insertAt, end: shot.insertAt, value: `\n\n${shot.prompt}` });

    let next = source;
    operations.sort((a, b) => b.start - a.start || b.end - a.end).forEach(operation => {
        next = next.slice(0, operation.start) + operation.value + next.slice(operation.end);
    });
    const canonicalLedger = serializeStoryboardLedger(shots.map(item => item.packet));
    next = `${next.replace(/\n{3,}/g, '\n\n').trimEnd()}\n\n${canonicalLedger}\n\n<!--IMG_COUNT:${Math.min(6, shots.length)}-->`;
    return { changed: next !== source, text: next, shots, errors, registry };
}

/**
 * Rebuilds only from semantic evidence authored in the same primary story
 * response. There is intentionally no action-template or scene-template path.
 */
export function repairStoryboardFromEvidence(text = '', options = {}) {
    const source = String(text).replace(/\r\n?/g, '\n');
    const records = extractShotPackets(source);
    if (!records.length) {
        return { changed: false, text: source, shots: [], errors: [{ code: 'no_evidence_packets', message: '没有同次回复剧情证据包；拒绝凭空猜图' }] };
    }
    const registry = options.registry instanceof Map ? options.registry : new Map();
    const ids = new Set();
    const errors = [];
    const shots = [];
    let previousBoundary = 0;
    for (const record of records) {
        const validation = validateShotPacket(record, source, { ...options, previousBoundary });
        if (record.packet?.id && ids.has(record.packet.id)) validation.issues.push({ code: 'duplicate_shot_id', message: '同一回复的镜头 id 重复' });
        if (record.packet?.id) ids.add(record.packet.id);
        validation.ok = validation.issues.length === 0;
        if (!validation.ok) {
            errors.push(...validation.issues.map(issue => ({ ...issue, packetIndex: record.index })));
            previousBoundary = record.end;
            continue;
        }
        const packet = reconcileShotPacket(record.packet, registry);
        const prompt = buildPromptFromShotPacket(packet);
        shots.push({ record, packet, prompt, quoteStart: validation.quoteStart, actionPhase: validation.quotePhase });
        previousBoundary = record.end;
    }

    const operations = [];
    for (const prompt of extractImagePrompts(source)) operations.push({ start: prompt.start, end: prompt.end, value: '' });
    for (const marker of parseDeclaredImageCount(source).matches) operations.push({ start: marker.index, end: marker.index + marker.raw.length, value: '' });
    for (const record of records) {
        const shot = shots.find(item => item.record.index === record.index);
        // Chatu8 recognizes any configured bracket body, including malformed
        // placeholder text that our normal prompt parser intentionally rejects.
        // Remove the bracket immediately following every packet so a rejected
        // packet cannot leave a hidden native button behind after repair.
        const following = source.slice(record.end).match(/^\s*\[[^\]\n]+\]/);
        if (following) {
            const start = record.end + following.index;
            const end = start + following[0].length;
            if (!operations.some(operation => operation.start < end && operation.end > start)) {
                operations.push({ start, end, value: '' });
            }
        }
        operations.push({
            start: record.start,
            end: record.end,
            value: shot ? `${serializeShotPacket(shot.packet)}\n\n${shot.prompt}` : '',
        });
    }
    let next = source;
    operations.sort((a, b) => b.start - a.start || b.end - a.end).forEach(operation => {
        next = next.slice(0, operation.start) + operation.value + next.slice(operation.end);
    });
    next = `${next.replace(/\n{3,}/g, '\n\n').trimEnd()}\n\n<!--IMG_COUNT:${Math.min(6, shots.length)}-->`;
    return { changed: next !== source, text: next, shots, errors, registry };
}
