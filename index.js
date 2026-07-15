import {
    chat,
    characters,
    eventSource,
    event_types,
    generateQuietPrompt,
    saveChatConditional,
    saveSettingsDebounced,
    this_chid,
    updateMessageBlock,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { buildVisualDnaHint, visualLocksForText } from './lib/identity-locks.mjs';
import { installAnimaAccuracyWorkflow } from './lib/anima-workflow.mjs';
import {
    analyzeStoryboardCoverage,
    applyMissingPrompts,
    assertPromptRepairResponse,
    assertWholeTurnResponse,
    extractImagePrompts,
    findSelectedParagraph,
    hasVisibleFemaleStoryBeat,
    insertPromptAfterParagraph,
    isExplicitNoFemaleStory,
    isLikelyImagePrompt,
    makeCacheKey,
    paragraphRanges,
    parseStrictJson,
    planStoryboardSlots,
    reinforcePromptLocal,
    replacePromptAt,
    replaceStoryboardPrompts,
    stableHash,
    storyActionPhase,
    storyActionTypes,
    storyParagraphCandidates,
    storySegmentsForPrompts,
    splitTags,
    validateTurn,
} from './lib/rescue-core.mjs';
import {
    createCharacterRegistry,
    extractShotPackets,
    extractStoryboardLedgers,
    findQuoteEvidence,
    repairStoryboardFromEvidence,
    repairStoryboardFromLedger,
} from './lib/story-evidence.mjs';

const EXT_ID = 'codex_scene_image_director';
const EXT_NAME = '世界书生图救援器';
const EXT_VERSION = '1.11.5';
const SETTINGS_SELECTOR = '#janima_rescue_settings';
const VERIFIED_ZHIHUIJI_SELECTOR = '.st-chatu8-image-button';
const BLOCKING_IMAGE_ISSUE_CODES = new Set([
    'female_subject_missing',
    'empty_story_segment',
    'people_conflict',
    'solo_relation_conflict',
    'ambiguous_named_prop',
]);
const ADULT_EVENT_PHASES = new Set(['erotic_touch', 'manual_stimulation', 'oral_sex', 'penetration', 'position_change', 'climax', 'aftercare']);

const STORYBOARD_LEDGER_CONTRACT = `[JANIMA_STORYBOARD_V2]
Write the natural Galgame story first. Do not write visible image prompts, image buttons, IMG_COUNT, analysis, or a storyboard table. Before generating, silently plan the complete reply and reserve enough output budget for one compact hidden ledger at the very end. Never call or wait for a second model.

After the final story/variable text, output exactly one HTML comment and nothing after it:
<!--JANIMA_STORYBOARD_V2:{"version":2,"shots":[{"id":"s1","quote":"exact 6-360 character verbatim story substring","people":"1girl or 1girl and 1boy or 2girls","cast":[{"id":"stable story name","prompt_name":"stable English image-model name","dna":"English immutable adult sex, build, skin, face, hair and eye tags","outfit":"English current clothing or nudity tags","identity_change":false,"outfit_change":false}],"action":"English initiator + exact visible physical action/contact + receiver/object + visible result","setting":"English current place and critical props","expression":"English current visible emotion","composition":"English character positions, shot and lighting","safety":"safe or sensitive or nsfw or explicit"}]}-->

The ledger is authored after you know the entire reply. List shots in story order. Each quote must be copied byte-for-byte from a different completed story paragraph and must prove the decisive visible instant; never paraphrase, use ellipsis, quote future text, or reuse one continuous action. The plugin inserts each button immediately after the paragraph containing quote.

Normally choose 3 distinct female-present events distributed across opening, middle and ending. Use 4-6 for real action, location, outfit, relationship, combat-result or adult-stage changes. Use 1-2 only if the whole reply truly contains fewer independent visual events. Score candidates by plot consequence, physical state/contact change, emotional intensity and visual specificity; choose the highest-scoring event in each window since the previous shot, not a generic portrait, standing pose, blush or background.

Every shot must contain a woman truly present in its quote/window. A man may appear only in a real interaction with her. Never invent a woman or output male-only, scenery-only, building-only or prop-only shots. action must be a literal English visual translation of quote with named initiator, receiver/object, exact contact/pose and visible result. People, clothing/nudity, props, location and emotion must match that moment.

Reuse stable cast.id, prompt_name and byte-identical immutable dna across shots and turns. Keep outfit byte-identical when the story leaves clothing unspecified; if quote explicitly states the current outfit or nudity, outfit must match that visible state even when the transition happened offscreen. Set outfit_change true only for an on-page change/removal proved by quote. For multiple people use separate cast records and explicit positions. Adult consensual events are not censored: undressing, erotic touch, manual/oral action, first penetration, continued penetration, position change, climax and aftercare are different stages; never replace the exact stage with an embrace, kneeling portrait or vague intimacy. Use explicit for explicit contact.
[/JANIMA_STORYBOARD_V2]`;

const DEFAULT_SETTINGS = {
    version: 15,
    enabled: true,
    autoCheck: true,
    silentMode: true,
    // Prompt content must be correct before Chatu8 creates its button. Chatu8
    // captures the prompt in a click-listener closure, so post-render content
    // rewrites can make the visible tag differ from the ComfyUI payload.
    autoLocalRepair: false,
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
        evidenceRepair: true,
        // The primary response ends with a hidden full-story ledger. Local
        // code turns it into buttons with no second model request.
        postReplyStoryboard: false,
        sameCallEvidence: true,
        useCurrentModel: false,
        repairInvalidPrompts: false,
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
    fallbackFailures: new Map(),
    streamScanQueued: false,
    streamCompletionTimer: null,
    missingChatu8Warned: false,
    storyContractArmed: false,
    generationActive: false,
    streamingEvidenceSettles: new Map(),
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
    if (!existing || Number(existing.version) < 15) {
        const api = existing?.api || {};
        const chatu8 = existing?.chatu8 || {};
        extension_settings[EXT_ID] = mergeDefaults(DEFAULT_SETTINGS, {
            silentMode: true,
            autoLocalRepair: false,
            selectionFill: false,
            api: { enabled: false, autoAudit: true, url: api.url || '', key: api.key || '', model: api.model || '', timeoutMs: api.timeoutMs || 10000 },
            fallback: { enabled: true, evidenceRepair: true, postReplyStoryboard: false, sameCallEvidence: true, useCurrentModel: false, repairInvalidPrompts: false, semanticAudit: false, minimumImages: 3, maximumImages: 6, adaptive: true, responseLength: 1200 },
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
    const recentAnchors = [];
    for (let index = (chat?.length || 0) - 1; index >= 0 && recentAnchors.length < 3; index--) {
        const prompts = extractImagePrompts(String(chat[index]?.mes || chat[index]?.message || ''));
        for (let promptIndex = prompts.length - 1; promptIndex >= 0 && recentAnchors.length < 3; promptIndex--) {
            recentAnchors.push(prompts[promptIndex].prompt);
        }
    }
    if (recentAnchors.length) parts.push(`RECENT INLINE VISUAL ANCHORS (newest first):\n${recentAnchors.join('\n')}`);
    return parts.join('\n\n');
}

function currentCharacterLikelyFemale() {
    const character = characters?.[Number(this_chid)];
    if (!character) return false;
    const evidence = [
        character.name,
        character.description,
        character.personality,
        character.scenario,
        character.first_mes,
        character.data?.description,
        character.data?.personality,
        character.data?.scenario,
        character.data?.first_mes,
    ].filter(Boolean).join('\n').slice(0, 16000);
    return /(?:她|少女|女孩|女人|女性|女王|公主|魔女|女仆|姐姐|妹妹|妻子|女友|成年女性|\b(?:she|her|woman|girl|female|queen|princess|witch|maid|wife|girlfriend|adult woman)\b)/i.test(evidence);
}

function postReplyFemaleContext(text = '') {
    if (hasVisibleFemaleStoryBeat(text)) return { allowed: true, assumeFemale: false, source: 'direct-story' };
    if (isExplicitNoFemaleStory(text)) return { allowed: false, assumeFemale: false, source: 'explicit-no-female' };
    const namedFemaleLock = visualLocksForText(text).some(lock => lock.id !== 'behemoth');
    const cardFemale = currentCharacterLikelyFemale();
    return {
        allowed: namedFemaleLock || cardFemale,
        assumeFemale: namedFemaleLock || cardFemale,
        source: namedFemaleLock ? 'named-female-lock' : cardFemale ? 'female-character-card' : 'unconfirmed',
    };
}

function configureChatu8AccuracyWorkflow() {
    if (!settings().chatu8.enabled || !settings().chatu8.accuracyWorkflow) return false;
    const chatu8Settings = extension_settings['st-chatu8'];
    if (!chatu8Settings) {
        if (!runtime.missingChatu8Warned) {
            runtime.missingChatu8Warned = true;
            toast('warning', '未检测到智绘姬 st-chatu8；请先安装并启用智绘姬，否则不会出现生图按钮。');
        }
        return false;
    }
    runtime.missingChatu8Warned = false;
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
        }
    }
    if (changed && validation.declaredImageCount !== null) next = updateCountMarker(next, extractImagePrompts(next).length);
    return { changed, text: next };
}

function nativePromptContainsCanonical(rawPrompt, canonicalPrompt) {
    const nativeTags = new Set(splitTags(rawPrompt).map(tag => tag.toLocaleLowerCase()));
    const canonicalTags = splitTags(canonicalPrompt).map(tag => tag.toLocaleLowerCase());
    return canonicalTags.length >= 3 && canonicalTags.every(tag => nativeTags.has(tag));
}

function discardOrHideNativeButton(buttonNode) {
    const resultNode = buttonNode.nextElementSibling?.matches?.('.st-chatu8-image-span')
        ? buttonNode.nextElementSibling
        : null;
    if (!resultNode?.textContent?.trim() && !resultNode?.querySelector?.('img,video,canvas')) {
        resultNode?.remove();
        buttonNode.remove();
    } else {
        buttonNode.classList.add('janima-invalid-image-button');
        buttonNode.style.display = 'none';
        buttonNode.setAttribute('aria-hidden', 'true');
    }
}

function markZhihuijiButtonsInline(messageId) {
    if (!settings().chatu8.inlineButtons) return;
    const host = messageElement(messageId);
    const textRoot = host?.querySelector('.mes_text');
    if (!host || !textRoot) return;
    const validation = validateTurn(getMessageText(messageId));
    const buttons = [...host.querySelectorAll(VERIFIED_ZHIHUIJI_SELECTOR)];
    const validButtons = [];
    const claimedPromptIndexes = new Set();
    buttons.forEach(buttonNode => {
        const rawPrompt = buttonNode.dataset.imageTag || buttonNode.dataset.link || buttonNode.dataset.change || '';
        if (!isLikelyImagePrompt(rawPrompt)) {
            discardOrHideNativeButton(buttonNode);
            return;
        }
        const promptRecordIndex = validation.prompts.findIndex(item =>
            item.prompt === rawPrompt || nativePromptContainsCanonical(rawPrompt, item.prompt));
        if (promptRecordIndex < 0 || claimedPromptIndexes.has(promptRecordIndex)) {
            // Never expose a stale Chatu8 closure after evidence repair: its
            // visible label may look current while a click still sends the old
            // pre-repair prompt. Extra native preset tags remain compatible as
            // long as every canonical evidence tag is still present.
            discardOrHideNativeButton(buttonNode);
            return;
        }
        claimedPromptIndexes.add(promptRecordIndex);
        const promptRecord = validation.prompts[promptRecordIndex];
        const blocked = promptRecord?.issues?.some(issue => BLOCKING_IMAGE_ISSUE_CODES.has(issue.code));
        if (blocked) {
            discardOrHideNativeButton(buttonNode);
            return;
        }
        const index = validButtons.length;
        validButtons.push(buttonNode);
        buttonNode.classList.remove('janima-invalid-image-button');
        buttonNode.removeAttribute('aria-hidden');
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
        nativePayloadMismatch: buttons.some(buttonNode => {
            const raw = buttonNode.dataset.imageTag || buttonNode.dataset.link || buttonNode.dataset.change || '';
            return isLikelyImagePrompt(raw) && !validation.prompts.some(item => nativePromptContainsCanonical(raw, item.prompt));
        }),
    });
}

function nudgeZhihuijiObserver(messageId, validation = validateTurn(getMessageText(messageId))) {
    if (!settings().chatu8.enabled || !validation.prompts.length) return false;
    const id = Number(messageId);
    const key = `${id}:${stableHash(getMessageText(id))}:chatu8-observer`;
    if (runtime.zhihuijiRescanHashes.has(key)) return false;
    runtime.zhihuijiRescanHashes.add(key);

    const wake = delay => setTimeout(() => {
        if (verifiedZhihuijiButtons(id).length >= validation.prompts.length) return;
        if (delay >= 700 && chat?.[id]) updateMessageBlock(id, chat[id]);
        const host = messageElement(id);
        const textRoot = host?.querySelector('.mes_text');
        if (!textRoot) return;

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
    const finalDelay = Math.min(2400, Math.max(1200, Number(settings().chatu8.rescanTimeoutMs || 3500) - 700));
    wake(finalDelay);
    // DOM virtualization, message edits and fast consecutive generations can
    // remove a native button after the first observer pass. Rate-limit each
    // pass, but allow a later backlog scan to repair the same stable message.
    setTimeout(() => runtime.zhihuijiRescanHashes.delete(key), finalDelay + 600);
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
            operations.push({ start: prompt.start, end: prompt.end, value: reinforcePromptLocal(item.prompt_tags.join(', ')) });
        }
    }
    for (const item of audit.missing_prompts) {
        const paragraph = paragraphs[Number(item.after_paragraph_index)];
        if (paragraph && Array.isArray(item.prompt_tags) && item.prompt_tags.length) {
            operations.push({ start: paragraph.end, end: paragraph.end, value: `\n\n${reinforcePromptLocal(item.prompt_tags.join(', '))}` });
        }
    }
    let next = text;
    operations.sort((a, b) => b.start - a.start).forEach(operation => {
        next = next.slice(0, operation.start) + operation.value + next.slice(operation.end);
    });
    return updateCountMarker(next, extractImagePrompts(next).length);
}

function validateQuietStoryboardResponse(raw, slots) {
    const payload = typeof raw === 'string' ? parseStrictJson(raw) : raw;
    const sourceShots = payload?.shots || payload?.prompts;
    if (!Array.isArray(sourceShots)) throw new Error('当前模型未返回 shots 数组');
    const slotMap = new Map(slots.map(slot => [Number(slot.slotIndex), slot]));
    const seenSlots = new Set();
    const seenPrompts = new Set();
    const shots = [];
    for (const item of sourceShots) {
        const slotIndex = Number(item?.slot_index ?? item?.slotIndex);
        const paragraphIndex = Number(item?.after_paragraph_index);
        const slot = slotMap.get(slotIndex);
        const eventKey = String(item?.event_key || '');
        if (!slot || seenSlots.has(slotIndex) || eventKey !== slot.eventKey || !Number.isInteger(paragraphIndex) || !slot.paragraphIndexes.includes(paragraphIndex)) continue;
        const tags = Array.isArray(item?.prompt_tags)
            ? item.prompt_tags.map(tag => String(tag).trim()).filter(Boolean)
            : String(item?.prompt || '').split(',').map(tag => tag.trim()).filter(Boolean);
        const promptText = tags.join(', ');
        const key = promptText.toLowerCase();
        if (tags.length < 12 || tags.length > 48 || /[\u3400-\u9fff\uf900-\ufaff]/.test(promptText) || seenPrompts.has(key)) continue;
        if (ADULT_EVENT_PHASES.has(slot.actionPhase) && storyActionPhase(promptText) !== slot.actionPhase) continue;
        const requiredActions = new Set(slot.actions.filter(action => !['turn', 'reveal'].includes(action)));
        const returnedActions = storyActionTypes(promptText);
        if (requiredActions.size && !returnedActions.some(action => requiredActions.has(action))) continue;
        const checked = validateTurn(`An adult woman performs the decisive story action.\n\n[${promptText}]\n\n<!--IMG_COUNT:1-->`);
        if (!checked.prompts.length || checked.issues.some(issue => issue.severity === 'error')) continue;
        seenSlots.add(slotIndex);
        seenPrompts.add(key);
        shots.push({ slot_index: slotIndex, event_key: eventKey, after_paragraph_index: paragraphIndex, prompt_tags: tags });
    }
    if (shots.length !== slots.length) throw new Error(`当前模型只返回 ${shots.length}/${slots.length} 个有效独立分镜`);
    return shots.sort((a, b) => a.slot_index - b.slot_index);
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
        'female_subject_missing',
        'empty_story_segment',
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
        const checked = validateTurn(`An adult woman performs the decisive story action.\n\n[${promptText}]\n\n<!--IMG_COUNT:1-->`);
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
        const targetPayload = targets.map(item => {
            const context = promptStoryContext(text, item);
            return {
                prompt_index: item.index,
                prompt: item.prompt,
                previous_image_prompt: validation.prompts[item.index - 1]?.prompt || '',
                issues: item.issues.map(issue => issue.code),
                story_segment_since_previous_image: context.segment,
                insertion_paragraph: context.current,
            };
        });
        const targetIndexes = targets.map(item => item.index);
        const dnaHint = collectCharacterDnaHints(`${text}\n${targets.map(item => item.prompt).join('\n')}`);
        const prompt = [
            'You are the silent continuity and scene-accuracy editor for image prompts in a completed SillyTavern story reply.',
            `Return a corrected prompt for every one of the ${targets.length} supplied targets, even when the original looks syntactically valid.`,
            'Story truth is the highest priority. For each target, use the complete story_segment_since_previous_image, not only the nearest sentence and never any later text.',
            'Choose the single most cinematic existing female-led moment inside that segment: plot-changing interaction, decisive action, emotional reversal, reveal, entrance, outfit/prop change, or visually specific daily action. Do not downgrade it to a generic standing portrait.',
            'Every prompt must show at least one woman who truly appears in that segment. Never output a male-only portrait, scenery-only shot, or prop-only shot. A man may appear only with a present woman, with female focus and the woman as the visual lead.',
            'The selected moment is authoritative for the exact visible people, actions, current clothing, props, location, and emotion. Never omit a visible participant and never invent one.',
            'The visual DNA registry is authoritative for immutable identity. Repeat 6-10 useful immutable anchors for every named visible character in every prompt; a name alone is never enough.',
            'For two or more people: use the exact count, write a separate character block for each person, assign fixed left/right or front/back positions, require separate bodies and both faces visible when the story allows. Never turn a visible person into a shadow or silhouette.',
            'Describe named props visually instead of relying on their name. Behemoth must be a small stuffed demon mascot with a fabric doll body, bat wings, and an old gas mask, never a bird or real animal.',
            'Give the current outfit and critical prop placement one explicit weighted phrase, for example (navy and black-purple gothic dress with water-pattern trim:1.25) and (mascot perched on Leviathan shoulder:1.25). Never replace a dress with a bodysuit, leotard, lingerie, or swimsuit.',
            'Current outfit and state in the story segment override older card state. For recurring women, copy the same immutable appearance and unchanged outfit tags from previous_image_prompt; only story-confirmed changes may differ. Preserve the original rendering style.',
            'This is JANIMA_v10 with the Anima/Qwen encoder. Begin every prompt with: masterpiece, best quality, score_7, highres, newest, followed by exactly one story-accurate safety tag: safe, sensitive, nsfw, or explicit. Never force safe onto adult content. Use at most one existing @artist style anchor and never invent or change it between shots.',
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
            next = replacePromptAt(next, validation.prompts[repair.prompt_index], reinforcePromptLocal(repair.prompt_tags.join(', ')));
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

function characterRegistryBefore(messageId) {
    const records = [];
    const start = Math.max(0, Number(messageId) - 16);
    for (let index = start; index < Number(messageId); index++) {
        if (!isAssistantMessage(index)) continue;
        const previousText = getMessageText(index);
        records.push(...extractShotPackets(previousText).filter(item => item.packet && !item.parseError));
        for (const ledger of extractStoryboardLedgers(previousText)) {
            if (ledger.payload && !ledger.parseError) records.push(...ledger.payload.shots);
        }
    }
    return createCharacterRegistry(records);
}

async function runSameReplyLedgerStoryboard(messageId, text) {
    const config = settings().fallback;
    if (!config.enabled || !config.evidenceRepair) return false;
    const ledgers = extractStoryboardLedgers(text);
    if (!ledgers.length) return false;
    const sourceLedger = [...ledgers].reverse().find(item => item.payload && !item.parseError);
    const sourceShots = sourceLedger?.payload?.shots || [];
    let sourceQuoteBoundary = 0;
    const sourceQuoteLocations = sourceShots.map(item => {
        const match = findQuoteEvidence(text, item.quote, {
            from: sourceQuoteBoundary,
            to: sourceLedger?.start ?? text.length,
        });
        if (match.start >= 0) sourceQuoteBoundary = match.end;
        return match.start;
    });
    const registry = characterRegistryBefore(messageId);
    const registryBefore = [...registry.values()].map(member => ({
        id: member.id,
        prompt_name: member.prompt_name,
        dna: member.dna,
        outfit: member.outfit,
    }));
    const result = repairStoryboardFromLedger(text, { registry });
    const message = chat?.[Number(messageId)];
    if (message) {
        message.extra ||= {};
        const previousPlan = message.extra.janimaStoryboardPlan;
        const previousSameLedgerPlan = previousPlan?.mode === 'same-reply-end-ledger' ? previousPlan : null;
        message.extra.janimaStoryboardPlan = {
            version: 5,
            mode: 'same-reply-end-ledger',
            imageCount: result.shots.length,
            firstPassImageCount: previousSameLedgerPlan?.firstPassImageCount ?? result.shots.length,
            passCount: Number(previousSameLedgerPlan?.passCount || 0) + 1,
            sourceShotIds: previousSameLedgerPlan?.sourceShotIds || sourceShots.map(item => item.id),
            sourceQuotes: previousSameLedgerPlan?.sourceQuotes || sourceShots.map(item => item.quote),
            sourceQuoteLocations,
            shotIds: result.shots.map(item => item.packet.id),
            quotes: result.shots.map(item => item.packet.quote),
            paragraphIndexes: result.shots.map(item => item.paragraphIndex),
            actionPhases: result.shots.map(item => item.actionPhase),
            rejectedShots: result.errors.length ? result.errors : (previousSameLedgerPlan?.rejectedShots || []),
            registryBefore,
        };
    }
    setDebug(messageId, {
        repairMode: 'same-reply-end-ledger',
        storyboardLedgerCount: ledgers.length,
        acceptedImageCount: result.shots.length,
        rejectedStoryboardShots: result.errors,
        latencyClass: 'zero-second-llm',
    });
    if (!result.changed) {
        await saveChatConditional?.();
        return false;
    }
    await writeMessage(messageId, result.text, 'janima-same-reply-ledger');
    return true;
}

async function runEvidencePacketStoryboard(messageId, text) {
    const config = settings().fallback;
    if (!config.enabled || !config.evidenceRepair) return false;
    const packets = extractShotPackets(text);
    if (!packets.length) return false;
    const registry = characterRegistryBefore(messageId);
    const registryBefore = [...registry.values()].map(member => ({
        id: member.id,
        prompt_name: member.prompt_name,
        dna: member.dna,
        outfit: member.outfit,
    }));
    const result = repairStoryboardFromEvidence(text, { registry });
    const message = chat?.[Number(messageId)];
    if (message) {
        message.extra ||= {};
        message.extra.janimaStoryboardPlan = {
            version: 4,
            mode: 'same-call-story-evidence',
            imageCount: result.shots.length,
            shotIds: result.shots.map(item => item.packet.id),
            quotes: result.shots.map(item => item.packet.quote),
            actionPhases: result.shots.map(item => item.actionPhase),
            rejectedPackets: result.errors,
            registryBefore,
        };
    }
    setDebug(messageId, {
        repairMode: 'same-call-story-evidence',
        evidencePacketCount: packets.length,
        acceptedImageCount: result.shots.length,
        rejectedEvidence: result.errors,
        latencyClass: 'no-second-llm',
    });
    if (!result.changed) {
        await saveChatConditional?.();
        return false;
    }
    await writeMessage(messageId, result.text, 'janima-story-evidence-repair');
    return true;
}

async function runAutomaticQuietFallback(messageId, text, validation) {
    const config = settings().fallback;
    if (!config.enabled || !config.postReplyStoryboard || !config.useCurrentModel) return false;
    // A character greeting is the first playable Galgame scene on mobile. It
    // must receive the same inline-image rescue as later assistant replies.
    // The female-story gate prevents the fallback from inventing a woman in a
    // male-only or scenery-only greeting.
    const femaleContext = postReplyFemaleContext(text);
    if (!femaleContext.allowed) {
        setDebug(messageId, { repairMode: 'post-reply-storyboard-gate', femaleContext: femaleContext.source, desiredImageCount: 0 });
        if (validation.prompts.length || Number(validation.declaredImageCount || 0) > 0) {
            const cleared = replaceStoryboardPrompts(text, []);
            if (cleared !== text) {
                await writeMessage(messageId, cleared, 'janima-post-reply-female-gate-clear');
                return true;
            }
        }
        return false;
    }
    const candidates = storyParagraphCandidates(text);
    if (!candidates.length) return false;
    const preferred = Math.max(1, Math.min(6, Number(config.minimumImages || 3)));
    const maximum = config.adaptive
        ? Math.max(preferred, Math.min(6, Number(config.maximumImages || 6)))
        : preferred;
    const plan = planStoryboardSlots(text, { preferred, maximum, assumeFemale: femaleContext.assumeFemale });
    const coverage = analyzeStoryboardCoverage(text, validation.prompts, { plan });
    if (!coverage.needsReflow) return false;
    const desired = plan.targetCount;

    const hash = `${messageId}:${stableHash(text)}:${plan.slots.map(slot => `${slot.slotIndex}:${slot.paragraphIndexes.join('.')}`).join('|')}:storyboard-reflow`;
    if (runtime.fallbackHashes.has(hash) || runtime.fallbackInFlight.has(Number(messageId))) return false;
    runtime.fallbackInFlight.add(Number(messageId));

    try {
        if (desired === 0) {
            const next = replaceStoryboardPrompts(text, []);
            await writeMessage(messageId, next, 'janima-local-storyboard-clear');
            runtime.fallbackHashes.add(hash);
            setDebug(messageId, { repairMode: 'local-storyboard-clear', desiredImageCount: 0, storyboardIssues: coverage.issues });
            return true;
        }

        const slotPayload = plan.slots.map(slot => ({
            slot_index: slot.slotIndex,
            event_key: slot.eventKey,
            phase: slot.phase,
            action_phase: slot.actionPhase,
            allowed_after_paragraph_indexes: slot.paragraphIndexes,
            complete_story_window_since_previous_shot: slot.windowText.slice(0, 2400),
            winning_evidence_paragraph_index: slot.selectedBeatParagraphIndex,
            winning_evidence: slot.selectedBeatText.slice(0, 1200),
            action_ledger: slot.eventLedger,
            local_action_types: slot.actions,
        }));
        const dnaHint = collectCharacterDnaHints(text);
        const prompt = [
            'You are the silent full-turn Galgame storyboard editor for a completed SillyTavern story reply.',
            `The local chronology planner found exactly ${desired} distinct visual beats. Rebuild the entire inline storyboard with exactly one shot for every supplied slot. Do not preserve bad old placement and do not add shots merely to meet a quota.`,
            'Each slot is a different event beat, not merely a different paragraph. Several paragraphs that continue the same embrace, touch, pose, sex position, conversation reaction, or unchanged action must remain one shot. Never create two shots of the same continuous action.',
            'Story truth is the highest priority. Each shot owns complete_story_window_since_previous_shot. Read the whole window and its chronological action_ledger, depict winning_evidence as the exact decisive frame, and never use later text.',
            'Judge events as subject + physical action + receiver/object + visible result. Background explanation, dialogue reporting, repeated motion, and setup are support; a state-changing action or result is the principal event. Do not summarize the whole window into a vague pose.',
            'For every slot select the strongest existing female-led frame: consequential interaction, decisive action, emotional reversal, reveal, entrance, outfit/prop/location change, then visually specific daily action. Reject generic standing portraits and repeated camera-only variations.',
            'Every prompt must show at least one woman who actually appears in its story window. Never create a male-only portrait, scenery-only shot, or prop-only shot. A man may appear only beside a present woman, with female focus and the woman as visual lead.',
            'Return every slot_index and its event_key exactly once. Never change or invent event_key. after_paragraph_index must come from that slot\'s allowed_after_paragraph_indexes. Preserve chronological slot order. This prevents all buttons clustering in the first half.',
            'Every prompt must be 12-48 concise English comma-separated image tags: quality, exact people count, full visual DNA for every visible named character, current clothing, action, prop, location, expression, spatial relation, shot, composition, lighting.',
            'Repeat immutable face, hair, eye, body-build, and signature clothing anchors in every prompt; a character name alone is never an identity description.',
            'For a recurring woman, copy the same immutable appearance and unchanged outfit tags from the immediately previous shot and RECENT INLINE VISUAL ANCHORS; change only story-confirmed action, expression, camera, location, or outfit.',
            'For multi-character scenes use exact count, separate character blocks, fixed left/right or front/back positions, separate bodies, and both faces visible when the story permits.',
            'Describe named props visually. Behemoth is a small stuffed demon mascot with a fabric doll body, bat wings, and an old gas mask, never a bird or real animal.',
            'Give story-current clothing or nudity state and critical prop placement one weighted phrase at 1.20-1.30. Preserve an unchanged dress or ceremonial garment, but if this story window explicitly changes or removes clothing, depict the new state instead of restoring the old outfit.',
            'This is JANIMA_v10 with the Anima/Qwen encoder. Begin every prompt with: masterpiece, best quality, score_7, highres, newest, followed by exactly one story-accurate safety tag: safe, sensitive, nsfw, or explicit. Never force safe onto adult content. Use at most one existing @artist style anchor and never invent or change it between shots.',
            'Consensual adult intimacy, nudity, and explicit sex are ordinary Galgame visual beats. Never omit, fade out, or downgrade an image solely because it is NSFW; use nsfw or explicit and select the strongest story-accurate female-led moment. Keep every sexual character explicitly adult.',
            'For adult windows, preserve the exact action phase from action_phase: undressing, erotic touch, manual stimulation, oral sex, initial penetration, continued penetration, position change, climax, or aftercare are not interchangeable. Position change and climax are mandatory new events. Continued unchanged motion is not.',
            'Adult prompts must devote most action wording to one concrete visible interaction: stable named participant IDs, initiator, receiver, body-to-body contact, current position, and visible result. Do not replace the key act with a generic embrace, kneeling pose, blush, or bedroom portrait.',
            'Never invent a person, touch, outfit, prop, action, or location. No Chinese, prose, markdown, square brackets, explanation, or story rewrite.',
            'Every shot needs one distinct physical action signature. Changing only close-up/wide-shot, lighting, or facial wording does not make a repeated action a new shot.',
            'Return only JSON: {"shots":[{"slot_index":0,"event_key":"0:kiss:3","after_paragraph_index":0,"prompt_tags":["masterpiece","best quality"]}]}',
            `Character DNA registry:\n${dnaHint}`,
            `Existing prompts (identity reference only; placement may be wrong): ${JSON.stringify(validation.prompts.map(item => item.prompt))}`,
            `Mandatory storyboard slots: ${JSON.stringify(slotPayload)}`,
            `Complete story reply: ${JSON.stringify(text.slice(0, 16000))}`,
        ].join('\n');
        const allAllowedIndexes = [...new Set(plan.slots.flatMap(slot => slot.paragraphIndexes))];
        const schema = {
            type: 'object',
            additionalProperties: false,
            properties: {
                shots: {
                    type: 'array',
                    minItems: desired,
                    maxItems: desired,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            slot_index: { type: 'integer', enum: plan.slots.map(slot => slot.slotIndex) },
                            event_key: { type: 'string', enum: plan.slots.map(slot => slot.eventKey) },
                            after_paragraph_index: { type: 'integer', enum: allAllowedIndexes },
                            prompt_tags: { type: 'array', minItems: 12, maxItems: 48, items: { type: 'string' } },
                        },
                        required: ['slot_index', 'event_key', 'after_paragraph_index', 'prompt_tags'],
                    },
                },
            },
            required: ['shots'],
        };
        const raw = await generateQuietFallbackPayload(prompt, schema, Math.max(1200, Number(config.responseLength || 2400)));
        const shots = validateQuietStoryboardResponse(raw, plan.slots);
        const next = replaceStoryboardPrompts(text, shots.map(shot => ({
            after_paragraph_index: shot.after_paragraph_index,
            prompt: reinforcePromptLocal(shot.prompt_tags.join(', ')),
        })));
        const finalValidation = validateTurn(next);
        const blockingIssues = finalValidation.issues.filter(issue => issue.severity === 'error');
        if (blockingIssues.length) throw new Error(`补图未通过剧情/女性门禁：${blockingIssues.map(issue => issue.code).join(', ')}`);
        const finalCoverage = analyzeStoryboardCoverage(next, finalValidation.prompts, { preferred, maximum });
        if (finalCoverage.needsReflow) throw new Error(`分镜覆盖仍未通过：${finalCoverage.issues.map(issue => issue.code).join(', ')}`);
        const message = chat?.[Number(messageId)];
        if (message) {
            message.extra ||= {};
            message.extra.janimaStoryboardPlan = {
                version: 2,
                imageCount: desired,
                paragraphIndexes: shots.map(shot => shot.after_paragraph_index),
                actionTypes: plan.slots.map(slot => slot.actions),
                actionPhases: plan.slots.map(slot => slot.actionPhase),
                evidenceParagraphIndexes: plan.slots.map(slot => slot.selectedBeatParagraphIndex),
            };
        }
        await writeMessage(messageId, next, 'janima-current-model-fallback');
        runtime.fallbackHashes.add(hash);
        runtime.fallbackFailures.delete(hash);
        setDebug(messageId, {
            repairMode: 'post-reply-batch-storyboard',
            desiredImageCount: desired,
            insertedImageCount: shots.length,
            insertParagraphIndex: shots.map(item => item.after_paragraph_index),
            storyboardIssues: coverage.issues,
            femaleContext: femaleContext.source,
        });
        return true;
    } catch (error) {
        const failures = Number(runtime.fallbackFailures.get(hash) || 0) + 1;
        runtime.fallbackFailures.set(hash, failures);
        setDebug(messageId, { repairMode: 'post-reply-batch-storyboard', error: error.message, desiredImageCount: desired, femaleContext: femaleContext.source });
        console.warn(`[${EXT_NAME}] 当前模型自动补图失败，原文保持不变`, error);
        // Mobile providers occasionally reject structured output while the
        // just-finished story request is still settling. Retry twice without
        // requiring a reload; do not loop indefinitely or slow every turn.
        if (failures < 3) setTimeout(() => scheduleCheck(messageId, 0), 900 * failures);
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
            'Audit one SillyTavern story reply and its existing image prompts. Story truth is first. Treat the text after the previous image through the current insertion paragraph as one segment and select its most cinematic existing female-led moment. Every image must show a woman actually present in its segment; remove male-only, scenery-only, prop-only, duplicate, invented, or future-spoiling shots. Keep female focus when a man also appears. Preserve recurring female DNA and unchanged clothing from the previous prompt. Keep at least 3 valid images per normal female-present story turn and allow 4-6 for distinct fast beats. Never rewrite story text. Return strict JSON with remove_prompt_indexes, replace_prompts[{prompt_index,prompt_tags}], missing_prompts[{after_paragraph_index,prompt_tags}], reasons.',
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
    if (host) removeLegacyConversationUi(host);
    const text = getMessageText(messageId);
    const validation = validateTurn(text);
    const evidencePackets = extractShotPackets(text);
    const storyboardLedgers = extractStoryboardLedgers(text);
    // A hidden end ledger can become syntactically complete in the final
    // streaming chunk before SillyTavern commits the beginning of the reply to
    // chat[]. Parsing it at that instant can permanently reject a valid opening
    // quote. Prefer the completion events, but some custom streaming backends do
    // not emit them reliably. In that case require a stable full message for a
    // short quiet window before evidence repair. Existing inline prompts may
    // still be handed to Chatu8 while streaming.
    if (runtime.generationActive) {
        if (storyboardLedgers.length || evidencePackets.length) {
            const settleId = Number(messageId);
            const settleHash = stableHash(text);
            const now = Date.now();
            const previousSettle = runtime.streamingEvidenceSettles.get(settleId);
            if (!previousSettle || previousSettle.hash !== settleHash) {
                runtime.streamingEvidenceSettles.set(settleId, { hash: settleHash, seenAt: now });
                scheduleCheck(settleId, 650);
                return;
            }
            const remaining = 550 - (now - previousSettle.seenAt);
            if (remaining > 0) {
                scheduleCheck(settleId, remaining + 40);
                return;
            }
            runtime.streamingEvidenceSettles.delete(settleId);
        } else {
            if (host && validation.prompts.length) {
                markZhihuijiButtonsInline(messageId);
                nudgeZhihuijiObserver(messageId, validation);
            }
            return;
        }
    }
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
    if (await runSameReplyLedgerStoryboard(messageId, text)) return;
    if (await runEvidencePacketStoryboard(messageId, text)) return;
    if (await runAutomaticQuietPromptRepair(messageId, text, validation)) return;
    if (await runAutomaticQuietFallback(messageId, text, validation)) return;
    if (host) {
        markZhihuijiButtonsInline(messageId);
        nudgeZhihuijiObserver(messageId, validation);
        setTimeout(() => markZhihuijiButtonsInline(messageId), 350);
    }
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
    let initialSaveError = null;
    try {
        try {
            await saveChatConditional?.();
        } catch (error) {
            // A brand-new mobile chat may render message 0 before SillyTavern
            // creates its JSONL file. The in-memory greeting is still valid;
            // render it now so Chatu8 can create buttons, then retry persistence.
            initialSaveError = error;
            console.debug(`[${EXT_NAME}] 首次聊天文件尚未建立，先渲染开场白再补存`, error);
        }
        updateMessageBlock(id, message);
        await eventSource.emit(event_types.MESSAGE_UPDATED, id, source || EXT_ID);
    } finally {
        runtime.writing.delete(id);
    }
    if (initialSaveError) {
        setTimeout(() => saveChatConditional?.().catch(error => {
            console.debug(`[${EXT_NAME}] 等待首次用户消息时保留内存中的开场白补图`, error);
        }), 1200);
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
    const segment = storySegmentsForPrompts(text).find(item => item.promptIndex === prompt.index);
    let sceneIndex = prompt.paragraphIndex - 1;
    while (sceneIndex >= 0 && isPromptParagraph(paragraphs[sceneIndex])) sceneIndex--;
    return {
        before: paragraphs[sceneIndex - 1]?.text || '',
        current: paragraphs[sceneIndex]?.text || '',
        after: paragraphs[sceneIndex + 1]?.text && !isPromptParagraph(paragraphs[sceneIndex + 1]) ? paragraphs[sceneIndex + 1].text : '',
        paragraphIndex: sceneIndex,
        segment: segment?.text || paragraphs[sceneIndex]?.text || '',
        segmentParagraphIndexes: segment?.paragraphs.map(item => item.index) || [],
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
            'Repair one JANIMA_v10/Anima Galgame prompt. Story truth is first: use the entire story segment since the previous image, choose its strongest existing female-led moment, and never use future text. The prompt must show a woman actually present in the segment; never return a male-only or scenery-only image. Keep female focus, exact people, current action/outfit/props/location, and recurring identity anchors. Begin prompt_tags with masterpiece, best quality, score_7, highres, newest, then exactly one story-accurate tag from safe, sensitive, nsfw, explicit. Never force safe onto adult content. Use at most one existing @artist style anchor and never invent or change it. Return strict JSON with prompt_tags, negative_tags, changes, confidence. Never return prose or markdown.',
            {
                original_worldbook_prompt: prompt.prompt,
                story_segment_since_previous_image: context.segment,
                previous_image_prompt: validation.prompts[prompt.index - 1]?.prompt || '',
                previous_paragraph: context.before,
                scene_paragraph: context.current,
                next_paragraph: context.after,
                relevant_character_dna: settings().api.characterDna || '',
            },
        ));
        runtime.cache.set(key, repaired);
    }
    const replacement = reinforcePromptLocal(repaired.prompt_tags.join(', '));
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
            'Fill only missing JANIMA_v10/Anima Galgame image prompts in one assistant turn. Each image uses the complete story window since the previous image and selects its strongest existing female-led moment. Every prompt must show a woman actually present in that window, never a male-only or scenery-only shot; keep female focus and recurring identity/outfit tags. Begin every prompt_tags array with masterpiece, best quality, score_7, highres, newest, then exactly one story-accurate tag from safe, sensitive, nsfw, explicit. Never force safe onto adult content. Use at most one existing @artist style anchor and never invent or change it. Never rewrite story text or existing prompts. Return strict JSON {"missing_prompts":[{"after_paragraph_index":0,"anchor_text":"","prompt_tags":[]}]} using short English image tags. The array length must equal missing_count.',
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
    const prompts = validateTurn(getMessageText(messageId)).prompts;
    return [...host.querySelectorAll(VERIFIED_ZHIHUIJI_SELECTOR)].filter(node => {
        const rawPrompt = node.dataset.imageTag || node.dataset.link || node.dataset.change || '';
        return node instanceof HTMLElement
            && isLikelyImagePrompt(rawPrompt)
            && prompts.some(item => nativePromptContainsCanonical(rawPrompt, item.prompt));
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
            'Create one concise JANIMA_v10/Anima Galgame prompt for the selected story segment. Select the strongest existing female-led visual moment. Show at least one woman actually present, keep female focus and recurring identity/outfit anchors, and never create a male-only or scenery-only shot. Begin prompt_tags with masterpiece, best quality, score_7, highres, newest, then exactly one story-accurate tag from safe, sensitive, nsfw, explicit. Never force safe onto adult content. Use at most one existing @artist style anchor and never invent or change it. Return strict JSON with prompt_tags, negative_tags, changes, confidence. Use English comma-separated image tags, no prose, no invented people or actions.',
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
    const wrapped = reinforcePromptLocal(result.prompt_tags.join(', '));
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
                    <p class="notes">手机 Galgame 即时模式：主回复末尾同步写入不可见的全文分镜账本；插件只做本地校验和原位按钮布局，默认不再发起第二次模型请求。</p>
                    <h4>基础设置</h4>
                    ${checkRow('enabled', '启用救援插件')}
                    ${checkRow('autoCheck', '自动检查最新回复')}
                    ${checkRow('silentMode', '静默模式（不向对话插入插件界面）')}
                    ${checkRow('autoLocalRepair', '仅删除重复 Prompt（安全）')}
                    <h4>缺图自动兜底</h4>
                    ${checkRow('fallback.enabled', '启用剧情理解与原位修复')}
                    ${checkRow('fallback.postReplyStoryboard', '缺账本时调用模型慢速补图（默认关闭）')}
                    ${checkRow('fallback.evidenceRepair', '校验隐藏分镜账本与人物连续性')}
                    ${checkRow('fallback.sameCallEvidence', '主回复末尾同步生成隐藏分镜账本（手机推荐）')}
                    ${checkRow('fallback.repairInvalidPrompts', '二次模型改写已有 Prompt（默认关闭）')}
                    ${checkRow('fallback.semanticAudit', '逐图 AI 深度重审（较慢，默认关闭）')}
                    ${checkRow('fallback.adaptive', '快节奏/多转场时自动增加图片')}
                    ${fieldRow('fallback.minimumImages', '常规目标图片（同一持续动作不凑数）', '3', 'number')}
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
                    <p class="notes">默认由主回复在末尾附带隐藏分镜账本，插件本地生成 1–6 个原位按钮，不追加第二次模型请求；没有可确认女性时为 0 图，不会凭空补人物。</p>
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
        if (['enabled', 'silentMode', 'autoLocalRepair', 'fallback.enabled', 'fallback.postReplyStoryboard', 'fallback.evidenceRepair', 'fallback.sameCallEvidence', 'fallback.useCurrentModel', 'fallback.repairInvalidPrompts', 'fallback.semanticAudit', 'fallback.adaptive', 'fallback.minimumImages', 'fallback.maximumImages', 'chatu8.inlineButtons', 'chatu8.accuracyWorkflow'].includes(input.name)) {
            removeLegacyConversationUi();
            if (input.name === 'chatu8.accuracyWorkflow') configureChatu8AccuracyWorkflow();
            if (settings().enabled) scanLatestAssistant();
        }
    });
}

function scanLatestAssistant() {
    let checked = 0;
    for (let index = (chat?.length || 0) - 1; index >= 0 && checked < 16; index--) {
        if (!isAssistantMessage(index)) continue;
        checked++;
        const validation = validateTurn(getMessageText(index));
        const packets = extractShotPackets(getMessageText(index));
        const ledgers = extractStoryboardLedgers(getMessageText(index));
        const isLatestAssistant = checked === 1;
        // The latest completed story must be checked even when it contains
        // zero prompts and zero evidence packets. That exact early-skip caused
        // the phone regression where the post-reply fallback never ran.
        if (isLatestAssistant && settings().fallback.postReplyStoryboard) {
            scheduleCheck(index, 90);
            continue;
        }
        const needsSemanticRepair = packets.length > 0 || ledgers.length > 0;
        const needsButtonRestore = validation.prompts.length > 0
            && verifiedZhihuijiButtons(index).length < validation.prompts.length;
        if (needsSemanticRepair || needsButtonRestore) {
            scheduleCheck(index, 60 + checked * 35);
        }
    }
}

function scheduleCompletedReplyScans() {
    [60, 450, 1400].forEach(delay => setTimeout(scanLatestAssistant, delay));
}

function scheduleStreamingInlineScan() {
    clearTimeout(runtime.streamCompletionTimer);
    runtime.streamCompletionTimer = setTimeout(() => {
        // Custom OpenAI-compatible streaming backends may omit both
        // GENERATION_ENDED and MESSAGE_RECEIVED. A quiet token window is the
        // final completion fallback and prevents the phone path from stalling.
        runtime.storyContractArmed = false;
        runtime.generationActive = false;
        scanLatestAssistant();
    }, 650);
    if (runtime.streamScanQueued) return;
    runtime.streamScanQueued = true;
    setTimeout(() => {
        runtime.streamScanQueued = false;
        for (let index = (chat?.length || 0) - 1; index >= 0; index--) {
            if (!isAssistantMessage(index)) continue;
            const validation = validateTurn(getMessageText(index));
            if (validation.prompts.length) {
                markZhihuijiButtonsInline(index);
                nudgeZhihuijiObserver(index, validation);
            }
            return;
        }
    }, 120);
}

function armStoryEvidenceContract(type, generationOptions = {}, dryRun = false) {
    const foreground = Boolean(
        settings().enabled
        && settings().fallback.enabled
        && !dryRun
        && !generationOptions?.quiet_prompt
        && type !== 'quiet'
        && type !== 'impersonate'
    );
    if (foreground) runtime.generationActive = true;
    if (foreground) runtime.streamingEvidenceSettles.clear();
    runtime.storyContractArmed = Boolean(
        foreground
        && settings().fallback.evidenceRepair
        && settings().fallback.sameCallEvidence
    );
}

function injectChatCompletionEvidenceContract(eventData = {}) {
    if (!runtime.storyContractArmed || eventData.dryRun || !Array.isArray(eventData.chat)) return;
    const alreadyPresent = eventData.chat.some(message => typeof message?.content === 'string' && message.content.includes('[JANIMA_STORYBOARD_V2]'));
    if (alreadyPresent) return;
    eventData.chat.unshift({ role: 'system', content: STORYBOARD_LEDGER_CONTRACT });
}

function ensureLatestAssistantStoryboard() {
    for (let index = (chat?.length || 0) - 1; index >= 0; index--) {
        if (!isAssistantMessage(index)) continue;
        const text = getMessageText(index);
        const validation = validateTurn(text);
        const hasEvidence = extractShotPackets(text).length > 0 || extractStoryboardLedgers(text).length > 0;
        const missingSemanticRepair = hasEvidence && validation.prompts.length === 0;
        const missingButtons = validation.prompts.length > 0
            && verifiedZhihuijiButtons(index).length < validation.prompts.length;
        if (missingSemanticRepair || missingButtons) scheduleCheck(index, 40);
        return;
    }
}

function injectTextCompletionEvidenceContract(eventData = {}) {
    if (!runtime.storyContractArmed || eventData.dryRun || typeof eventData.prompt !== 'string') return;
    if (eventData.prompt.includes('[JANIMA_STORYBOARD_V2]')) return;
    eventData.prompt = `${eventData.prompt.trimEnd()}\n\n${STORYBOARD_LEDGER_CONTRACT}\n`;
}

function bindEvents() {
    const onMessage = messageId => {
        if (settings().autoCheck) {
            scheduleCheck(messageId, 120);
            scheduleCheck(messageId, 650);
        }
    };
    [event_types.MESSAGE_UPDATED, event_types.MESSAGE_SWIPED]
        .filter(Boolean)
        .forEach(type => eventSource.on(type, onMessage));
    if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, messageId => {
        // MESSAGE_RECEIVED is SillyTavern's committed assistant message. Some
        // streaming backends do not emit GENERATION_ENDED reliably, so use the
        // committed message as the authoritative completion signal as well.
        runtime.storyContractArmed = false;
        runtime.generationActive = false;
        onMessage(messageId);
        scheduleCompletedReplyScans();
    });
    if (event_types.GENERATION_AFTER_COMMANDS) eventSource.on(event_types.GENERATION_AFTER_COMMANDS, armStoryEvidenceContract);
    if (event_types.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, injectChatCompletionEvidenceContract);
    if (event_types.GENERATE_AFTER_COMBINE_PROMPTS) eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, injectTextCompletionEvidenceContract);
    if (event_types.STREAM_TOKEN_RECEIVED) eventSource.on(event_types.STREAM_TOKEN_RECEIVED, scheduleStreamingInlineScan);
    if (event_types.GENERATION_ENDED) eventSource.on(event_types.GENERATION_ENDED, () => {
        clearTimeout(runtime.streamCompletionTimer);
        runtime.storyContractArmed = false;
        runtime.generationActive = false;
        scheduleCompletedReplyScans();
    });
    if (event_types.GENERATION_STOPPED) eventSource.on(event_types.GENERATION_STOPPED, () => {
        clearTimeout(runtime.streamCompletionTimer);
        runtime.storyContractArmed = false;
        runtime.generationActive = false;
        scheduleCompletedReplyScans();
    });
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(scanLatestAssistant, 200));
    const visibilityObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const rawId = entry.target?.getAttribute?.('mesid') || entry.target?.dataset?.mesId;
            const messageId = Number(rawId);
            if (!Number.isInteger(messageId) || messageId < 0 || !isAssistantMessage(messageId)) continue;
            const validation = validateTurn(getMessageText(messageId));
            if (validation.prompts.length && verifiedZhihuijiButtons(messageId).length < validation.prompts.length) {
                scheduleCheck(messageId, 30);
            }
        }
    }, { root: document.querySelector('#chat') || null, threshold: 0.01 });
    const observeMessage = host => {
        if (host?.matches?.('#chat .mes') && host.dataset.janimaVisibilityObserved !== 'true') {
            host.dataset.janimaVisibilityObserved = 'true';
            visibilityObserver.observe(host);
        }
    };
    document.querySelectorAll('#chat .mes').forEach(observeMessage);
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            const host = mutation.target?.closest?.('.mes');
            observeMessage(host);
            mutation.addedNodes?.forEach?.(node => {
                if (!(node instanceof Element)) return;
                observeMessage(node);
                node.querySelectorAll?.('#chat .mes, .mes')?.forEach?.(observeMessage);
            });
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
    setTimeout(configureChatu8AccuracyWorkflow, 800);
    setTimeout(configureChatu8AccuracyWorkflow, 2400);
    removeLegacyConversationUi();
    const container = document.querySelector('#extensions_settings') || document.querySelector('#extensions_settings2');
    if (container && !document.querySelector(SETTINGS_SELECTOR)) container.insertAdjacentHTML('beforeend', settingsHtml());
    syncSettingsUi();
    bindSettings();
    bindEvents();
    scanLatestAssistant();
    // Mobile custom backends and some launcher builds occasionally omit the
    // expected completion events. This small latest-message heartbeat makes a
    // finished hidden ledger self-healing without ever calling another model.
    setInterval(ensureLatestAssistantStoryboard, 1200);
    globalThis.JANIMA_SCENE_IMAGE_DIRECTOR = Object.freeze({
        version: EXT_VERSION,
        rescan: ensureLatestAssistantStoryboard,
    });
    document.documentElement.dataset.janimaSceneImageDirector = EXT_VERSION;
    console.info(`[${EXT_NAME}] v${EXT_VERSION} loaded in silent mode; verified Zhihuiji route: ${VERIFIED_ZHIHUIJI_SELECTOR}`);
});
