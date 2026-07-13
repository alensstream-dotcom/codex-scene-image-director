import { identityAnchorIssues } from './identity-locks.mjs';
import { ANIMA_NATIVE_QUALITY_TAGS, ANIMA_SAFETY_TAGS } from './anima-workflow.mjs';

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const VISUAL_TOKEN_RE = /(?:^|,\s*)(?:[123](?:girl|boy)s?|solo|duo|pov|[a-z]+\s+(?:hair|eyes?|dress|uniform|shirt|skirt|socks?|pose|shot|lighting|background|room|door|sofa)|sitting|standing|peeking|holding|looking|smiling|crying|tight\s+(?:framing|composition)|upper body|full body)(?:,|$)/i;
const SENTENCE_RE = /\b(?:because|while|then|she thinks|he thinks|she realizes|he realizes|remembered that|felt that)\b/i;
const SOLO_RELATION_RE = /\b(?:beside|next to|alongside|together with|facing|embracing|kissing|holding hands with)\s+(?:her|him|them|another|each other)\b/i;
const FEMALE_SUBJECT_RE = /\b(?:[1-6]girls?|girl|girls|adult woman|adult women|woman|women|female protagonist|female focus)\b/i;
const CINEMATIC_BEAT_RE = /\b(?:entering|appearing|opening|closing|turning|looking|gazing|reaching|grabbing|holding|offering|receiving|pulling|pushing|embracing|kissing|protecting|fighting|running|kneeling|sitting|standing|peeking|pointing|raising|drawing|crying|smiling|blushing|laughing|shocked|surprised|angry|furious|afraid|determined|trembling|wounded|transformation|dynamic pose|expressive face|expressive faces)\b/i;
const COUNT_RE = /<!--\s*IMG_COUNT\s*:\s*([0-6])\s*-->/gi;
const FAST_BEAT_RE = /(?:忽然|突然|随后|紧接着|与此同时|另一边|远处|片刻后|不久后|次日|清晨|黄昏|夜幕|转身|冲入|闯入|进入|来到|离开|抵达|炸开|崩裂|袭来|变身|换上|脱下|拔出|举起|扑向)/;

export function normalizeLineEndings(value = '') {
    return String(value).replace(/\r\n?/g, '\n');
}

export function parseDeclaredImageCount(text = '') {
    const matches = [...normalizeLineEndings(text).matchAll(COUNT_RE)];
    if (!matches.length) return { count: null, matches: [] };
    return {
        count: Number(matches[matches.length - 1][1]),
        matches: matches.map(match => ({ count: Number(match[1]), index: match.index, raw: match[0] })),
    };
}

export function splitTags(prompt = '') {
    return String(prompt)
        .replace(/^\s*\[|\]\s*$/g, '')
        .replace(/[，、；;]/g, ',')
        .split(/,|\n/)
        .map(tag => tag.trim().replace(/\s+/g, ' '))
        .filter(Boolean);
}

export function isLikelyImagePrompt(content = '') {
    const value = String(content).trim();
    if (!value || /\]\s*\(/.test(value)) return false;
    // Zhihuiji treats every configured bracket pair as an image tag. Variable
    // update payloads also use JSON arrays, so reject their object bodies before
    // applying the looser tag-count heuristic below.
    if (/^[\[{]/.test(value)
        || /"(?:op|path|value|from)"\s*:/i.test(value)
        || /<\/?(?:JSONPatch|UpdateVariable)\b/i.test(value)) return false;
    const tags = splitTags(value);
    if (tags.length < 3) return false;
    const commaCount = (value.match(/,/g) || []).length;
    if (commaCount < 2) return false;
    if (VISUAL_TOKEN_RE.test(value)) return true;
    return tags.length >= 6;
}

export function paragraphRanges(text = '') {
    const source = normalizeLineEndings(text);
    const ranges = [];
    const regex = /(?:^|\n{2,})([^\n](?:[\s\S]*?))(?=\n{2,}|$)/g;
    let match;
    while ((match = regex.exec(source))) {
        const raw = match[1];
        const start = match.index + match[0].indexOf(raw);
        ranges.push({ index: ranges.length, start, end: start + raw.length, text: raw });
    }
    return ranges;
}

export function storyParagraphCandidates(text = '') {
    return paragraphRanges(text).flatMap(item => {
        const raw = item.text.trim();
        if (!raw || /^<!--\s*IMG_COUNT/i.test(raw)) return [];
        if (/^```|<(?:UpdateVariable|details|head|style|script|iframe|status)\b/i.test(raw)) return [];
        if (raw.length > 4000 || extractImagePrompts(raw).length) return [];
        const visible = raw
            .replace(/<[^>]+>/g, ' ')
            .replace(/&(?:nbsp|lt|gt|amp|quot);/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (visible.length < 8 || (!CJK_RE.test(visible) && !/[A-Za-z]{4}/.test(visible))) return [];
        return [{ ...item, text: visible }];
    });
}

export function desiredImageCount(text = '', options = {}) {
    const minimum = Math.max(1, Math.min(6, Number(options.minimum ?? 3) || 3));
    const maximum = Math.max(minimum, Math.min(6, Number(options.maximum ?? 6) || 6));
    const paragraphs = storyParagraphCandidates(text);
    const fastBeats = paragraphs.filter(item => FAST_BEAT_RE.test(item.text)).length;
    let desired = minimum;
    if (paragraphs.length >= 10 || fastBeats >= 2) desired = Math.max(desired, 4);
    if (paragraphs.length >= 16 || fastBeats >= 4) desired = Math.max(desired, 5);
    if (paragraphs.length >= 24 || fastBeats >= 6) desired = Math.max(desired, 6);
    return Math.min(maximum, desired);
}

export function extractImagePrompts(text = '') {
    const source = normalizeLineEndings(text);
    const paragraphs = paragraphRanges(source);
    const found = [];
    const lineRe = /(^|\n)([ \t]*\[([^\]\n]+)\][ \t]*)(?=\n|$)/g;
    let match;
    while ((match = lineRe.exec(source))) {
        const content = match[3].trim();
        if (!isLikelyImagePrompt(content)) continue;
        const start = match.index + match[1].length;
        const paragraph = paragraphs.find(item => start >= item.start && start <= item.end);
        found.push({
            index: found.length,
            start,
            end: start + match[2].length,
            raw: match[2],
            prompt: content,
            tags: splitTags(content),
            paragraphIndex: paragraph?.index ?? -1,
        });
    }
    return found;
}

export function storySegmentsForPrompts(text = '', suppliedPrompts = null) {
    const source = normalizeLineEndings(text);
    const prompts = Array.isArray(suppliedPrompts) ? suppliedPrompts : extractImagePrompts(source);
    // Segment ownership is structural, so even a short but meaningful beat such
    // as “她笑了。” counts as new story. The stricter fallback candidate filter
    // intentionally ignores such short lines, but continuity validation must not.
    const candidates = paragraphRanges(source).filter(item => {
        const raw = item.text.trim();
        if (!raw || /^<!--\s*IMG_COUNT/i.test(raw)) return false;
        if (/^```|<(?:UpdateVariable|details|head|style|script|iframe|status)\b/i.test(raw)) return false;
        if (extractImagePrompts(raw).length) return false;
        const visible = raw.replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|lt|gt|amp|quot);/gi, ' ').replace(/\s+/g, ' ').trim();
        return visible.length >= 2 && (CJK_RE.test(visible) || /[A-Za-z]{2}/.test(visible));
    });
    return prompts.map((prompt, index) => {
        const previousPromptEnd = index > 0 ? prompts[index - 1].end : 0;
        const paragraphs = candidates.filter(item => item.start >= previousPromptEnd && item.end <= prompt.start);
        return {
            promptIndex: prompt.index,
            previousPromptEnd,
            promptStart: prompt.start,
            fromParagraphIndex: paragraphs[0]?.index ?? null,
            toParagraphIndex: paragraphs.at(-1)?.index ?? null,
            paragraphs,
            text: paragraphs.map(item => item.text).join('\n\n'),
        };
    });
}

function canonicalPrompt(prompt) {
    return splitTags(prompt).map(tag => tag.toLowerCase()).sort().join('|');
}

function arePromptsPiledAtEnd(text, prompts) {
    if (prompts.length < 2) return false;
    const paragraphs = paragraphRanges(text).filter(item => !/^<!--\s*IMG_COUNT/i.test(item.text.trim()));
    const promptParagraphs = new Set(prompts.map(prompt => prompt.paragraphIndex));
    const meaningful = paragraphs.filter(item => item.text.trim());
    const final = meaningful.slice(-prompts.length);
    return final.length === prompts.length && final.every(item => promptParagraphs.has(item.index));
}

export function validateTurn(text = '', options = {}) {
    const source = normalizeLineEndings(text);
    const declaration = parseDeclaredImageCount(source);
    const prompts = extractImagePrompts(source);
    const issues = [];
    if (declaration.count === null) issues.push({ code: 'missing_count', severity: 'warning', message: '未发现 IMG_COUNT 标记' });
    if (declaration.matches.length > 1) issues.push({ code: 'multiple_count', severity: 'warning', message: '存在多个 IMG_COUNT 标记' });
    if (declaration.count !== null && declaration.count !== prompts.length) {
        issues.push({ code: 'count_mismatch', severity: 'error', message: `应有 ${declaration.count} 张，实际 ${prompts.length} 张` });
    }
    if (arePromptsPiledAtEnd(source, prompts)) issues.push({ code: 'piled_at_end', severity: 'warning', message: '多个 prompt 集中堆在回复末尾' });

    const storySegments = storySegmentsForPrompts(source, prompts);
    const seen = new Map();
    for (const prompt of prompts) {
        const local = [];
        if (CJK_RE.test(prompt.prompt)) local.push({ code: 'contains_chinese', severity: 'error', message: 'prompt 含中文' });
        if (SENTENCE_RE.test(prompt.prompt) || /[.!?]\s+[A-Z][a-z]+\s/.test(prompt.prompt)) {
            local.push({ code: 'prose_sentence', severity: 'warning', message: 'prompt 像英文剧情长句' });
        }
        if (prompt.prompt.length > Number(options.maxPromptChars || 650)) local.push({ code: 'too_long', severity: 'warning', message: 'prompt 过长' });
        const lower = prompt.tags.map(tag => tag.toLowerCase());
        const has1Girl = lower.includes('1girl');
        const has2Girls = lower.includes('2girls');
        const hasSolo = lower.includes('solo');
        const hasDuo = lower.includes('duo');
        if ((has1Girl && has2Girls) || (hasSolo && (has2Girls || hasDuo))) {
            local.push({ code: 'people_conflict', severity: 'error', message: '人数标签冲突' });
        }
        if ((hasSolo || has1Girl) && SOLO_RELATION_RE.test(prompt.prompt)) {
            local.push({ code: 'solo_relation_conflict', severity: 'error', message: 'solo/单人标签与第二人物互动冲突' });
        }
        if (!FEMALE_SUBJECT_RE.test(prompt.prompt)) {
            local.push({ code: 'female_subject_missing', severity: 'error', message: 'Galgame 图片必须有剧情中真实出现的女性，禁止纯男性或纯场景图' });
        }
        if (!storySegments[prompt.index]?.paragraphs.length) {
            local.push({ code: 'empty_story_segment', severity: 'error', message: '该图片与上一张图片之间没有新的剧情段落' });
        }
        if (!CINEMATIC_BEAT_RE.test(prompt.prompt)) {
            local.push({ code: 'weak_visual_beat', severity: 'warning', message: 'Prompt 缺少明确动作或强表情，可能不是本段最有画面感的镜头' });
        }
        local.push(...identityAnchorIssues(prompt.prompt));
        const key = canonicalPrompt(prompt.prompt);
        if (seen.has(key)) local.push({ code: 'duplicate_prompt', severity: 'error', message: `与第 ${seen.get(key) + 1} 个 prompt 重复` });
        else seen.set(key, prompt.index);
        prompt.issues = local;
        issues.push(...local.map(issue => ({ ...issue, promptIndex: prompt.index })));
    }

    return {
        declaredImageCount: declaration.count,
        detectedPromptCount: prompts.length,
        prompts,
        issues,
        ok: issues.every(issue => issue.severity !== 'error') && declaration.count !== null,
    };
}

export function reinforcePromptLocal(prompt = '') {
    const originalTags = splitTags(prompt);
    const tags = [];
    const seen = new Set();
    for (const rawTag of originalTags) {
        const tag = rawTag.replace(/^\[+|\]+$/g, '').trim();
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        tags.push(tag);
    }
    const nativeQualityKeys = new Set(ANIMA_NATIVE_QUALITY_TAGS.map(tag => tag.toLowerCase()));
    const safetyKeys = new Set(ANIMA_SAFETY_TAGS);
    const obsoleteQualityKeys = new Set(['amazing quality', 'very aesthetic', 'high resolution', 'absurdres', 'year 2025']);
    const normalizedSafety = tags.map(tag => tag.toLowerCase().replace(/^rating[: ]+/, '')).find(tag => safetyKeys.has(tag));
    const promptText = tags.join(', ').toLowerCase();
    const inferredSafety = normalizedSafety
        || (/\b(?:vaginal|anal|fellatio|paizuri|handjob|footjob|sex|penetration|penis|pussy|cum)\b/.test(promptText) ? 'explicit'
            : /\b(?:nude|naked|nipples|topless|bottomless|bare breasts|exposed breasts|nsfw)\b/.test(promptText) ? 'nsfw'
                : /\b(?:lingerie|underwear|panties|bra|cleavage|breast focus|suggestive)\b/.test(promptText) ? 'sensitive'
                    : 'safe');
    const contentTags = tags.filter(tag => {
        const key = tag.toLowerCase().replace(/^rating[: ]+/, '');
        return !nativeQualityKeys.has(key) && !obsoleteQualityKeys.has(key) && !safetyKeys.has(key) && key !== 'sfw';
    });
    tags.length = 0;
    tags.push(...ANIMA_NATIVE_QUALITY_TAGS, inferredSafety, ...contentTags);
    let lower = tags.map(tag => tag.toLowerCase());
    const relationText = tags.join(', ');
    const hasMaleProtagonistRelation = FEMALE_SUBJECT_RE.test(relationText)
        && /\b(?:male protagonist|the protagonist|protagonist(?:'s)?|pov male)\b/i.test(relationText)
        && !lower.some(tag => /^(?:[2-6]girls?|2girls and 1boy)$/.test(tag));
    if (hasMaleProtagonistRelation) {
        for (let index = tags.length - 1; index >= 0; index--) {
            if (/^(?:1girl|solo)$/i.test(tags[index])) tags.splice(index, 1);
        }
        let countIndex = tags.findIndex(tag => /^1girl and 1boy$/i.test(tag));
        if (countIndex < 0) {
            countIndex = ANIMA_NATIVE_QUALITY_TAGS.length + 1;
            tags.splice(countIndex, 0, '1girl and 1boy');
        }
        const updatedText = tags.join(', ');
        if (!/\bmale protagonist (?:torso|hand|arm|body|partly visible)\b/i.test(updatedText)) {
            const visibility = /\b(?:chest|torso|badge|crest|emblem)\b/i.test(updatedText)
                ? 'male protagonist torso partly visible'
                : /\b(?:hand|wrist|palm|finger)\b/i.test(updatedText)
                    ? 'male protagonist hand and forearm visible'
                    : 'male protagonist partly visible';
            tags.splice(countIndex + 1, 0, visibility);
        }
        lower = tags.map(tag => tag.toLowerCase());
    } else if (lower.includes('1girl') && !lower.includes('2girls') && !lower.includes('solo')) {
        const at = tags.findIndex(tag => tag.toLowerCase() === '1girl');
        tags.splice(at + 1, 0, 'solo');
    }
    if (FEMALE_SUBJECT_RE.test(tags.join(', ')) && !tags.some(tag => tag.toLowerCase() === 'female focus')) {
        const at = tags.findIndex(tag => /\b(?:[1-6]girls?|adult women?|women?)\b/i.test(tag));
        const afterCountAndSolo = tags[at + 1]?.toLowerCase() === 'solo' ? at + 2 : at + 1;
        tags.splice(Math.max(0, afterCountAndSolo), 0, 'female focus');
    }
    const compositionRe = /\b(?:shot|framing|composition|close-up|upper body|full body|cowboy shot)\b/i;
    if (!tags.some(tag => compositionRe.test(tag))) tags.push('tight composition', 'subject fills most of the frame');
    return `[${tags.join(', ')}]`;
}

export function replacePromptAt(text, promptRecord, replacement) {
    const source = normalizeLineEndings(text);
    const wrapped = String(replacement).trim().startsWith('[') ? String(replacement).trim() : `[${String(replacement).trim()}]`;
    return source.slice(0, promptRecord.start) + wrapped + source.slice(promptRecord.end);
}

export function insertPromptAfterParagraph(text, paragraphIndex, prompt) {
    const source = normalizeLineEndings(text);
    const paragraphs = paragraphRanges(source);
    const target = paragraphs[Number(paragraphIndex)];
    if (!target) throw new Error(`段落 ${paragraphIndex} 不存在`);
    const wrapped = String(prompt).trim().startsWith('[') ? String(prompt).trim() : `[${String(prompt).trim()}]`;
    return source.slice(0, target.end) + `\n\n${wrapped}` + source.slice(target.end);
}

export function applyMissingPrompts(text, missingPrompts = []) {
    const ordered = [...missingPrompts].sort((a, b) => Number(b.after_paragraph_index) - Number(a.after_paragraph_index));
    let result = normalizeLineEndings(text);
    for (const item of ordered) {
        if (!Array.isArray(item.prompt_tags) || !item.prompt_tags.length) throw new Error('missing prompt_tags');
        result = insertPromptAfterParagraph(result, Number(item.after_paragraph_index), reinforcePromptLocal(item.prompt_tags.join(', ')));
    }
    return result;
}

export function surroundingParagraphs(text, paragraphIndex) {
    const paragraphs = paragraphRanges(text);
    const index = Math.max(0, Math.min(paragraphs.length - 1, Number(paragraphIndex)));
    return {
        before: paragraphs[index - 1]?.text || '',
        current: paragraphs[index]?.text || '',
        after: paragraphs[index + 1]?.text || '',
        paragraphIndex: index,
    };
}

export function stableHash(value = '') {
    let hash = 0x811c9dc5;
    const text = String(value);
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function makeCacheKey({ messageId, messageContent = '', originalPrompt = '', repairMode = '' }) {
    return [messageId, stableHash(messageContent), stableHash(originalPrompt), repairMode].join(':');
}

export function parseStrictJson(text = '') {
    const value = String(text).trim();
    if (!value) throw new Error('AI 未返回可解析 JSON');

    try {
        const direct = JSON.parse(value);
        if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
    } catch {
        // Some otherwise compatible models wrap JSON in Markdown or short reasoning text.
    }

    for (let start = value.indexOf('{'); start >= 0; start = value.indexOf('{', start + 1)) {
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < value.length; index++) {
            const character = value[index];
            if (inString) {
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === '"') inString = false;
                continue;
            }
            if (character === '"') {
                inString = true;
                continue;
            }
            if (character === '{') depth++;
            if (character !== '}') continue;
            depth--;
            if (depth !== 0) continue;
            try {
                const candidate = JSON.parse(value.slice(start, index + 1));
                if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate;
            } catch {
                break;
            }
        }
    }
    throw new Error('AI 未返回可解析 JSON');
}

export function assertPromptRepairResponse(payload) {
    if (!payload || !Array.isArray(payload.prompt_tags) || !payload.prompt_tags.length) throw new Error('AI 响应缺少 prompt_tags');
    if (payload.prompt_tags.some(tag => typeof tag !== 'string' || !tag.trim())) throw new Error('prompt_tags 格式错误');
    return {
        prompt_tags: payload.prompt_tags.map(tag => tag.trim()),
        negative_tags: Array.isArray(payload.negative_tags) ? payload.negative_tags.filter(tag => typeof tag === 'string').map(tag => tag.trim()) : [],
        changes: Array.isArray(payload.changes) ? payload.changes.filter(change => typeof change === 'string') : [],
        confidence: Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : null,
    };
}

export function assertWholeTurnResponse(payload) {
    if (!payload || !Array.isArray(payload.missing_prompts)) throw new Error('AI 响应缺少 missing_prompts');
    for (const item of payload.missing_prompts) {
        if (!Number.isInteger(Number(item.after_paragraph_index)) || !Array.isArray(item.prompt_tags) || !item.prompt_tags.length) {
            throw new Error('missing_prompts 格式错误');
        }
    }
    return payload;
}

export function findSelectedParagraph(text, selectedText) {
    const source = normalizeLineEndings(text);
    const selection = normalizeLineEndings(selectedText).trim();
    if (!selection) return -1;
    const offset = source.indexOf(selection);
    if (offset < 0) return -1;
    return paragraphRanges(source).find(item => offset >= item.start && offset <= item.end)?.index ?? -1;
}
