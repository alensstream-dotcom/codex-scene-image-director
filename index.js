import {
    chat,
    characters,
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    getCurrentChatId,
    saveChatConditional,
    saveSettingsDebounced,
    setExtensionPrompt,
    this_chid,
    updateMessageBlock,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import {
    buildDirectorContract,
    buildFallbackPackets,
    compilePrompt,
    createBible,
    extractNarrativeStory,
    hasFemale,
    isDuplicateBeat,
    mergePacketIntoBible,
    parseCgPackets,
    seedForPacket,
    serializeBible,
    stableHash,
    stripLegacyImagePromptLines,
    stripProtocol,
} from './lib/director-core.mjs';
import { buildAnimaWorkflow, DEFAULT_ANIMA_PROFILE } from './lib/anima-direct-workflow.mjs';
import {
    buildComfyViewUrl,
    normalizeComfyUrl,
    pingComfyNative,
    submitComfyPrompt,
    waitForComfyResult,
} from './lib/comfy-direct.mjs';
import {
    clampParagraphIndex,
    normalizeAnchorText,
    paragraphIndexForQuote,
    semanticBlocks,
    splitStoryParagraphs,
} from './lib/scene-anchor.mjs';

const EXT_ID = 'codex_scene_image_director';
const EXT_NAME = 'JANIMA Galgame 自动CG';
const EXT_VERSION = '2.3.0';
const SETTINGS_SELECTOR = '#janima_autocg_settings';
const PROMPT_KEY = 'JANIMA_AUTO_CG_V3_DIRECTOR';
const STORAGE_KEY = 'janimaAutoCg';
const STORAGE_VERSION = 3;

const DEFAULT_SETTINGS = Object.freeze({
    schema: 40,
    enabled: true,
    automatic: true,
    localFallback: true,
    cleanLegacyPrompts: true,
    maximumShots: 3,
    fallbackShots: 2,
    comfyUrl: 'http://192.168.1.12:8188',
    generationTimeoutMs: 180000,
    pollIntervalMs: 1000,
    resumeInterrupted: true,
    profile: { ...DEFAULT_ANIMA_PROFILE },
});

const runtime = {
    generationSerial: 0,
    pendingForeground: null,
    queue: [],
    running: null,
    jobs: new Map(),
    renderTimer: null,
    connection: { state: 'unknown', message: '尚未检测' },
    observer: null,
    eventsBound: false,
    initialized: false,
    processing: new Set(),
};

function mergeKnown(base, incoming) {
    const result = structuredClone(base);
    for (const [key, value] of Object.entries(incoming || {})) {
        if (!(key in result)) continue;
        if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object') {
            result[key] = mergeKnown(result[key], value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

function settings() {
    const existing = extension_settings[EXT_ID] || {};
    const migrated = { ...existing };
    if (!migrated.generationTimeoutMs && migrated.requestTimeoutMs) {
        migrated.generationTimeoutMs = Math.max(60000, Number(migrated.requestTimeoutMs) || 180000);
    }
    const next = mergeKnown(DEFAULT_SETTINGS, migrated);
    next.schema = DEFAULT_SETTINGS.schema;
    if (!existing || Number(existing.schema) !== DEFAULT_SETTINGS.schema) {
        extension_settings[EXT_ID] = next;
        saveSettingsDebounced?.();
    } else {
        extension_settings[EXT_ID] = next;
    }
    return extension_settings[EXT_ID];
}

function toast(level, message) {
    if (globalThis.toastr?.[level]) globalThis.toastr[level](message, EXT_NAME);
    else console[level === 'error' ? 'error' : 'log'](`[${EXT_NAME}] ${message}`);
}

function currentCharacterContext() {
    const character = characters?.[Number(this_chid)];
    if (!character) return { name: '', visual: '' };
    const name = String(character.name || character.data?.name || '').trim();
    const visual = [character.description, character.data?.description]
        .filter(Boolean)
        .join('\n')
        .replace(/\s+/g, ' ')
        .slice(0, 1800);
    return { name, visual };
}

function latestUserText() {
    for (let index = (chat?.length || 0) - 1; index >= 0; index--) {
        if (chat[index]?.is_user) return String(chat[index].mes || '');
    }
    return '';
}

function storyCharacterContext(story = '') {
    const card = currentCharacterContext();
    const userText = latestUserText().replace(/<[^>]+>/g, ' ');
    const nameMatch = userText.match(/(?:成年)?女主(?:角)?\s*[：:，,]?\s*([A-Za-z][A-Za-z0-9 _-]{1,30}|[\u3400-\u9fff]{2,4})(?=[，,：:\s]|的)/i)
        || String(story).match(/([A-Za-z][A-Za-z0-9 _-]{1,30}|[\u3400-\u9fff]{1,4})(?=的[^。\n]{0,20}(?:长发|短发|头发|刘海|马尾|眼睛|眼眸|瞳))/i)
        || String(story).match(/(?:^|\n)([\u3400-\u9fff]{1,4})(?=(?:背着|穿着|戴着|走|跑|说|回头|抬|吃|坐|站|停))/m);
    const detectedName = String(nameMatch?.[1] || '').trim();
    const appearanceSource = `${userText}\n${story}\n${card.visual}`;
    const appearance = appearanceSource
        .split(/(?<=[。！？；\n])/) 
        .map(value => value.trim())
        .filter(value => /(?:长发|短发|头发|刘海|马尾|眼睛|眼眸|瞳|身材|体型|肤色|脸型|制服|校服|连衣裙|裙装|衬衫|开衫|外套|领结|发带|书包|背包|鞋|穿着|衣着)/i.test(value))
        .filter(value => !/(?:请写|输出|生成|生图|Prompt|测试|要求)/i.test(value))
        .slice(0, 8)
        .join(' ')
        .slice(0, 1200);
    const sameAsCard = !detectedName || !card.name || detectedName.toLowerCase() === card.name.toLowerCase();
    const evidence = `${userText} ${story} ${card.visual}`;
    const femalePresent = hasFemale(evidence);
    const adult = /(?:\b(?:1[89]|[2-9]\d)\s*(?:years? old|yo)\b|成人|成年|\d{2}岁)/i.test(evidence);
    return {
        name: femalePresent ? (detectedName || card.name) : '',
        visual: femalePresent
            ? [adult ? 'adult woman' : 'female character', appearance, sameAsCard && !appearance ? card.visual : '']
                .filter(Boolean)
                .join('; ')
                .slice(0, 1800)
            : '',
    };
}

function isAssistantMessage(messageId) {
    const message = chat?.[Number(messageId)];
    return Boolean(message && !message.is_user && !message.is_system);
}

function latestAssistantId() {
    for (let index = (chat?.length || 0) - 1; index >= 0; index--) {
        if (isAssistantMessage(index)) return index;
    }
    return -1;
}

function messageHost(messageId) {
    const id = Number(messageId);
    return document.querySelector(`#chat .mes[mesid="${id}"]`)
        || document.querySelector(`#chat .mes[data-mes-id="${id}"]`)
        || null;
}

function storageFor(message, create = false) {
    if (!message) return null;
    if (!message.extra && create) message.extra = {};
    if (!message.extra) return null;
    if (!message.extra[STORAGE_KEY] && create) {
        message.extra[STORAGE_KEY] = { version: STORAGE_VERSION, processedHash: '', shots: [] };
    }
    const storage = message.extra[STORAGE_KEY] || null;
    if (storage && create) {
        storage.version = STORAGE_VERSION;
        storage.processedHash ||= '';
        storage.shots = Array.isArray(storage.shots) ? storage.shots : [];
    }
    return storage;
}

function serializableRecord(record) {
    return {
        id: record.id,
        generationId: record.generationId,
        chatId: record.chatId,
        paragraphIndex: Number(record.paragraphIndex ?? -1),
        packet: record.packet,
        prompt: record.prompt,
        negative: record.negative,
        seed: record.seed,
        retry: record.retry || 0,
        status: record.status,
        promptId: record.promptId || '',
        url: record.url || '',
        image: record.image || null,
        error: record.error || '',
        createdAt: record.createdAt,
        completedAt: record.completedAt || 0,
    };
}

function recordKey(record) {
    return `${record.generationId || 'persisted'}:${record.id}`;
}

function upsertRecordInMessage(record) {
    if (record.chatId && String(record.chatId) !== String(getCurrentChatId?.() || '')) return false;
    const messageId = Number(record.messageId);
    if (!Number.isInteger(messageId) || messageId < 0) return false;
    const message = chat?.[messageId];
    if (!message) return false;
    const storage = storageFor(message, true);
    const index = storage.shots.findIndex(item => item.id === record.id && item.generationId === record.generationId);
    const value = serializableRecord(record);
    if (index >= 0) storage.shots[index] = value;
    else storage.shots.push(value);
    return true;
}

async function persistRecord(record) {
    if (!upsertRecordInMessage(record)) return;
    try { await saveChatConditional?.(); }
    catch (error) { console.warn(`[${EXT_NAME}] 保存 CG 状态失败`, error); }
}

function recentPersistedRecords(limit = 40) {
    const records = [];
    for (let index = (chat?.length || 0) - 1; index >= 0 && records.length < limit; index--) {
        const shots = storageFor(chat[index])?.shots;
        if (!Array.isArray(shots)) continue;
        for (let shotIndex = shots.length - 1; shotIndex >= 0 && records.length < limit; shotIndex--) {
            if (shots[shotIndex]?.packet) records.push(shots[shotIndex]);
        }
    }
    return records.reverse();
}

function buildCurrentBible() {
    const bible = createBible();
    for (const record of recentPersistedRecords(40)) mergePacketIntoBible(bible, record.packet);
    return bible;
}

function refreshDirectorPrompt() {
    const config = settings();
    if (!config.enabled || !config.automatic) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
        document.documentElement.dataset.janimaAutocgEnabled = 'false';
        return;
    }
    const character = currentCharacterContext();
    const contract = buildDirectorContract({
        bibleText: serializeBible(buildCurrentBible()),
        characterContext: `${character.name ? `Name=${character.name}. ` : ''}${character.visual}`,
        maximumShots: config.maximumShots,
    });
    setExtensionPrompt(PROMPT_KEY, contract, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
    document.documentElement.dataset.janimaAutocgEnabled = 'true';
}

function foregroundGeneration(type, options = {}, dryRun = false) {
    return !dryRun
        && settings().enabled
        && settings().automatic
        && type !== 'quiet'
        && type !== 'impersonate'
        && !options?.quiet_prompt
        && !options?.quietImage;
}

function beginGeneration(type, options = {}, dryRun = false) {
    if (!foregroundGeneration(type, options, dryRun)) return;
    refreshDirectorPrompt();
    runtime.pendingForeground = {
        id: `${Date.now().toString(36)}-${++runtime.generationSerial}`,
        chatId: String(getCurrentChatId?.() || ''),
        startedAt: Date.now(),
    };
}

function cleanLegacyPromptLines(text) {
    return settings().cleanLegacyPrompts ? stripLegacyImagePromptLines(text) : String(text || '');
}

function explicitAdultsConfirmed(packet) {
    if (!['nsfw', 'explicit'].includes(packet?.safety)) return true;
    if (!packet?.cast?.length) return false;
    return packet.cast.every(cast => /(?:\badult\b|\b(?:1[89]|[2-9]\d)\s*(?:years? old|yo)\b|成人|成年)/i.test(`${cast.dna} ${cast.id}`));
}

function recordFromPacket(packet, {
    bible,
    story,
    messageId,
    generationId,
    chatId,
    previousRecords,
}) {
    if (!hasFemale(packet) || !explicitAdultsConfirmed(packet)) return null;
    const normalizedStory = normalizeAnchorText(story);
    const normalizedQuote = normalizeAnchorText(packet.quote);
    if (!normalizedQuote || !normalizedStory.includes(normalizedQuote)) return null;
    if (isDuplicateBeat(packet, previousRecords)) return null;
    mergePacketIntoBible(bible, packet);
    const compiled = compilePrompt(packet, bible, packet.cast?.some(cast => cast.dna) ? '' : currentCharacterContext().visual);
    return {
        id: packet.id,
        generationId,
        chatId,
        messageId,
        paragraphIndex: paragraphIndexForQuote(story, packet.quote),
        packet: compiled.packet,
        prompt: compiled.positive,
        negative: compiled.negative,
        seed: seedForPacket(compiled.packet),
        retry: 0,
        status: 'queued',
        promptId: '',
        url: '',
        image: null,
        error: '',
        createdAt: Date.now(),
        completedAt: 0,
    };
}

function cancelLiveRecordsForMessage(messageId) {
    const id = Number(messageId);
    for (const record of runtime.jobs.values()) {
        if (Number(record.messageId) !== id) continue;
        record.cancelRequested = true;
        record.controller?.abort('message-replaced');
        runtime.jobs.delete(recordKey(record));
    }
    runtime.queue = runtime.queue.filter(record => Number(record.messageId) !== id);
}

function canProcessMessage(messageId, messageType = '', force = false, rawText = '') {
    if (force || /<!--\s*JANIMA_CG(?:_END)?\s*:/i.test(rawText)) return true;
    if (Number(messageId) !== latestAssistantId()) return false;
    const restored = new Set(['first_message', 'extension', 'command']);
    if (restored.has(String(messageType || '').toLowerCase())) return false;
    const pending = runtime.pendingForeground;
    return Boolean(pending
        && pending.chatId === String(getCurrentChatId?.() || '')
        && Date.now() - pending.startedAt < 180000);
}

async function processAssistantMessage(messageId, { messageType = '', force = false } = {}) {
    const id = Number(messageId);
    if (!settings().enabled || !Number.isInteger(id) || id < 0 || !isAssistantMessage(id)) return;
    if (runtime.processing.has(id)) return;
    const rawText = String(chat[id]?.mes || '');
    if (!canProcessMessage(id, messageType, force, rawText)) {
        scheduleRender(30);
        return;
    }
    runtime.processing.add(id);
    try {
        const story = cleanLegacyPromptLines(extractNarrativeStory(rawText));
        if (splitStoryParagraphs(story).length === 0) return;
        const processedHash = String(stableHash(story));
        const storage = storageFor(chat[id], true);
        if (!force && storage.processedHash === processedHash) {
            scheduleRender(20);
            return;
        }

        cancelLiveRecordsForMessage(id);
        storage.shots = [];
        storage.processedHash = processedHash;

        const config = settings();
        const bible = buildCurrentBible();
        const parsed = parseCgPackets(rawText);
        if (parsed.errors.length) console.warn(`[${EXT_NAME}] 忽略格式错误的隐藏分镜数据`, parsed.errors);
        let packets = parsed.packets;
        if (!packets.length && config.localFallback) {
            const character = storyCharacterContext(story);
            packets = buildFallbackPackets(story, {
                bible,
                characterName: character.name,
                characterVisual: character.visual,
                maximum: Math.min(Number(config.fallbackShots) || 2, Number(config.maximumShots) || 3),
            });
        }

        const generationId = `msg-${id}-${processedHash}`;
        const previousRecords = recentPersistedRecords(8);
        const accepted = [];
        for (const packet of packets) {
            if (accepted.length >= Math.max(1, Number(config.maximumShots) || 3)) break;
            const record = recordFromPacket(packet, {
                bible,
                story,
                messageId: id,
                generationId,
                chatId: String(getCurrentChatId?.() || ''),
                previousRecords: [...previousRecords, ...accepted],
            });
            if (!record) continue;
            accepted.push(record);
            runtime.jobs.set(recordKey(record), record);
            upsertRecordInMessage(record);
        }

        const cleaned = cleanLegacyPromptLines(stripProtocol(rawText));
        if (cleaned !== chat[id].mes) {
            chat[id].mes = cleaned;
            if (Array.isArray(chat[id].swipes) && Number.isInteger(chat[id].swipe_id)) chat[id].swipes[chat[id].swipe_id] = cleaned;
            updateMessageBlock(id, chat[id]);
        }
        await saveChatConditional?.();
        for (const record of accepted) enqueueRecord(record);
        runtime.pendingForeground = null;
        refreshDirectorPrompt();
        scheduleRender(20);
        console.info(`[${EXT_NAME}] 已处理消息 ${id}，分镜 ${accepted.length} 张`);
    } catch (error) {
        console.error(`[${EXT_NAME}] 处理回复失败`, error);
        toast('error', `自动分镜失败：${error?.message || error}`);
    } finally {
        runtime.processing.delete(id);
    }
}

function recordsForMessage(messageId) {
    const result = [];
    const keys = new Set();
    const add = record => {
        const key = recordKey(record);
        if (keys.has(key)) return;
        keys.add(key);
        result.push(record);
    };
    for (const persisted of storageFor(chat?.[Number(messageId)])?.shots || []) add(persisted);
    for (const record of runtime.jobs.values()) {
        if (record.chatId && String(record.chatId) !== String(getCurrentChatId?.() || '')) continue;
        if (Number(record.messageId) !== Number(messageId)) continue;
        const key = recordKey(record);
        const existing = result.findIndex(item => recordKey(item) === key);
        if (existing >= 0) result[existing] = record;
        else add(record);
    }
    return result.sort((a, b) => Number(a.paragraphIndex ?? 9999) - Number(b.paragraphIndex ?? 9999)
        || Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

function actionButton(label, action, title = '') {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'janima-autocg-action menu_button';
    element.dataset.action = action;
    element.textContent = label;
    if (title) element.title = title;
    return element;
}

function buildSlot(record) {
    const slot = document.createElement('section');
    slot.className = `janima-autocg-slot is-${record.status || 'queued'}`;
    slot.dataset.shotId = record.id;
    slot.dataset.generationId = record.generationId || '';

    if (record.status === 'done' && record.url) {
        const image = document.createElement('img');
        image.className = 'janima-autocg-image';
        image.src = record.url;
        image.alt = '剧情自动生成插图';
        image.loading = 'lazy';
        image.decoding = 'async';
        slot.append(image);
    } else {
        const status = document.createElement('div');
        status.className = 'janima-autocg-status';
        const spinner = document.createElement('span');
        spinner.className = 'janima-autocg-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        const body = document.createElement('span');
        body.className = 'janima-autocg-status-body';
        const title = document.createElement('span');
        title.textContent = record.status === 'submitting'
            ? '正在提交这一幕…'
            : record.status === 'generating'
                ? 'ComfyUI 正在绘制这一幕…'
                : record.status === 'error'
                    ? '这一幕生成失败'
                    : record.status === 'cancelled'
                        ? '已停止生成'
                        : '这一幕已进入绘图队列…';
        body.append(title);
        if (record.status === 'error' && record.error) {
            const detail = document.createElement('small');
            detail.className = 'janima-autocg-error';
            detail.textContent = record.error;
            body.append(detail);
        }
        if (!['queued', 'submitting', 'generating'].includes(record.status)) spinner.hidden = true;
        status.append(spinner, body);
        slot.append(status);
    }

    const controls = document.createElement('div');
    controls.className = 'janima-autocg-controls';
    if (['done', 'error', 'cancelled'].includes(record.status)) controls.append(actionButton('重绘', 'reroll', '使用同一剧情分镜重新生成'));
    if (['queued', 'submitting', 'generating'].includes(record.status)) controls.append(actionButton('停止', 'cancel'));
    if (controls.childElementCount) slot.append(controls);
    return slot;
}

function renderMessage(messageId) {
    const host = messageHost(messageId);
    const root = host?.querySelector('.mes_text');
    if (!root) return;
    const records = recordsForMessage(messageId);
    const signature = stableHash(JSON.stringify(records.map(record => [
        record.generationId,
        record.id,
        record.paragraphIndex,
        record.status,
        record.promptId,
        record.url,
        record.error,
        record.retry,
    ]))).toString(36);
    if (host.dataset.janimaAutocgRender === signature && root.querySelectorAll('.janima-autocg-slot').length === records.length) return;

    root.querySelectorAll('.janima-autocg-slot').forEach(node => node.remove());
    const blocks = semanticBlocks(root);
    const lastAnchorByParagraph = new Map();
    for (const record of records) {
        const slot = buildSlot(record);
        if (!blocks.length) {
            root.append(slot);
            continue;
        }
        const index = clampParagraphIndex(record.paragraphIndex, blocks.length);
        const anchor = lastAnchorByParagraph.get(index) || blocks[index];
        anchor.insertAdjacentElement('afterend', slot);
        lastAnchorByParagraph.set(index, slot);
    }
    host.dataset.janimaAutocgRender = signature;
}

function renderAll() {
    document.querySelectorAll('#chat .mes[mesid], #chat .mes[data-mes-id]').forEach(host => {
        const id = Number(host.getAttribute('mesid') ?? host.dataset.mesId);
        if (Number.isInteger(id) && id >= 0 && isAssistantMessage(id)) renderMessage(id);
    });
}

function scheduleRender(delay = 35) {
    clearTimeout(runtime.renderTimer);
    runtime.renderTimer = setTimeout(renderAll, delay);
}

function updateConnectionUi() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    const pill = root?.querySelector('[data-role="connection"]');
    if (!pill) return;
    pill.dataset.state = runtime.connection.state;
    pill.textContent = runtime.connection.message;
}

function friendlyComfyError(error) {
    const text = String(error?.message || error || '未知错误');
    if (error?.name === 'AbortError') return '请求已停止或超时';
    if (/Failed to fetch|NetworkError|Load failed/i.test(text)) {
        return '手机浏览器无法直连 ComfyUI。请使用电脑局域网 IP，并确认 ComfyUI 已启用 --listen 0.0.0.0 和 --enable-cors-header *。';
    }
    return text;
}

async function pingComfy({ notify = false } = {}) {
    runtime.connection = { state: 'checking', message: '正在连接…' };
    updateConnectionUi();
    try {
        const result = await pingComfyNative(settings().comfyUrl, { timeoutMs: 7000 });
        runtime.connection = { state: 'ok', message: `ComfyUI 已连接（${result.endpoint}）` };
        if (notify) toast('success', `已直连 ${normalizeComfyUrl(settings().comfyUrl)}`);
        return true;
    } catch (error) {
        const message = friendlyComfyError(error);
        runtime.connection = { state: 'error', message: 'ComfyUI 连接失败' };
        if (notify) toast('error', message);
        console.error(`[${EXT_NAME}] ComfyUI 连接失败`, error);
        return false;
    } finally {
        updateConnectionUi();
    }
}

function enqueueRecord(record) {
    if (runtime.queue.some(item => recordKey(item) === recordKey(record))) return;
    if (runtime.running && recordKey(runtime.running) === recordKey(record)) return;
    record.status = 'queued';
    record.error = '';
    runtime.queue.push(record);
    upsertRecordInMessage(record);
    scheduleRender();
    void pumpQueue();
}

async function generateRecord(record) {
    const config = settings();
    record.status = record.promptId ? 'generating' : 'submitting';
    record.error = '';
    record.controller = new AbortController();
    upsertRecordInMessage(record);
    scheduleRender();
    try {
        const workflow = buildAnimaWorkflow({
            positive: record.prompt,
            negative: record.negative,
            seed: record.seed,
            profile: config.profile,
        });
        if (!record.promptId) {
            const submitted = await submitComfyPrompt(config.comfyUrl, workflow, {
                signal: record.controller.signal,
                timeoutMs: 15000,
            });
            record.promptId = submitted.promptId;
            record.status = 'generating';
            await persistRecord(record);
            scheduleRender();
        }
        const result = await waitForComfyResult(config.comfyUrl, record.promptId, {
            signal: record.controller.signal,
            timeoutMs: Math.max(30000, Number(config.generationTimeoutMs) || 180000),
            pollIntervalMs: Math.max(300, Number(config.pollIntervalMs) || 1000),
            requestTimeoutMs: 12000,
        });
        if (record.chatId && String(record.chatId) !== String(getCurrentChatId?.() || '')) {
            record.cancelRequested = true;
            throw new DOMException('Chat changed', 'AbortError');
        }
        const image = result.images.at(-1);
        record.image = image;
        record.url = buildComfyViewUrl(config.comfyUrl, image);
        record.status = 'done';
        record.error = '';
        record.completedAt = Date.now();
        runtime.connection = { state: 'ok', message: 'ComfyUI 已连接' };
    } catch (error) {
        if (record.cancelRequested || record.controller.signal.aborted) {
            record.status = record.cancelRequested ? 'cancelled' : 'error';
            record.error = record.cancelRequested ? '' : friendlyComfyError(error);
        } else {
            record.status = 'error';
            record.error = friendlyComfyError(error).slice(0, 900);
        }
        runtime.connection = { state: 'error', message: 'ComfyUI 生成失败' };
        console.error(`[${EXT_NAME}] 图片生成失败`, error);
    } finally {
        delete record.controller;
        delete record.cancelRequested;
        await persistRecord(record);
        updateConnectionUi();
        scheduleRender();
    }
}

async function pumpQueue() {
    if (runtime.running || !settings().enabled) return;
    const record = runtime.queue.shift();
    if (!record) return;
    runtime.running = record;
    try { await generateRecord(record); }
    finally {
        runtime.running = null;
        if (runtime.queue.length) setTimeout(() => void pumpQueue(), 30);
    }
}

function findRecordFromButton(target) {
    const slot = target.closest('.janima-autocg-slot');
    if (!slot) return null;
    const key = `${slot.dataset.generationId || 'persisted'}:${slot.dataset.shotId}`;
    const live = runtime.jobs.get(key);
    if (live) return live;
    const host = target.closest('.mes');
    const messageId = Number(host?.getAttribute('mesid') ?? host?.dataset?.mesId);
    const persisted = recordsForMessage(messageId).find(item => item.id === slot.dataset.shotId && (item.generationId || '') === (slot.dataset.generationId || ''));
    if (!persisted) return null;
    const record = { ...structuredClone(persisted), messageId, chatId: String(getCurrentChatId?.() || '') };
    runtime.jobs.set(recordKey(record), record);
    return record;
}

function rerollRecord(record) {
    if (!record || ['queued', 'submitting', 'generating'].includes(record.status)) return;
    record.retry = Number(record.retry || 0) + 1;
    record.seed = seedForPacket(record.packet, record.retry);
    record.promptId = '';
    record.url = '';
    record.image = null;
    record.error = '';
    record.completedAt = 0;
    enqueueRecord(record);
    void persistRecord(record);
}

function cancelRecord(record) {
    if (!record) return;
    if (runtime.running && recordKey(runtime.running) === recordKey(record)) {
        record.cancelRequested = true;
        record.controller?.abort('cancelled');
        return;
    }
    runtime.queue = runtime.queue.filter(item => recordKey(item) !== recordKey(record));
    record.status = 'cancelled';
    record.error = '';
    void persistRecord(record);
    scheduleRender();
}

function bindSlotActions() {
    document.addEventListener('click', event => {
        const target = event.target.closest?.('.janima-autocg-action');
        if (!target) return;
        const record = findRecordFromButton(target);
        if (target.dataset.action === 'reroll') rerollRecord(record);
        if (target.dataset.action === 'cancel') cancelRecord(record);
    });
}

function resumeInterruptedJobs() {
    if (!settings().resumeInterrupted) return;
    const lower = Math.max(0, (chat?.length || 0) - 20);
    for (let messageId = lower; messageId < (chat?.length || 0); messageId++) {
        const shots = storageFor(chat[messageId])?.shots;
        if (!Array.isArray(shots)) continue;
        for (const persisted of shots) {
            if (!['queued', 'submitting', 'generating'].includes(persisted.status) || persisted.url) continue;
            const record = {
                ...structuredClone(persisted),
                messageId,
                chatId: String(getCurrentChatId?.() || ''),
                status: 'queued',
                error: '',
            };
            runtime.jobs.set(recordKey(record), record);
            enqueueRecord(record);
        }
    }
}

function removeProtocolFromChatMessages(eventData = {}) {
    if (!Array.isArray(eventData.chat)) return;
    for (const message of eventData.chat) {
        if (typeof message?.content === 'string' && message.content.includes('JANIMA_CG')) message.content = stripProtocol(message.content);
    }
}

function removeProtocolFromTextPrompt(eventData = {}) {
    if (typeof eventData.prompt === 'string' && eventData.prompt.includes('JANIMA_CG')) eventData.prompt = stripProtocol(eventData.prompt);
}

function onChatChanged() {
    const current = String(getCurrentChatId?.() || '');
    runtime.pendingForeground = null;
    for (const record of [...runtime.queue]) {
        if (record.chatId && record.chatId !== current) cancelRecord(record);
    }
    if (runtime.running?.chatId && runtime.running.chatId !== current) cancelRecord(runtime.running);
    refreshDirectorPrompt();
    setTimeout(() => {
        resumeInterruptedJobs();
        renderAll();
    }, 180);
}

function settingsHtml() {
    return `
<div id="janima_autocg_settings" class="extension_container janima-autocg-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>JANIMA Galgame 自动CG <small>v${EXT_VERSION}</small></b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="janima-autocg-settings-row">
        <span class="janima-autocg-connection" data-role="connection" data-state="unknown">尚未检测</span>
        <button type="button" class="menu_button" data-role="ping">检测 ComfyUI</button>
      </div>
      <label class="checkbox_label"><input type="checkbox" name="enabled">启用回复后自动CG</label>
      <label class="checkbox_label"><input type="checkbox" name="localFallback">主模型漏写隐藏分镜时使用本地规则补图</label>
      <label>ComfyUI 局域网地址<input class="text_pole" name="comfyUrl" type="url" autocomplete="off" placeholder="http://192.168.1.12:8188"></label>
      <label>单轮最多CG<input class="text_pole" name="maximumShots" type="number" min="1" max="3" step="1"></label>
      <label>本地兜底最多CG<input class="text_pole" name="fallbackShots" type="number" min="1" max="3" step="1"></label>
      <label>生成超时（秒）<input class="text_pole" name="generationTimeoutSeconds" type="number" min="30" max="600" step="10"></label>
      <details>
        <summary>工作流与模型文件</summary>
        <label>UNet<input class="text_pole" name="profile.model" type="text"></label>
        <label>CLIP<input class="text_pole" name="profile.clip" type="text"></label>
        <label>VAE<input class="text_pole" name="profile.vae" type="text"></label>
        <label>Turbo LoRA<input class="text_pole" name="profile.lora" type="text"></label>
        <label>宽度<input class="text_pole" name="profile.width" type="number" min="256" max="1536" step="64"></label>
        <label>高度<input class="text_pole" name="profile.height" type="number" min="256" max="1536" step="64"></label>
        <label>步数<input class="text_pole" name="profile.steps" type="number" min="1" max="30" step="1"></label>
        <label>CFG<input class="text_pole" name="profile.cfg" type="number" min="0.1" max="20" step="0.1"></label>
      </details>
      <small>插件直接调用 ComfyUI 的 /prompt、/history 和 /view，不依赖智绘姬、世界书或酒馆后端代理。手机必须填写电脑局域网 IP；ComfyUI 需启用 --listen 0.0.0.0 与 --enable-cors-header *。</small>
    </div>
  </div>
</div>`;
}

function pathGet(root, path) {
    if (path === 'generationTimeoutSeconds') return Math.round(Number(root.generationTimeoutMs || 180000) / 1000);
    return path.split('.').reduce((value, key) => value?.[key], root);
}

function pathSet(root, path, value) {
    if (path === 'generationTimeoutSeconds') {
        root.generationTimeoutMs = Math.max(30000, Number(value || 180) * 1000);
        return;
    }
    const keys = path.split('.');
    const last = keys.pop();
    let target = root;
    for (const key of keys) target = target[key] ||= {};
    target[last] = value;
}

function syncSettingsUi() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    if (!root) return;
    root.querySelectorAll('[name]').forEach(input => {
        const value = pathGet(settings(), input.name);
        if (input.type === 'checkbox') input.checked = Boolean(value);
        else input.value = value ?? '';
    });
    updateConnectionUi();
}

function bindSettings() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    if (!root) return;
    root.addEventListener('change', event => {
        const input = event.target.closest('[name]');
        if (!input) return;
        let value = input.type === 'checkbox' ? input.checked : input.value;
        if (input.type === 'number') value = Number(value);
        pathSet(settings(), input.name, value);
        saveSettingsDebounced?.();
        refreshDirectorPrompt();
        if (input.name === 'enabled' && value) void pumpQueue();
    });
    root.querySelector('[data-role="ping"]')?.addEventListener('click', () => void pingComfy({ notify: true }));
}

function bindEvents() {
    if (runtime.eventsBound) return;
    runtime.eventsBound = true;
    const startEvent = event_types.GENERATION_STARTED || event_types.GENERATION_AFTER_COMMANDS;
    if (startEvent) eventSource.on(startEvent, beginGeneration);
    if (event_types.MESSAGE_RECEIVED) {
        eventSource.on(event_types.MESSAGE_RECEIVED, (messageId, messageType) => {
            setTimeout(() => void processAssistantMessage(messageId, { messageType }), 40);
        });
    }
    if (event_types.GENERATION_ENDED) {
        eventSource.on(event_types.GENERATION_ENDED, () => {
            const id = latestAssistantId();
            if (id >= 0) setTimeout(() => void processAssistantMessage(id), 60);
        });
    }
    if (event_types.GENERATION_STOPPED) {
        eventSource.on(event_types.GENERATION_STOPPED, () => {
            const id = latestAssistantId();
            if (id >= 0) setTimeout(() => void processAssistantMessage(id), 60);
        });
    }
    if (event_types.MESSAGE_SWIPED) {
        eventSource.on(event_types.MESSAGE_SWIPED, messageId => setTimeout(() => void processAssistantMessage(messageId, { force: true }), 100));
    }
    if (event_types.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, removeProtocolFromChatMessages);
    if (event_types.GENERATE_AFTER_COMBINE_PROMPTS) eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, removeProtocolFromTextPrompt);
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    [event_types.MESSAGE_UPDATED, event_types.MORE_MESSAGES_LOADED]
        .filter(Boolean)
        .forEach(type => eventSource.on(type, () => scheduleRender(80)));
}

function observeChat() {
    if (runtime.observer) return;
    runtime.observer = new MutationObserver(mutations => {
        const meaningful = mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes]
            .some(node => !(node instanceof Element) || !node.matches('.janima-autocg-slot')));
        if (meaningful) scheduleRender(65);
    });
    const target = document.querySelector('#chat') || document.body;
    runtime.observer.observe(target, { childList: true, subtree: true });
}

jQuery(async () => {
    if (runtime.initialized) return;
    runtime.initialized = true;
    settings();
    const container = document.querySelector('#extensions_settings') || document.querySelector('#extensions_settings2');
    if (container && !document.querySelector(SETTINGS_SELECTOR)) container.insertAdjacentHTML('beforeend', settingsHtml());
    syncSettingsUi();
    bindSettings();
    bindSlotActions();
    bindEvents();
    observeChat();
    refreshDirectorPrompt();
    resumeInterruptedJobs();
    renderAll();
    setTimeout(() => void pingComfy(), 500);
    globalThis.JANIMA_AUTO_CG = Object.freeze({
        version: EXT_VERSION,
        ping: () => pingComfy({ notify: true }),
        processLatest: () => {
            const id = latestAssistantId();
            return id >= 0 ? processAssistantMessage(id, { force: true }) : Promise.resolve();
        },
        render: renderAll,
        queueLength: () => runtime.queue.length + (runtime.running ? 1 : 0),
        state: () => ({
            pendingForeground: runtime.pendingForeground,
            queue: runtime.queue.length,
            running: runtime.running ? recordKey(runtime.running) : null,
            currentChatId: String(getCurrentChatId?.() || ''),
            comfyUrl: settings().comfyUrl,
        }),
    });
    document.documentElement.dataset.janimaAutocgVersion = EXT_VERSION;
    console.info(`[${EXT_NAME}] v${EXT_VERSION} loaded; native ComfyUI direct mode`);
});
