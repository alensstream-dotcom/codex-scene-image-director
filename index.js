import {
    chat,
    characters,
    eventSource,
    event_types,
    generateQuietPrompt,
    saveChatConditional,
    saveSettingsDebounced,
    this_chid,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { buildVisualDnaHint, visualLocksForText } from './lib/identity-locks.mjs';
import { installAnimaAccuracyWorkflow } from './lib/anima-workflow.mjs';
import {
    applyMissingPrompts,
    assertPromptRepairResponse,
    assertWholeTurnResponse,
    desiredImageCount,
    extractImagePrompts,
    findSelectedParagraph,
    insertPromptAfterParagraph,
    isLikelyImagePrompt,
    makeCacheKey,
    paragraphRanges,
    parseStrictJson,
    reinforcePromptLocal,
    replacePromptAt,
    stableHash,
    storyParagraphCandidates,
    validateTurn,
} from './lib/rescue-core.mjs';

const EXT_ID = 'codex_scene_image_director';
const EXT_NAME = '世界书生图救援器';
const EXT_VERSION = '1.4.1';
const SETTINGS_SELECTOR = '#janima_rescue_settings';
const VERIFIED_ZHIHUIJI_SELECTOR = '.st-chatu8-image-button';

const DEFAULT_SETTINGS = {
    version: 7,
    enabled: true,
    autoCheck: true,
    silentMode: true,
    autoLocalRepair: true,
    selectionFill: false,
    api: {
        enabled: false,
        autoAudit: true,
        url: '',
        key: '',
        model: '',
        timeoutMs: 10000,
        characterDna: '',
    },
    fallback: {
        enabled: true,
        repairInvalidPrompts: true,
        semanticAudit: false,
        minimumImages: 3,
        maximumImages: 6,
        adaptive: true,
        responseLength: 1200,
    },
    chatu8: {
        enabled: true,
        inlineButtons: true,
        accuracyWorkflow: true,
        startTag: '[',
        endTag: ']',
        rescanTimeoutMs: 3500,
        buttonWaitMs: 3500,
    },
    legacy: {
        autonomousDirector: false,
        longTermImageMemory: false,
        prism: false,
        fastAccurateModes: false,
    },
};

const runtime = {
    cache: new Map(),
    debugByMessage: new Map(),
    ignored: new Set(),
    writing: new Set(),
    selection: null,
    selectionTimer: null,
    auditedHashes: new Set(),
    localRepairHashes: new Set(),
    fallbackHashes: new Set(),
    fallbackInFlight: new Set(),
    quietRepairHashes: new Set(),
    quietRepairInFlight: new Set(),
    semanticAuditFinalHashes: new Map(),
    zhihuijiRescanHashes: new Set(),
};

function mergeDefaults(base, incoming) {
    const result = { ...base };
    for (const [key, value] of Object.entries(incoming || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object') {
            result[key] = mergeDefaults(base[key], value);
        } else if (key in base) {
            result[key] = value;
        }
    }
    return result;
}

function settings() {
    const existing = extension_settings[EXT_ID];
    if (!existing || Number(existing.version) < 7) {
        const api = existing?.api || {};
        const chatu8 = existing?.chatu8 || {};
        extension_settings[EXT_ID] = mergeDefaults(DEFAULT_SETTINGS, {
            silentMode: true,
            autoLocalRepair: true,
            selectionFill: false,
            api: { enabled: false, autoAudit: true, url: api.url || '', key: api.key || '', model: api.model || '', timeoutMs: api.timeoutMs || 10000 },
            fallback: { enabled: true, repairInvalidPrompts: true, semanticAudit: false, minimumImages: 3, maximumImages: 6, adaptive: true, responseLength: 1200 },
            chatu8: { enabled: true, inlineButtons: true, accuracyWorkflow: true, startTag: chatu8.startTag || '[', endTag: chatu8.endTag || ']' },
        });
    } else {
        extension_settings[EXT_ID] = mergeDefaults(DEFAULT_SETTINGS, existing);
    }
    return extension_settings[EXT_ID];
}

function findNestedValue(root, wantedKey, depth = 0, seen = new Set()) {
    if (!root || typeof root !== 'object' || depth > 5 || seen.has(root)) return null;
    seen.add(root);
    if (Object.prototype.hasOwnProperty.call(root, wantedKey) && root[wantedKey] && typeof root[wantedKey] === 'object') {
        return root[wantedKey];
    }
    for (const value of Object.values(root)) {
        const found = findNestedValue(value, wantedKey, depth + 1, seen);
        if (found) return found;
    }
    return null;
}

function currentVariableDna() {
    for (let index = (chat?.length || 0) - 1; index >= Math.max(0, (chat?.length || 0) - 12); index--) {
        const dna = findNestedValue(chat[index], 'FM_DNA');
        if (dna && Object.keys(dna).length) return dna;
    }
    return null;
}

function collectCharacterCardEvidence(source = '') {
    const character = characters?.[Number(this_chid)];
    const book = character?.data?.character_book || character?.character_book;
    const entries = Array.isArray(book?.entries) ? book.entries : Object.values(book?.entries || {});
    const wantedNames = visualLocksForText(source).flatMap(lock => lock.names.map(name => name.toLowerCase()));
    if (!wantedNames.length || !entries.length) return [];
    return entries.flatMap(entry => {
        const content = String(entry?.content || entry?.text || '').trim();
        const label = [entry?.comment, entry?.name, ...(Array.isArray(entry?.keys) ? entry.keys : [])].filter(Boolean).join(' ');
        const haystack = `${label}\n${content}`.toLowerCase();
        if (!content || !wantedNames.some(name => haystack.includes(name))) return [];
        return [content.slice(0, 2200)];
    }).slice(0, 5);
}

function collectCharacterDnaHints(source = '') {
    const parts = [buildVisualDnaHint(source, settings().api.characterDna, collectCharacterCardEvidence(source))];
    const variableDna = currentVariableDna();
    if (variableDna) parts.push(`CURRENT FM_DNA VARIABLE:\n${JSON.stringify(variableDna).slice(0, 3500)}`);
    return parts.join('\n\n');
}

function configureChatu8AccuracyWorkflow() {
    if (!settings().chatu8.enabled || !settings().chatu8.accuracyWorkflow) return false;
    const chatu8Settings = extension_settings['st-chatu8'];
    if (!chatu8Settings) return false;
    const changed = installAnimaAccuracyWorkflow(chatu8Settings);
    if (changed) saveSettingsDebounced();
    return changed;
}

function toast(type, message) {
    if (globalThis.toastr?.[type]) globalThis.toastr[type](message, EXT_NAME);
    else console[type === 'error' ? 'error' : 'log'](`[${EXT_NAME}] ${message}`);
}

function getMessageText(messageId) {
    const message = chat?.[Number(messageId)];
    return String(message?.mes || message?.message || '');
}

function storedSemanticAuditHash(messageId) {
    return String(chat?.[Number(messageId)]?.extra?.janimaSemanticAuditHash || '');
}

async function persistSemanticAuditHash(messageId, hash) {
    const message = chat?.[Number(messageId)];
    if (!message) return;
    message.extra ||= {};
    if (message.extra.janimaSemanticAuditHash === hash) return;
    message.extra.janimaSemanticAuditHash = hash;
    await saveChatConditional?.();
}

function isAssistantMessage(messageId) {
    const message = chat?.[Number(messageId)];
    return Boolean(message && !message.is_user && !message.is_system);
}

function messageElement(messageId) {
    const id = Number(messageId);
    return document.querySelector(`.mes[mesid="${id}"]`)
        || document.querySelector(`.mes[data-mes-id="${id}"]`)
        || [...document.querySelectorAll('.mes')][id]
        || null;
}

function setDebug(messageId, patch) {
    const current = runtime.debugByMessage.get(Number(messageId)) || {};
    runtime.debugByMessage.set(Number(messageId), { ...current, ...patch, messageId: Number(messageId), extensionVersion: EXT_VERSION });
}

function baseDebug(messageId, validation, promptIndex = null) {
    const prompt = promptIndex === null ? null : validation.prompts[promptIndex];
    return {
        messageId: Number(messageId),
        declaredImageCount: validation.declaredImageCount,
        detectedPromptCount: validation.detectedPromptCount,
        promptIndex,
        originalPrompt: prompt?.prompt || '',
        repairedPrompt: '',
        issues: prompt?.issues || validation.issues,
        repairMode: '',
        cacheHit: false,
        insertParagraphIndex: prompt?.paragraphIndex ?? null,
        zhihuijiButtonFound: false,
        zhihuijiRoute: '',
        generationRequested: false,
        generationStatus: '',
    };
}

function button(label, action, messageId, promptIndex = '') {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'menu_button janima-rescue-button';
    node.textContent = label;
    node.dataset.action = action;
    node.dataset.messageId = String(messageId);
    if (promptIndex !== '') node.dataset.promptIndex = String(promptIndex);
    return node;
}

function removeLegacyConversationUi(host = document) {
    host.querySelectorAll?.('.janima-rescue-panel, .janima-rescue-prompt-row').forEach(node => node.remove());
}

function removePromptRange(text, prompt) {
    let start = prompt.start;
    let end = prompt.end;
    while (start > 0 && text[start - 1] === '\n' && start > 1 && text[start - 2] === '\n') start--;
    while (end < text.length && text[end] === '\n' && end + 1 < text.length && text[end + 1] === '\n') end++;
    return text.slice(0, start) + text.slice(end);
}

function updateCountMarker(text, count) {
    const marker = `<!--IMG_COUNT:${Math.max(0, Math.min(6, Number(count) || 0))}-->`;
    if (/<!--\s*IMG_COUNT\s*:\s*[0-6]\s*-->/i.test(text)) {
        return text.replace(/<!--\s*IMG_COUNT\s*:\s*[0-6]\s*-->/gi, marker);
    }
    return `${text.trimEnd()}\n\n${marker}`;
}

function buildSafeLocalRepair(text, validation) {
    let next = text;
    let changed = false;
    for (const prompt of [...validation.prompts].reverse()) {
        if (prompt.issues?.some(issue => issue.code === 'duplicate_prompt')) {
            next = removePromptRange(next, prompt);
            changed = true;
            continue;
        }
        const reinforced = reinforcePromptLocal(prompt.prompt);
        if (reinforced !== `[${prompt.prompt}]`) {
            next = replacePromptAt(next, prompt, reinforced);
            changed = true;
        }
    }
    if (changed && validation.declaredImageCount !== null) next = updateCountMarker(next, extractImagePrompts(next).length);
    return { changed, text: next };
}

function markZhihuijiButtonsInline(messageId) {
    if (!settings().chatu8.inlineButtons) return;
    const host = messageElement(messageId);
    const textRoot = host?.querySelector('.mes_text');
    if (!host || !textRoot) return;
    const buttons = [...host.querySelectorAll(VERIFIED_ZHIHUIJI_SELECTOR)];
    const validButtons = [];
    buttons.forEach(buttonNode => {
        const rawPrompt = buttonNode.dataset.imageTag || buttonNode.dataset.link || buttonNode.dataset.change || '';
        if (!isLikelyImagePrompt(rawPrompt)) {
            buttonNode.classList.add('janima-invalid-image-button');
            buttonNode.style.display = 'none';
            buttonNode.setAttribute('aria-hidden', 'true');
            return;
        }
        const index = validButtons.length;
        validButtons.push(buttonNode);
        buttonNode.dataset.janimaPromptIndex = String(index);
        buttonNode.classList.add('janima-inline-image-button');
        buttonNode.style.display = 'block';
        buttonNode.style.width = 'fit-content';
        buttonNode.style.margin = '8px 0';
        const parent = buttonNode.parentElement;
        parent?.classList.add('janima-inline-image-anchor');
        if (!buttonNode.closest('.mes_text')) textRoot.append(buttonNode);
    });
    setDebug(messageId, {
        zhihuijiButtonFound: validButtons.length > 0,
        zhihuijiRoute: validButtons.length ? `${VERIFIED_ZHIHUIJI_SELECTOR} native-inline-anchor` : 'waiting-for-chatu8',
        inlineButtonCount: validButtons.length,
        ignoredFalseButtonCount: buttons.length - validButtons.length,
    });
}

function nudgeZhihuijiObserver(messageId, validation = validateTurn(getMessageText(messageId))) {
    if (!settings().chatu8.enabled || !validation.prompts.length) return false;
    const id = Number(messageId);
    const key = `${id}:${stableHash(getMessageText(id))}:chatu8-observer`;
    if (runtime.zhihuijiRescanHashes.has(key)) return false;
    runtime.zhihuijiRescanHashes.add(key);

    const wake = delay => setTimeout(() => {
        const host = messageElement(id);
        const textRoot = host?.querySelector('.mes_text');
        if (!textRoot || verifiedZhihuijiButtons(id).length >= validation.prompts.length) return;

        // st-chatu8 2.7.x performs its native recognition from a DOM observer.
        // A transient, empty node wakes that observer without changing chat text,
        // adding visible UI, or clicking any generation button.
        const marker = document.createElement('span');
        marker.hidden = true;
        marker.setAttribute('aria-hidden', 'true');
        marker.dataset.janimaChatu8Rescan = key;
        textRoot.append(marker);
        requestAnimationFrame(() => marker.remove());
        setTimeout(() => markZhihuijiButtonsInline(id), 450);
    }, delay);

    wake(80);
    wake(700);
    wake(Math.min(2400, Math.max(1200, Number(settings().chatu8.rescanTimeoutMs || 3500) - 700)));
    setDebug(id, {
        zhihuijiButtonFound: false,
        zhihuijiRoute: 'native DOM observer rescan scheduled',
        generationStatus: 'waiting-for-button',
    });
    return true;
}

function validateSilentAuditResponse(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('静默审计响应不是对象');
    const array = name => Array.isArray(payload[name]) ? payload[name] : [];
    return {
        remove_prompt_indexes: array('remove_prompt_indexes').map(Number).filter(Number.isInteger),
        replace_prompts: array('replace_prompts'),
        missing_prompts: array('missing_prompts'),
        reasons: array('reasons').filter(item => typeof item === 'string'),
    };
}

function applySilentAuditPatch(text, audit) {
    const prompts = extractImagePrompts(text);
    const paragraphs = paragraphRanges(text);
    const operations = [];
    for (const index of audit.remove_prompt_indexes) {
        const prompt = prompts[index];
        if (prompt) operations.push({ start: prompt.start, end: prompt.end, value: '' });
    }
    for (const item of audit.replace_prompts) {
        const prompt = prompts[Number(item.prompt_index)];
        if (prompt && Array.isArray(item.prompt_tags) && item.prompt_tags.length) {
            operations.push({ start: prompt.start, end: prompt.end, value: `[${item.prompt_tags.join(', ')}]` });
        }
    }
    for (const item of audit.missing_prompts) {
        const paragraph = paragraphs[Number(item.after_paragraph_index)];
        if (paragraph && Array.isArray(item.prompt_tags) && item.prompt_tags.length) {
            operations.push({ start: paragraph.end, end: paragraph.end, value: `\n\n[${item.prompt_tags.join(', ')}]` });
        }
    }
    let next = text;
    operations.sort((a, b) => b.start - a.start).forEach(operation => {
        next = next.slice(0, operation.start) + operation.value + next.slice(operation.end);
    });
    return updateCountMarker(next, extractImagePrompts(next).length);
}

function anchoredStoryIndexes(text, prompts, candidates) {
    return prompts.map(prompt => {
        const preceding = candidates.filter(item => item.end <= prompt.start);
        return preceding.length ? preceding[preceding.length - 1].index : null;
    }).filter(Number.isInteger);
}

function validateQuietFallbackResponse(raw, allowedIndexes, missingCount) {
    const payload = typeof raw === 'string' ? parseStrictJson(raw) : raw;
    if (!payload || !Array.isArray(payload.prompts)) throw new Error('当前模型未返回 prompts 数组');
    const allowed = new Set(allowedIndexes.map(Number));
    const seen = new Set();
    const prompts = [];
    for (const item of payload.prompts) {
        const paragraphIndex = Number(item?.after_paragraph_index);
        if (!Number.isInteger(paragraphIndex) || !allowed.has(paragraphIndex)) continue;
        const tags = Array.isArray(item?.prompt_tags)
            ? item.prompt_tags.map(tag => String(tag).trim()).filter(Boolean)
            : String(item?.prompt || '').split(',').map(tag => tag.trim()).filter(Boolean);
        const promptText = tags.join(', ');
        const key = promptText.toLowerCase();
        if (tags.length < 12 || tags.length > 48 || /[\u3400-\u9fff\uf900-\ufaff]/.test(promptText) || seen.has(key)) continue;
        if (!extractImagePrompts(`[${promptText}]`).length) continue;
        seen.add(key);
        prompts.push({ after_paragraph_index: paragraphIndex, prompt_tags: tags });
    }
    if (prompts.length < missingCount) throw new Error(`当前模型只返回 ${prompts.length}/${missingCount} 个有效 Prompt`);
    return prompts.slice(0, missingCount);
}

async function generateQuietFallbackPayload(prompt, schema, responseLength) {
    try {
        return await generateQuietPrompt({
            quietPrompt: prompt,
            quietName: 'JANIMA Prompt Rescue',
            skipWIAN: true,
            responseLength,
            jsonSchema: schema,
            trimToSentence: false,
        });
    } catch (structuredError) {
        console.debug(`[${EXT_NAME}] 结构化输出不可用，改用严格 JSON 文本`, structuredError);
        return generateQuietPrompt({
            quietPrompt: prompt,
            quietName: 'JANIMA Prompt Rescue',
            skipWIAN: true,
            responseLength,
            trimToSentence: false,
        });
    }
}

function invalidPromptsForQuietRepair(validation) {
    const repairable = new Set([
        'contains_chinese',
        'people_conflict',
        'solo_relation_conflict',
        'identity_anchor_missing',
        'multi_character_separation_missing',
        'ambiguous_named_prop',
    ]);
    return validation.prompts.filter(item => item.issues?.some(issue => repairable.has(issue.code)));
}

function validateQuietPromptRepairResponse(raw, targetIndexes) {
    const payload = typeof raw === 'string' ? parseStrictJson(raw) : raw;
    if (!payload || !Array.isArray(payload.repairs)) throw new Error('当前模型未返回 repairs 数组');
    const targets = new Set(targetIndexes.map(Number));
    const repairs = new Map();
    for (const item of payload.repairs) {
        const promptIndex = Number(item?.prompt_index);
        if (!Number.isInteger(promptIndex) || !targets.has(promptIndex) || repairs.has(promptIndex)) continue;
        const tags = Array.isArray(item?.prompt_tags)
            ? item.prompt_tags.map(tag => String(tag).trim()).filter(Boolean)
            : String(item?.prompt || '').split(',').map(tag => tag.trim()).filter(Boolean);
        const promptText = tags.join(', ');
        if (tags.length < 12 || tags.length > 48 || /[\u3400-\u9fff\uf900-\ufaff]/.test(promptText)) continue;
        const checked = validateTurn(`Scene.\n\n[${promptText}]\n\n<!--IMG_COUNT:1-->`);
        if (!checked.prompts.length || checked.issues.some(issue => issue.severity === 'error')) continue;
        repairs.set(promptIndex, { prompt_index: promptIndex, prompt_tags: tags });
    }
    if (repairs.size !== targets.size) throw new Error(`当前模型只修复 ${repairs.size}/${targets.size} 个冲突 Prompt`);
    return [...repairs.values()];
}

async function runAutomaticQuietPromptRepair(messageId, text, validation) {
    const config = settings().fallback;
    if (!config.enabled || !config.repairInvalidPrompts) return false;
    const id = Number(messageId);
    const currentHash = stableHash(text);
    if (runtime.semanticAuditFinalHashes.get(id) === currentHash || storedSemanticAuditHash(id) === currentHash) return false;
    const targets = (config.semanticAudit ? validation.prompts : invalidPromptsForQuietRepair(validation)).slice(0, 6);
    if (!targets.length) return false;
    const hash = `${id}:${stableHash(text)}:${targets.map(item => item.index).join(',')}:quiet-prompt-repair`;
    if (runtime.quietRepairHashes.has(hash) || runtime.quietRepairInFlight.has(id)) return false;
    runtime.quietRepairHashes.add(hash);
    runtime.quietRepairInFlight.add(id);

    try {
        const targetPayload = targets.map(item => ({
            prompt_index: item.index,
            prompt: item.prompt,
            issues: item.issues.map(issue => issue.code),
            adjacent_story: promptStoryContext(text, item),
        }));
        const targetIndexes = targets.map(item => item.index);
        const dnaHint = collectCharacterDnaHints(`${text}\n${targets.map(item => item.prompt).join('\n')}`);
        const prompt = [
            'You are the silent continuity and scene-accuracy editor for image prompts in a completed SillyTavern story reply.',
            `Return a corrected prompt for every one of the ${targets.length} supplied targets, even when the original looks syntactically valid.`,
            'The adjacent story is authoritative for the exact visible people, actions, current clothing, props, location, and moment. Never omit a visible participant and never invent one.',
            'The visual DNA registry is authoritative for immutable identity. Repeat 6-10 useful immutable anchors for every named visible character in every prompt; a name alone is never enough.',
            'For two or more people: use the exact count, write a separate character block for each person, assign fixed left/right or front/back positions, require separate bodies and both faces visible when the story allows. Never turn a visible person into a shadow or silhouette.',
            'Describe named props visually instead of relying on their name. Behemoth must be a small stuffed demon mascot with a fabric doll body, bat wings, and an old gas mask, never a bird or real animal.',
            'Give the current outfit and critical prop placement one explicit weighted phrase, for example (navy and black-purple gothic dress with water-pattern trim:1.25) and (mascot perched on Leviathan shoulder:1.25). Never replace a dress with a bodysuit, leotard, lingerie, or swimsuit.',
            'Current outfit and state in the adjacent story override older card state. Preserve the original rendering style.',
            'Every repaired prompt must contain 12-48 concise English comma-separated image tags. Never rewrite story text.',
            'Return only JSON: {"repairs":[{"prompt_index":0,"prompt_tags":["masterpiece","best quality"]}]}',
            `Character DNA registry:\n${dnaHint}`,
            `Targets: ${JSON.stringify(targetPayload)}`,
        ].join('\n');
        const schema = {
            type: 'object',
            additionalProperties: false,
            properties: {
                repairs: {
                    type: 'array',
                    minItems: targets.length,
                    maxItems: targets.length,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            prompt_index: { type: 'integer', enum: targetIndexes },
                            prompt_tags: { type: 'array', minItems: 12, maxItems: 48, items: { type: 'string' } },
                        },
                        required: ['prompt_index', 'prompt_tags'],
                    },
                },
            },
            required: ['repairs'],
        };
        const raw = await generateQuietFallbackPayload(prompt, schema, Math.max(1200, Number(config.responseLength || 2400)));
        const repairs = validateQuietPromptRepairResponse(raw, targetIndexes);
        let next = text;
        for (const repair of [...repairs].sort((a, b) => b.prompt_index - a.prompt_index)) {
            next = replacePromptAt(next, validation.prompts[repair.prompt_index], `[${repair.prompt_tags.join(', ')}]`);
        }
        const finalHash = stableHash(next);
        runtime.semanticAuditFinalHashes.set(id, finalHash);
        const message = chat?.[id];
        if (message) {
            message.extra ||= {};
            message.extra.janimaSemanticAuditHash = finalHash;
        }
        if (next !== text) await writeMessage(id, next, 'janima-current-model-prompt-repair');
        else await saveChatConditional?.();
        setDebug(id, {
            repairMode: config.semanticAudit ? 'current-model-semantic-audit' : 'current-model-prompt-repair',
            repairedPromptIndexes: targetIndexes,
            repairedPrompt: next !== text ? 'scene-and-identity-prompts-replaced' : 'already-correct',
        });
        return next !== text;
    } catch (error) {
        runtime.semanticAuditFinalHashes.set(id, currentHash);
        await persistSemanticAuditHash(id, currentHash);
        setDebug(id, { repairMode: 'current-model-prompt-repair', error: error.message });
        console.warn(`[${EXT_NAME}] 当前模型 Prompt 纠错失败，原 Prompt 保持不变`, error);
        return false;
    } finally {
        runtime.quietRepairInFlight.delete(id);
    }
}

async function runAutomaticQuietFallback(messageId, text, validation) {
    const config = settings().fallback;
    if (!config.enabled) return false;
    // The greeting (message 0) is character-card boilerplate, not a normal
    // generated story turn. Never launch a slow fallback request on each reload.
    if (Number(messageId) === 0) return false;
    const candidates = storyParagraphCandidates(text);
    if (!candidates.length) return false;
    const minimum = Math.max(3, Math.min(6, Number(config.minimumImages || 3)));
    const maximum = Math.max(minimum, Math.min(6, Number(config.maximumImages || 6)));
    const desired = config.adaptive ? desiredImageCount(text, { minimum, maximum }) : minimum;
    const missingCount = Math.max(0, desired - validation.prompts.length);
    if (!missingCount) return false;

    const hash = `${messageId}:${stableHash(text)}:${desired}:quiet-fallback`;
    if (runtime.fallbackHashes.has(hash) || runtime.fallbackInFlight.has(Number(messageId))) return false;
    runtime.fallbackHashes.add(hash);
    runtime.fallbackInFlight.add(Number(messageId));

    try {
        const occupied = new Set(anchoredStoryIndexes(text, validation.prompts, candidates));
        const unused = candidates.filter(item => !occupied.has(item.index));
        const allowedCandidates = unused.length >= missingCount ? unused : candidates;
        const allowedIndexes = allowedCandidates.map(item => item.index);
        const paragraphPayload = allowedCandidates.slice(0, 30).map(item => ({
            after_paragraph_index: item.index,
            text: item.text.slice(0, 700),
        }));
        const dnaHint = collectCharacterDnaHints(text);
        const prompt = [
            'You are a silent image-prompt rescue pass for a completed SillyTavern story reply.',
            `Create exactly ${missingCount} missing inline image prompts so the turn reaches ${desired} images.`,
            'Select the strongest distinct visual beats. Prefer character entrances, interactions, strong expressions, action changes, outfit changes, important props, and location transitions.',
            'Use the supplied after_paragraph_index values exactly. Use distinct paragraphs whenever possible.',
            'Every prompt must be 12-48 concise English comma-separated image tags: quality, exact people count, full visual DNA for every visible named character, current clothing, action, prop, location, expression, spatial relation, shot, composition, lighting.',
            'Repeat immutable face, hair, eye, body-build, and signature clothing anchors in every prompt; a character name alone is never an identity description.',
            'For multi-character scenes use exact count, separate character blocks, fixed left/right or front/back positions, separate bodies, and both faces visible when the story permits.',
            'Describe named props visually. Behemoth is a small stuffed demon mascot with a fabric doll body, bat wings, and an old gas mask, never a bird or real animal.',
            'Give current clothing and critical prop placement one weighted phrase at 1.20-1.30. Do not replace a dress or ceremonial garment with a bodysuit, leotard, lingerie, or swimsuit.',
            'Never invent a person, touch, outfit, prop, action, or location. No Chinese, prose, markdown, square brackets, explanation, or story rewrite.',
            'Return only JSON: {"prompts":[{"after_paragraph_index":0,"prompt_tags":["masterpiece","best quality"]}]}',
            `Character DNA registry:\n${dnaHint}`,
            `Existing valid prompts: ${JSON.stringify(validation.prompts.map(item => item.prompt))}`,
            `Candidate story paragraphs: ${JSON.stringify(paragraphPayload)}`,
        ].join('\n');
        const schema = {
            type: 'object',
            additionalProperties: false,
            properties: {
                prompts: {
                    type: 'array',
                    minItems: missingCount,
                    maxItems: missingCount,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            after_paragraph_index: { type: 'integer', enum: allowedIndexes },
                            prompt_tags: { type: 'array', minItems: 12, maxItems: 48, items: { type: 'string' } },
                        },
                        required: ['after_paragraph_index', 'prompt_tags'],
                    },
                },
            },
            required: ['prompts'],
        };
        const raw = await generateQuietFallbackPayload(prompt, schema, Math.max(1200, Number(config.responseLength || 2400)));
        const missingPrompts = validateQuietFallbackResponse(raw, allowedIndexes, missingCount);
        const next = updateCountMarker(applyMissingPrompts(text, missingPrompts), validation.prompts.length + missingPrompts.length);
        await writeMessage(messageId, next, 'janima-current-model-fallback');
        setDebug(messageId, {
            repairMode: 'current-model-fallback',
            desiredImageCount: desired,
            insertedImageCount: missingPrompts.length,
            insertParagraphIndex: missingPrompts.map(item => item.after_paragraph_index),
        });
        return true;
    } catch (error) {
        setDebug(messageId, { repairMode: 'current-model-fallback', error: error.message, desiredImageCount: desired });
        console.warn(`[${EXT_NAME}] 当前模型自动补图失败，原文保持不变`, error);
        return false;
    } finally {
        runtime.fallbackInFlight.delete(Number(messageId));
    }
}

async function runAutomaticAiAudit(messageId, text, validation) {
    const config = settings().api;
    if (!config.enabled || !config.autoAudit) return false;
    const hash = `${messageId}:${stableHash(text)}:silent-ai-audit`;
    if (runtime.auditedHashes.has(hash)) return false;
    runtime.auditedHashes.add(hash);
    try {
        const audit = validateSilentAuditResponse(await callRepairApi(
            'Audit one SillyTavern story reply and its existing image prompts. Keep at least 3 valid images per normal story turn and allow 4-6 when plot beats or locations change quickly. Remove only duplicates, invented content, or prompts that contradict the adjacent story. Repair wrong people counts, clothing, actions, props, and locations. Add missing high-value shots immediately after their matching story paragraphs. Never rewrite story text. Return strict JSON with remove_prompt_indexes, replace_prompts[{prompt_index,prompt_tags}], missing_prompts[{after_paragraph_index,prompt_tags}], reasons.',
            {
                assistant_reply: text,
                existing_prompts: validation.prompts.map(prompt => ({ prompt_index: prompt.index, paragraph_index: prompt.paragraphIndex, prompt: prompt.prompt })),
                declared_img_count: validation.declaredImageCount,
                relevant_character_dna: config.characterDna || '',
            },
        ));
        const next = applySilentAuditPatch(text, audit);
        if (next !== text) await writeMessage(messageId, next, 'janima-silent-ai-audit');
        setDebug(messageId, { repairMode: 'silent-ai-audit', reasons: audit.reasons, repairedPrompt: next !== text ? 'message-patched' : '' });
        return next !== text;
    } catch (error) {
        setDebug(messageId, { repairMode: 'silent-ai-audit', error: error.message });
        console.warn(`[${EXT_NAME}] 静默 AI 审计失败，原文保持不变`, error);
        return false;
    }
}

async function renderMessageCheck(messageId) {
    if (!settings().enabled || !isAssistantMessage(messageId) || runtime.ignored.has(Number(messageId))) return;
    const host = messageElement(messageId);
    if (!host) return;
    removeLegacyConversationUi(host);
    const text = getMessageText(messageId);
    const validation = validateTurn(text);
    const previousDebug = runtime.debugByMessage.get(Number(messageId));
    const currentHash = stableHash(text);
    setDebug(messageId, {
        ...baseDebug(messageId, validation),
        ...(previousDebug?.messageContentHash === currentHash ? previousDebug : {}),
        declaredImageCount: validation.declaredImageCount,
        detectedPromptCount: validation.detectedPromptCount,
        messageContentHash: currentHash,
    });
    const localRepairKey = `${messageId}:${currentHash}`;
    if (settings().autoLocalRepair && !runtime.localRepairHashes.has(localRepairKey)) {
        runtime.localRepairHashes.add(localRepairKey);
        const local = buildSafeLocalRepair(text, validation);
        if (local.changed) {
            await writeMessage(messageId, local.text, 'janima-silent-local-repair');
            setDebug(messageId, { repairMode: 'silent-local', repairedPrompt: 'safe-normalization' });
            return;
        }
    }
    if (await runAutomaticQuietPromptRepair(messageId, text, validation)) return;
    if (await runAutomaticQuietFallback(messageId, text, validation)) return;
    markZhihuijiButtonsInline(messageId);
    nudgeZhihuijiObserver(messageId, validation);
    setTimeout(() => markZhihuijiButtonsInline(messageId), 350);
    await runAutomaticAiAudit(messageId, text, validation);
}

function scheduleCheck(messageId, delay = 80) {
    const id = Number(messageId);
    if (!Number.isInteger(id) || runtime.writing.has(id)) return;
    setTimeout(() => renderMessageCheck(id).catch(error => console.warn(`[${EXT_NAME}] 静默检查失败`, error)), delay);
}

async function writeMessage(messageId, nextText, source) {
    const id = Number(messageId);
    const message = chat?.[id];
    if (!message) throw new Error('消息不存在');
    runtime.writing.add(id);
    message.mes = nextText;
    try {
        await saveChatConditional?.();
        await eventSource.emit(event_types.MESSAGE_UPDATED, id, source || EXT_ID);
    } finally {
        runtime.writing.delete(id);
    }
    scheduleCheck(id, 120);
}

function currentPrompt(messageId, promptIndex) {
    const text = getMessageText(messageId);
    const validation = validateTurn(text);
    const prompt = validation.prompts[Number(promptIndex)];
    if (!prompt) throw new Error('Prompt 已变化或不存在，请重新检查');
    return { text, validation, prompt };
}

function promptStoryContext(text, prompt) {
    const paragraphs = paragraphRanges(text);
    const isPromptParagraph = item => extractImagePrompts(item.text).length > 0 || /^<!--\s*IMG_COUNT/.test(item.text.trim());
    let sceneIndex = prompt.paragraphIndex - 1;
    while (sceneIndex >= 0 && isPromptParagraph(paragraphs[sceneIndex])) sceneIndex--;
    return {
        before: paragraphs[sceneIndex - 1]?.text || '',
        current: paragraphs[sceneIndex]?.text || '',
        after: paragraphs[sceneIndex + 1]?.text && !isPromptParagraph(paragraphs[sceneIndex + 1]) ? paragraphs[sceneIndex + 1].text : '',
        paragraphIndex: sceneIndex,
    };
}

function endpoint(url) {
    const clean = String(url || '').trim().replace(/\/$/, '');
    if (!clean) throw new Error('请先填写 API URL');
    return /\/chat\/completions$/i.test(clean) ? clean : `${clean}/chat/completions`;
}

async function callRepairApi(systemPrompt, payload) {
    const config = settings().api;
    if (!config.enabled) throw new Error('AI 修复未启用');
    if (!config.model) throw new Error('请先填写模型名称');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(config.timeoutMs || 10000)));
    try {
        const response = await fetch(endpoint(config.url), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}),
            },
            body: JSON.stringify({
                model: config.model,
                temperature: 0,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: JSON.stringify(payload) },
                ],
            }),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`API ${response.status}: ${(await response.text()).slice(0, 240)}`);
        const json = await response.json();
        const content = json?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error('API 响应缺少 message.content');
        return parseStrictJson(content);
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error('AI 请求超时，原 Prompt 已保留');
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function repairOnePrompt(messageId, promptIndex) {
    const { text, validation, prompt } = currentPrompt(messageId, promptIndex);
    const context = promptStoryContext(text, prompt);
    const key = makeCacheKey({ messageId, messageContent: text, originalPrompt: prompt.prompt, repairMode: 'ai' });
    let repaired = runtime.cache.get(key);
    const cacheHit = Boolean(repaired);
    if (!repaired) {
        repaired = assertPromptRepairResponse(await callRepairApi(
            'You repair an existing Stable Diffusion/Anima tag prompt. Preserve its subject, characters, action, and location. Fix only explicit count, current clothing/action, invented people/interactions, and concise tag grammar. Return strict JSON with prompt_tags, negative_tags, changes, confidence. Never return prose or markdown.',
            {
                original_worldbook_prompt: prompt.prompt,
                previous_paragraph: context.before,
                scene_paragraph: context.current,
                next_paragraph: context.after,
                relevant_character_dna: settings().api.characterDna || '',
            },
        ));
        runtime.cache.set(key, repaired);
    }
    const replacement = `[${repaired.prompt_tags.join(', ')}]`;
    await writeMessage(messageId, replacePromptAt(text, prompt, replacement), 'janima-rescue-ai-prompt');
    setDebug(messageId, {
        ...baseDebug(messageId, validation, Number(promptIndex)),
        repairedPrompt: replacement,
        repairMode: 'ai',
        cacheHit,
        changes: repaired.changes,
        negativeTags: repaired.negative_tags,
        messageContentHash: stableHash(getMessageText(messageId)),
    });
    toast('success', cacheHit ? '已使用缓存修复 Prompt' : 'Prompt 修复完成');
}

async function repairWholeTurn(messageId) {
    const text = getMessageText(messageId);
    const validation = validateTurn(text);
    if (validation.declaredImageCount === null) throw new Error('缺少 IMG_COUNT，无法判断应补数量');
    const missingCount = validation.declaredImageCount - validation.detectedPromptCount;
    if (missingCount <= 0) throw new Error('本轮没有缺失 Prompt');
    const key = makeCacheKey({ messageId, messageContent: text, originalPrompt: validation.prompts.map(item => item.prompt).join('\n'), repairMode: 'wholeTurn' });
    let repaired = runtime.cache.get(key);
    const cacheHit = Boolean(repaired);
    if (!repaired) {
        repaired = assertWholeTurnResponse(await callRepairApi(
            'You fill only missing image prompts in one assistant turn. Never rewrite story text or existing prompts. Return strict JSON {"missing_prompts":[{"after_paragraph_index":0,"anchor_text":"","prompt_tags":[]}]} using short English image tags. The array length must equal missing_count.',
            {
                assistant_reply: text,
                existing_prompts: validation.prompts.map(item => item.prompt),
                declared_img_count: validation.declaredImageCount,
                missing_count: missingCount,
                relevant_character_dna: settings().api.characterDna || '',
            },
        ));
        if (repaired.missing_prompts.length !== missingCount) throw new Error(`AI 返回 ${repaired.missing_prompts.length} 张，预期 ${missingCount} 张`);
        runtime.cache.set(key, repaired);
    }
    const nextText = applyMissingPrompts(text, repaired.missing_prompts);
    await writeMessage(messageId, nextText, 'janima-rescue-whole-turn');
    setDebug(messageId, {
        ...baseDebug(messageId, validation),
        repairMode: 'wholeTurn',
        cacheHit,
        insertParagraphIndex: repaired.missing_prompts.map(item => item.after_paragraph_index),
        messageContentHash: stableHash(getMessageText(messageId)),
    });
    toast('success', `已在对应段落补入 ${missingCount} 张图`);
}

function verifiedZhihuijiButtons(messageId) {
    const host = messageElement(messageId);
    if (!host || !settings().chatu8.enabled) return [];
    return [...host.querySelectorAll(VERIFIED_ZHIHUIJI_SELECTOR)].filter(node => {
        const rawPrompt = node.dataset.imageTag || node.dataset.link || node.dataset.change || '';
        return node instanceof HTMLElement && isLikelyImagePrompt(rawPrompt);
    });
}

async function waitForZhihuijiButton(messageId, promptIndex) {
    const timeout = Math.max(250, Number(settings().chatu8.buttonWaitMs || 3500));
    const started = Date.now();
    do {
        const buttons = verifiedZhihuijiButtons(messageId);
        if (buttons[Number(promptIndex)]) return buttons[Number(promptIndex)];
        await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() - started < timeout);
    return null;
}

async function rescanZhihuiji(messageId, promptIndex) {
    nudgeZhihuijiObserver(Number(messageId));
    await eventSource.emit(event_types.MESSAGE_UPDATED, Number(messageId), 'janima-rescue-rescan');
    const buttonNode = await waitForZhihuijiButton(messageId, promptIndex);
    setDebug(messageId, {
        zhihuijiButtonFound: Boolean(buttonNode),
        zhihuijiRoute: buttonNode ? VERIFIED_ZHIHUIJI_SELECTOR : 'not-found',
        generationStatus: buttonNode ? 'button-ready' : 'button-not-found',
    });
    if (!buttonNode) throw new Error('智绘姬真实按钮未出现，请检查智绘姬标记和启用状态');
    toast('success', '已找到智绘姬真实生图按钮');
    return buttonNode;
}

async function generateWithZhihuiji(messageId, promptIndex) {
    const buttonNode = verifiedZhihuijiButtons(messageId)[Number(promptIndex)] || await rescanZhihuiji(messageId, promptIndex);
    if (buttonNode.dataset.loading === 'true') throw new Error('智绘姬正在处理此 Prompt');
    buttonNode.click();
    setDebug(messageId, {
        zhihuijiButtonFound: true,
        zhihuijiRoute: `${VERIFIED_ZHIHUIJI_SELECTOR} -> HTMLElement.click()`,
        generationRequested: true,
        generationStatus: buttonNode.dataset.loading === 'true' ? 'loading' : 'clicked',
    });
    toast('success', '已点击智绘姬真实生图按钮');
}

async function copyText(text, success) {
    await navigator.clipboard.writeText(String(text));
    toast('success', success);
}

async function localReinforce(messageId, promptIndex) {
    const { text, validation, prompt } = currentPrompt(messageId, promptIndex);
    const replacement = reinforcePromptLocal(prompt.prompt);
    await writeMessage(messageId, replacePromptAt(text, prompt, replacement), 'janima-rescue-local');
    setDebug(messageId, {
        ...baseDebug(messageId, validation, Number(promptIndex)),
        repairedPrompt: replacement,
        repairMode: 'local',
        cacheHit: false,
        messageContentHash: stableHash(getMessageText(messageId)),
    });
    toast('success', '已完成确定性本地补强');
}

async function handlePanelAction(event) {
    const control = event.target.closest('[data-action][data-message-id]');
    if (!control) return;
    const messageId = Number(control.dataset.messageId);
    const promptIndex = Number(control.dataset.promptIndex || 0);
    try {
        switch (control.dataset.action) {
            case 'ignore':
                runtime.ignored.add(messageId);
                control.closest('.janima-rescue-panel')?.remove();
                break;
            case 'recheck': renderMessageCheck(messageId); break;
            case 'local': await localReinforce(messageId, promptIndex); break;
            case 'repair-prompt': await repairOnePrompt(messageId, promptIndex); break;
            case 'repair-turn': await repairWholeTurn(messageId); break;
            case 'rescan': await rescanZhihuiji(messageId, promptIndex); break;
            case 'generate': await generateWithZhihuiji(messageId, promptIndex); break;
            case 'copy-prompt': {
                const { prompt } = currentPrompt(messageId, promptIndex);
                await copyText(`[${prompt.prompt}]`, 'Prompt 已复制');
                break;
            }
            case 'copy-debug': {
                const current = currentPrompt(messageId, promptIndex);
                const debug = { ...baseDebug(messageId, current.validation, promptIndex), ...(runtime.debugByMessage.get(messageId) || {}) };
                await copyText(JSON.stringify(debug, null, 2), 'Debug 已复制');
                break;
            }
        }
    } catch (error) {
        setDebug(messageId, { error: error.message, generationStatus: 'error' });
        toast('error', error.message);
    }
}

function selectionFromPage() {
    const selection = window.getSelection?.();
    const selectedText = selection?.toString().trim();
    if (!selectedText || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const host = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer.closest?.('.mes')
        : range.commonAncestorContainer.parentElement?.closest?.('.mes');
    if (!host) return null;
    const rawId = host.getAttribute('mesid') || host.dataset.mesId;
    const messageId = Number(rawId || [...document.querySelectorAll('.mes')].indexOf(host));
    if (!isAssistantMessage(messageId)) return null;
    const paragraphIndex = findSelectedParagraph(getMessageText(messageId), selectedText);
    if (paragraphIndex < 0) return null;
    const rect = range.getBoundingClientRect();
    return { messageId, selectedText, paragraphIndex, x: Math.min(window.innerWidth - 180, Math.max(8, rect.left)), y: Math.max(8, rect.bottom + 8), at: Date.now() };
}

function hideSelectionMenu() {
    document.querySelectorAll('.janima-rescue-selection-menu').forEach(node => node.remove());
}

function showSelectionMenu(capture) {
    hideSelectionMenu();
    const menu = document.createElement('div');
    menu.className = 'janima-rescue-selection-menu';
    menu.style.left = `${capture.x}px`;
    menu.style.top = `${capture.y}px`;
    const add = button('补一张图', 'manual-fill', capture.messageId);
    add.dataset.paragraphIndex = String(capture.paragraphIndex);
    const cancel = button('取消', 'selection-cancel', capture.messageId);
    menu.append(add, cancel);
    document.body.append(menu);
}

function captureSelection() {
    if (!settings().enabled || !settings().selectionFill) return;
    const capture = selectionFromPage();
    if (!capture) return;
    runtime.selection = capture;
    clearTimeout(runtime.selectionTimer);
    runtime.selectionTimer = setTimeout(() => { runtime.selection = null; hideSelectionMenu(); }, 30000);
    showSelectionMenu(capture);
}

async function manualFill(capture) {
    const text = getMessageText(capture.messageId);
    const paragraphs = paragraphRanges(text);
    const existing = extractImagePrompts(text);
    const key = makeCacheKey({ messageId: capture.messageId, messageContent: text, originalPrompt: capture.selectedText, repairMode: 'manualFill' });
    let result = runtime.cache.get(key);
    const cacheHit = Boolean(result);
    if (!result) {
        result = assertPromptRepairResponse(await callRepairApi(
            'Create one concise Stable Diffusion/Anima prompt for the selected story paragraph. Return strict JSON with prompt_tags, negative_tags, changes, confidence. Use English comma-separated image tags, no prose, no invented people or actions.',
            {
                selected_paragraph: capture.selectedText,
                previous_paragraph: paragraphs[capture.paragraphIndex - 1]?.text || '',
                next_paragraph: paragraphs[capture.paragraphIndex + 1]?.text || '',
                relevant_character_dna: settings().api.characterDna || '',
                recent_worldbook_prompt_as_format_reference: existing.at(-1)?.prompt || '',
            },
        ));
        runtime.cache.set(key, result);
    }
    const wrapped = `[${result.prompt_tags.join(', ')}]`;
    if (!window.confirm(`补入这张图？\n\n${wrapped}`)) return;
    await writeMessage(capture.messageId, insertPromptAfterParagraph(text, capture.paragraphIndex, wrapped), 'janima-rescue-manual-fill');
    setDebug(capture.messageId, {
        repairMode: 'manualFill',
        cacheHit,
        insertParagraphIndex: capture.paragraphIndex,
        repairedPrompt: wrapped,
        messageContentHash: stableHash(getMessageText(capture.messageId)),
    });
    toast('success', '已把 Prompt 插入选中段落下方');
}

async function handleSelectionAction(event) {
    const control = event.target.closest('.janima-rescue-selection-menu [data-action]');
    if (!control) return;
    const action = control.dataset.action;
    const capture = runtime.selection;
    hideSelectionMenu();
    if (action === 'selection-cancel' || !capture) return;
    try { await manualFill(capture); }
    catch (error) { toast('error', error.message); }
}

function settingsHtml() {
    return `
        <div id="janima_rescue_settings" class="janima-rescue-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>世界书生图救援器 <small>v${EXT_VERSION}</small></b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <p class="notes">默认完全静默：不在正文旁边显示状态条或工具栏。插件只在后台规范 Prompt，并把智绘姬按钮保持在对应剧情段落下。</p>
                    <h4>基础设置</h4>
                    ${checkRow('enabled', '启用救援插件')}
                    ${checkRow('autoCheck', '自动检查最新回复')}
                    ${checkRow('silentMode', '静默模式（不向对话插入插件界面）')}
                    ${checkRow('autoLocalRepair', '自动本地纠错（不调用 AI）')}
                    <h4>缺图自动兜底</h4>
                    ${checkRow('fallback.enabled', '少于目标数时用酒馆当前模型静默补 Prompt')}
                    ${checkRow('fallback.repairInvalidPrompts', '用酒馆当前模型静默修正 Prompt')}
                    ${checkRow('fallback.semanticAudit', '逐图 AI 深度重审（较慢，默认关闭）')}
                    ${checkRow('fallback.adaptive', '快节奏/多转场时自动增加图片')}
                    ${fieldRow('fallback.minimumImages', '每轮最少图片', '3', 'number')}
                    ${fieldRow('fallback.maximumImages', '每轮最多图片', '6', 'number')}
                    ${fieldRow('fallback.responseLength', '兜底模型回复上限', '1200', 'number')}
                    <h4>API 设置</h4>
                    ${checkRow('api.enabled', '启用 AI 救援')}
                    ${checkRow('api.autoAudit', '每轮后台 AI 审计（补漏、删错图、修冲突）')}
                    ${fieldRow('api.url', 'API URL', 'https://example.com/v1')}
                    ${fieldRow('api.key', 'API Key', '', 'password')}
                    ${fieldRow('api.model', '模型', 'model-name')}
                    ${fieldRow('api.timeoutMs', 'Timeout (ms)', '10000', 'number')}
                    <label>当前相关角色 DNA<textarea class="text_pole" name="api.characterDna" rows="4" placeholder="只填写当前相关角色的固定外貌与当前服装"></textarea></label>
                    <h4>智绘姬设置</h4>
                    ${checkRow('chatu8.enabled', '启用智绘姬适配')}
                    ${checkRow('chatu8.inlineButtons', '按钮保持在对应剧情段落下')}
                    ${checkRow('chatu8.accuracyWorkflow', '启用 JANIMA Galgame Turbo 8 步实时工作流')}
                    ${fieldRow('chatu8.startTag', '开始标记', '[')}
                    ${fieldRow('chatu8.endTag', '结束标记', ']')}
                    ${fieldRow('chatu8.rescanTimeoutMs', '重新识别超时 (ms)', '3500', 'number')}
                    ${fieldRow('chatu8.buttonWaitMs', '生成按钮等待时间 (ms)', '3500', 'number')}
                    <p class="notes">AI 审计只有在“启用 AI 救援”并填写 API 后才会请求；失败时原正文和 Prompt 保持不变。</p>
                </div>
            </div>
        </div>`;
}

function checkRow(name, label) {
    return `<label class="checkbox_label"><input type="checkbox" name="${name}"><span>${label}</span></label>`;
}

function fieldRow(name, label, placeholder, type = 'text') {
    return `<label>${label}<input class="text_pole" type="${type}" name="${name}" placeholder="${placeholder}"></label>`;
}

function getPath(object, path) {
    return path.split('.').reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
    const keys = path.split('.');
    const final = keys.pop();
    const parent = keys.reduce((target, key) => target[key], object);
    parent[final] = value;
}

function syncSettingsUi() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    const config = settings();
    root?.querySelectorAll('[name]').forEach(input => {
        const value = getPath(config, input.name);
        if (input.type === 'checkbox') input.checked = Boolean(value);
        else input.value = value ?? '';
    });
}

function bindSettings() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    root?.addEventListener('change', event => {
        const input = event.target.closest('[name]');
        if (!input) return;
        let value = input.type === 'checkbox' ? input.checked : input.value;
        if (input.type === 'number') value = Number(value);
        setPath(settings(), input.name, value);
        saveSettingsDebounced();
        if (['enabled', 'silentMode', 'autoLocalRepair', 'fallback.enabled', 'fallback.repairInvalidPrompts', 'fallback.semanticAudit', 'fallback.adaptive', 'fallback.minimumImages', 'fallback.maximumImages', 'chatu8.inlineButtons', 'chatu8.accuracyWorkflow'].includes(input.name)) {
            removeLegacyConversationUi();
            if (input.name === 'chatu8.accuracyWorkflow') configureChatu8AccuracyWorkflow();
            if (settings().enabled) scanLatestAssistant();
        }
    });
}

function scanLatestAssistant() {
    for (let index = (chat?.length || 0) - 1; index >= 0; index--) {
        if (isAssistantMessage(index)) { scheduleCheck(index); return; }
    }
}

function bindEvents() {
    const onMessage = messageId => {
        if (settings().autoCheck) scheduleCheck(messageId, 120);
    };
    [event_types.MESSAGE_RECEIVED, event_types.MESSAGE_UPDATED, event_types.MESSAGE_SWIPED]
        .filter(Boolean)
        .forEach(type => eventSource.on(type, onMessage));
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(scanLatestAssistant, 200));
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            const host = mutation.target?.closest?.('.mes');
            const rawId = host?.getAttribute?.('mesid') || host?.dataset?.mesId;
            const messageId = Number(rawId);
            if (Number.isInteger(messageId) && messageId >= 0) markZhihuijiButtonsInline(messageId);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

jQuery(async () => {
    settings();
    configureChatu8AccuracyWorkflow();
    removeLegacyConversationUi();
    const container = document.querySelector('#extensions_settings') || document.querySelector('#extensions_settings2');
    if (container && !document.querySelector(SETTINGS_SELECTOR)) container.insertAdjacentHTML('beforeend', settingsHtml());
    syncSettingsUi();
    bindSettings();
    bindEvents();
    scanLatestAssistant();
    console.info(`[${EXT_NAME}] v${EXT_VERSION} loaded in silent mode; verified Zhihuiji route: ${VERIFIED_ZHIHUIJI_SELECTOR}`);
});
