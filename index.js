import {
    chat,
    characters,
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    getCurrentChatId,
    getRequestHeaders,
    saveChatConditional,
    saveSettingsDebounced,
    setExtensionPrompt,
    this_chid,
    updateMessageBlock,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { saveBase64AsFile } from '../../../utils.js';
import {
    buildDirectorContract,
    buildFallbackPackets,
    compilePrompt,
    createBible,
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
import { buildAnimaWorkflow, buildComfyProxyBody, DEFAULT_ANIMA_PROFILE } from './lib/anima-direct-workflow.mjs';

const EXT_ID = 'codex_scene_image_director';
const EXT_NAME = 'JANIMA Galgame 自动CG';
const EXT_VERSION = '2.0.7';
const SETTINGS_SELECTOR = '#janima_autocg_settings';
const PROMPT_KEY = 'JANIMA_AUTO_CG_V2_DIRECTOR';
const STORAGE_KEY = 'janimaAutoCg';

const DEFAULT_SETTINGS = Object.freeze({
    schema: 27,
    enabled: true,
    automatic: true,
    localFallback: true,
    cleanLegacyPrompts: true,
    maximumShots: 3,
    fallbackShots: 3,
    comfyUrl: 'http://192.168.1.12:8188',
    requestTimeoutMs: 45000,
    resumeInterrupted: true,
    profile: { ...DEFAULT_ANIMA_PROFILE },
});

const runtime = {
    generationSerial: 0,
    active: null,
    queue: [],
    running: null,
    jobs: new Map(),
    renderTimer: null,
    connection: { state: 'unknown', message: '尚未检测' },
    observer: null,
    eventsBound: false,
    initialized: false,
    lastGenerationStartedAt: 0,
    lastGenerationChatId: '',
};

function cloneDefaults() {
    return structuredClone(DEFAULT_SETTINGS);
}

function mergeKnown(base, incoming) {
    const result = structuredClone(base);
    for (const [key, value] of Object.entries(incoming || {})) {
        if (!(key in result)) continue;
        if (value && typeof value === 'object' && !Array.isArray(value) && typeof result[key] === 'object') {
            result[key] = mergeKnown(result[key], value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

function settings() {
    const existing = extension_settings[EXT_ID];
    if (!existing || Number(existing.schema) < 27) {
        extension_settings[EXT_ID] = cloneDefaults();
        saveSettingsDebounced?.();
    } else {
        extension_settings[EXT_ID] = mergeKnown(DEFAULT_SETTINGS, existing);
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
    const visual = [
        character.description,
        character.data?.description,
    ].filter(Boolean).join('\n').replace(/\s+/g, ' ').slice(0, 1400);
    return { name, visual };
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
        message.extra[STORAGE_KEY] = { version: 2, shots: [] };
    }
    return message.extra[STORAGE_KEY] || null;
}

function recentPersistedRecords(limit = 12) {
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
    const currentChatId = String(getCurrentChatId?.() || '');
    runtime.lastGenerationStartedAt = Date.now();
    runtime.lastGenerationChatId = currentChatId;
    const generationId = `${Date.now().toString(36)}-${++runtime.generationSerial}`;
    runtime.active = {
        id: generationId,
        chatId: currentChatId,
        text: '',
        messageId: -1,
        packetIds: new Set(),
        records: [],
        bible: buildCurrentBible(),
        finalized: false,
    };
    console.debug(`[${EXT_NAME}] foreground generation started`, { generationId, type, chatId: currentChatId });
}

function recordKey(record) {
    return `${record.generationId || 'persisted'}:${record.id}`;
}

function serializableRecord(record) {
    return {
        id: record.id,
        generationId: record.generationId,
        chatId: record.chatId,
        packet: record.packet,
        prompt: record.prompt,
        negative: record.negative,
        seed: record.seed,
        retry: record.retry || 0,
        status: record.status,
        url: record.url || '',
        format: record.format || '',
        error: record.error || '',
        createdAt: record.createdAt,
        completedAt: record.completedAt || 0,
    };
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
    try {
        await saveChatConditional?.();
    } catch (error) {
        console.warn(`[${EXT_NAME}] failed to persist CG state`, error);
    }
}

function normalizeForAnchor(value = '') {
    return String(value).replace(/\s+/g, ' ').replace(/[\u200b-\u200d\ufeff]/g, '').trim();
}

function anchorForQuote(root, quote) {
    const wanted = normalizeForAnchor(quote);
    if (!wanted) return null;
    // Regex scripts and card themes often wrap the final prose in several
    // nested containers. Prefer the smallest matching descendant so a slot is
    // inserted after the actual story paragraph instead of after the wrapper.
    const candidates = [...root.querySelectorAll('p, blockquote, li, div')]
        .filter(node => !node.closest('.janima-autocg-slot'))
        .sort((a, b) => normalizeForAnchor(a.textContent).length - normalizeForAnchor(b.textContent).length);
    const exact = candidates.find(node => normalizeForAnchor(node.textContent).includes(wanted));
    if (exact) return exact;
    const fragment = wanted.slice(0, Math.min(42, wanted.length));
    return candidates.find(node => normalizeForAnchor(node.textContent).includes(fragment)) || null;
}

function recordsForMessage(messageId) {
    const result = [];
    const seen = new Set();
    const seenBeats = new Set();
    const add = (record, replaceLive = false) => {
        const key = `${record.generationId || 'persisted'}:${record.id}`;
        const beat = `${record.id}:${stableHash(`${record.packet?.quote || ''}|${record.packet?.action || ''}`)}`;
        if (seen.has(key)) return;
        const duplicateIndex = result.findIndex(item => `${item.id}:${stableHash(`${item.packet?.quote || ''}|${item.packet?.action || ''}`)}` === beat);
        if (duplicateIndex >= 0) {
            if (replaceLive && Number(record.createdAt || 0) < Number(result[duplicateIndex].createdAt || 0)) result[duplicateIndex] = record;
            return;
        }
        seen.add(key);
        seenBeats.add(beat);
        result.push(record);
    };
    const persisted = storageFor(chat?.[Number(messageId)])?.shots || [];
    for (const record of persisted) add(record);
    for (const record of runtime.jobs.values()) {
        if (Number(record.messageId) !== Number(messageId)) continue;
        const key = recordKey(record);
        const existingIndex = result.findIndex(item => `${item.generationId || 'persisted'}:${item.id}` === key);
        if (existingIndex >= 0) result[existingIndex] = record;
        else add(record, true);
    }
    return result.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

function button(label, action, title = '') {
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
        const text = document.createElement('span');
        text.textContent = record.status === 'generating'
            ? '正在绘制这一幕…'
            : record.status === 'error'
                ? '这一幕生成失败'
                : record.status === 'cancelled'
                    ? '已停止生成'
                    : '这一幕已进入绘图队列…';
        if (!['queued', 'generating'].includes(record.status)) spinner.hidden = true;
        status.append(spinner, text);
        slot.append(status);
    }

    const controls = document.createElement('div');
    controls.className = 'janima-autocg-controls';
    if (['done', 'error', 'cancelled'].includes(record.status)) controls.append(button('重绘', 'reroll', '用同一剧情与人物设定重新生成'));
    if (['queued', 'generating'].includes(record.status)) controls.append(button('停止', 'cancel'));
    if (controls.childElementCount) slot.append(controls);
    return slot;
}

function renderMessage(messageId) {
    const host = messageHost(messageId);
    const root = host?.querySelector('.mes_text');
    if (!root) return;
    const records = recordsForMessage(messageId);
    const signature = stableHash(JSON.stringify(records.map(record => [record.generationId, record.id, record.status, record.url, record.retry]))).toString(36);
    if (host.dataset.janimaAutocgRender === signature && root.querySelectorAll('.janima-autocg-slot').length === records.length) return;
    root.querySelectorAll('.janima-autocg-slot').forEach(node => node.remove());
    const tailByAnchor = new Map();
    for (const record of records) {
        const slot = buildSlot(record);
        const anchor = anchorForQuote(root, record.packet?.quote);
        if (!anchor) {
            root.append(slot);
            continue;
        }
        const tail = tailByAnchor.get(anchor) || anchor;
        tail.insertAdjacentElement('afterend', slot);
        tailByAnchor.set(anchor, slot);
    }
    host.dataset.janimaAutocgRender = signature;
}

function renderAll() {
    document.querySelectorAll('#chat .mes[mesid]').forEach(host => {
        const id = Number(host.getAttribute('mesid'));
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

async function pingComfy({ notify = false } = {}) {
    runtime.connection = { state: 'checking', message: '正在连接…' };
    updateConnectionUi();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
        const response = await fetch('/api/sd/comfy/ping', {
            method: 'POST',
            headers: getRequestHeaders(),
            signal: controller.signal,
            body: JSON.stringify({ url: settings().comfyUrl }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        runtime.connection = { state: 'ok', message: 'ComfyUI 已连接' };
        if (notify) toast('success', `已连接 ${settings().comfyUrl}`);
        return true;
    } catch (error) {
        runtime.connection = { state: 'error', message: 'ComfyUI 连接失败' };
        if (notify) toast('error', `无法连接 ${settings().comfyUrl}：${error?.message || error}`);
        return false;
    } finally {
        clearTimeout(timer);
        updateConnectionUi();
    }
}

function enqueueRecord(record) {
    if (runtime.queue.some(item => recordKey(item) === recordKey(record))) return;
    record.status = 'queued';
    record.error = '';
    runtime.queue.push(record);
    upsertRecordInMessage(record);
    scheduleRender();
    void pumpQueue();
}

async function generateRecord(record) {
    const config = settings();
    record.status = 'generating';
    record.error = '';
    record.controller = new AbortController();
    upsertRecordInMessage(record);
    scheduleRender();
    const timer = setTimeout(() => record.controller.abort('timeout'), Math.max(10000, Number(config.requestTimeoutMs) || 45000));
    try {
        const workflow = buildAnimaWorkflow({
            positive: record.prompt,
            negative: record.negative,
            seed: record.seed,
            profile: config.profile,
        });
        const response = await fetch('/api/sd/comfy/generate', {
            method: 'POST',
            headers: getRequestHeaders(),
            signal: record.controller.signal,
            body: JSON.stringify(buildComfyProxyBody(config.comfyUrl, workflow)),
        });
        if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
        const result = await response.json();
        if (!result?.data) throw new Error('ComfyUI 未返回图片');
        if (record.chatId && String(record.chatId) !== String(getCurrentChatId?.() || '')) {
            record.cancelRequested = true;
            throw new DOMException('Chat changed', 'AbortError');
        }
        const character = currentCharacterContext();
        const fileName = `autocg_${Date.now()}_${record.id}_${record.retry || 0}`;
        record.url = await saveBase64AsFile(result.data, character.name || 'JANIMA_AutoCG', fileName, result.format || 'png');
        record.format = result.format || 'png';
        record.status = 'done';
        record.completedAt = Date.now();
        runtime.connection = { state: 'ok', message: 'ComfyUI 已连接' };
    } catch (error) {
        if (record.cancelRequested || record.controller.signal.aborted) {
            record.status = record.cancelRequested ? 'cancelled' : 'error';
            record.error = record.cancelRequested ? '' : '生成超时或连接中断';
        } else {
            record.status = 'error';
            record.error = String(error?.message || error).slice(0, 500);
        }
        runtime.connection = { state: 'error', message: 'ComfyUI 生成失败' };
        console.error(`[${EXT_NAME}] image generation failed`, error);
    } finally {
        clearTimeout(timer);
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
    try {
        await generateRecord(record);
    } finally {
        runtime.running = null;
        if (runtime.queue.length) setTimeout(() => void pumpQueue(), 20);
    }
}

function currentGenerationRecords(active = runtime.active) {
    return active?.records || [];
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
        || String(story).match(/([A-Za-z][A-Za-z0-9 _-]{1,30}|[\u3400-\u9fff]{2,4})(?=的[^。\n]{0,16}(?:长发|短发|头发|刘海|眼睛|眼眸|瞳))/i);
    const detectedName = String(nameMatch?.[1] || '').trim();
    const appearance = userText
        .split(/(?<=[。！？；\n])/)
        .map(value => value.trim())
        .filter(value => /(?:长发|短发|刘海|眼睛|眼眸|瞳|身材|体型|肤色|脸型|制服|连衣裙|裙装|衬衫|外套|领结|发带|穿着|衣着)/i.test(value))
        .slice(-3)
        .join(' ')
        .slice(0, 1000);
    const sameAsCard = !detectedName || !card.name || detectedName.toLowerCase() === card.name.toLowerCase();
    return {
        name: detectedName || card.name,
        visual: [sameAsCard ? card.visual : '', appearance ? `adult woman; ${appearance}` : ''].filter(Boolean).join(' ').slice(0, 1400),
    };
}

function visibleStoryForMessage(messageId, fallback = '') {
    const root = messageHost(messageId)?.querySelector('.mes_text');
    const visible = String(root?.innerText || '').trim();
    return visible.length >= 20 ? visible : String(fallback || '');
}

function explicitAdultsConfirmed(packet) {
    if (!['nsfw', 'explicit'].includes(packet.safety)) return true;
    if (!packet.cast?.length) return false;
    return packet.cast.every(cast => /(?:\badult\b|\b(?:1[89]|[2-9]\d)\s*(?:years? old|yo)\b|成人|成年)/i.test(`${cast.dna} ${cast.id}`));
}

function acceptPacket(packet, sourceText, messageId = -1) {
    const active = runtime.active;
    if (!active || active.finalized || active.packetIds.has(packet.id)) return null;
    if (active.records.length >= Math.max(1, Number(settings().maximumShots) || 3)) return null;
    if (currentGenerationRecords(active).length >= Math.max(1, Number(settings().maximumShots) || 3)) return null;
    if (!hasFemale(packet)) return null;
    if (!explicitAdultsConfirmed(packet)) {
        console.warn(`[${EXT_NAME}] skipped adult shot without explicit adult cast proof`, packet.id);
        return null;
    }
    const normalizedSource = normalizeForAnchor(sourceText);
    if (!normalizedSource.includes(normalizeForAnchor(packet.quote))) return null;
    const previous = [...recentPersistedRecords(8), ...currentGenerationRecords(active)];
    // Local fallback has already deduplicated the complete visible reply. Do
    // not run it through the packet-stream history gate a second time: doing
    // so can suppress a valid later action because an older reply used the
    // same generic stage label.
    if (!String(packet.id).startsWith('fallback_') && isDuplicateBeat(packet, previous)) return null;

    mergePacketIntoBible(active.bible, packet);
    const compiled = compilePrompt(packet, active.bible, packet.cast?.some(cast => cast.dna) ? '' : currentCharacterContext().visual);
    const resolvedMessageId = Number.isInteger(Number(messageId)) && Number(messageId) >= 0 ? Number(messageId) : latestAssistantId();
    const record = {
        id: packet.id,
        generationId: active.id,
        chatId: active.chatId,
        messageId: resolvedMessageId,
        packet: compiled.packet,
        prompt: compiled.positive,
        negative: compiled.negative,
        seed: seedForPacket(compiled.packet),
        retry: 0,
        status: 'queued',
        url: '',
        error: '',
        createdAt: Date.now(),
    };
    active.packetIds.add(packet.id);
    active.records.push(record);
    runtime.jobs.set(recordKey(record), record);
    upsertRecordInMessage(record);
    enqueueRecord(record);
    return record;
}

function consumePackets(text, messageId = -1) {
    if (!runtime.active) return 0;
    let accepted = 0;
    const { packets, errors } = parseCgPackets(text);
    if (errors.length) console.debug(`[${EXT_NAME}] waiting for/ignored malformed packet`, errors);
    for (const packet of packets) if (acceptPacket(packet, text, messageId)) accepted++;
    return accepted;
}

function onStream(text) {
    if (!runtime.active || runtime.active.finalized) return;
    runtime.active.text = String(text || '');
    runtime.active.messageId = latestAssistantId();
    consumePackets(runtime.active.text, runtime.active.messageId);
    scheduleRender(55);
}

function cleanLegacyPromptLines(text) {
    return settings().cleanLegacyPrompts ? stripLegacyImagePromptLines(text) : String(text);
}

function canCreateLateForegroundSession(messageId, messageType, committedText) {
    if (/<!--\s*JANIMA_CG(?:_END)?\s*:/i.test(committedText)) return true;
    const restoredTypes = new Set(['first_message', 'extension', 'command']);
    const currentChatId = String(getCurrentChatId?.() || '');
    return !restoredTypes.has(String(messageType || '').toLowerCase())
        && messageId === latestAssistantId()
        && runtime.lastGenerationChatId === currentChatId
        && Date.now() - runtime.lastGenerationStartedAt < 180000;
}

async function finalizeMessage(messageId, messageType = '') {
    const id = Number(messageId);
    if (!Number.isInteger(id) || id < 0 || !isAssistantMessage(id)) return;
    const committedText = String(chat[id].mes || '');
    let active = runtime.active;
    // Streaming completion can emit MESSAGE_RECEIVED and GENERATION_ENDED for
    // the same assistant message. The first pass already storyboarded, queued,
    // and persisted it; never reinterpret that same reply as a new late pass.
    if (active?.finalized
        && Number(active.messageId) === id
        && String(active.chatId || '') === String(getCurrentChatId?.() || '')) {
        scheduleRender(20);
        return;
    }
    if (!active || active.finalized) {
        // MESSAGE_RECEIVED also fires while old chats and greeting messages are
        // restored. A short-lived GENERATION_STARTED marker distinguishes the
        // newest real foreground reply from those historical events, even when
        // the main model ignored our hidden packet protocol.
        if (!canCreateLateForegroundSession(id, messageType, committedText)) {
            scheduleRender(20);
            return;
        }
        active = {
            id: `late-${Date.now().toString(36)}-${++runtime.generationSerial}`,
            chatId: String(getCurrentChatId?.() || ''),
            text: committedText,
            messageId: id,
            packetIds: new Set(),
            records: [],
            bible: buildCurrentBible(),
            finalized: false,
        };
        runtime.active = active;
    }
    active.messageId = id;
    active.text = committedText || active.text || '';
    for (const record of active.records) record.messageId = id;
    consumePackets(active.text, id);

    if (!active.records.length && settings().localFallback) {
        const cleanStory = cleanLegacyPromptLines(stripProtocol(visibleStoryForMessage(id, active.text)));
        const character = storyCharacterContext(cleanStory);
        // Legacy worldbooks may leave visible [tag, tag, ...] paragraphs. They
        // are neither story evidence nor stable DOM anchors because we remove
        // them below, so storyboard only the clean committed prose.
        const fallback = buildFallbackPackets(cleanStory, {
            bible: active.bible,
            characterName: character.name,
            characterVisual: character.visual,
            maximum: Math.min(settings().fallbackShots, settings().maximumShots),
        });
        for (const packet of fallback) acceptPacket(packet, cleanStory, id);
    }

    for (const record of active.records) {
        record.messageId = id;
        upsertRecordInMessage(record);
    }
    const cleaned = cleanLegacyPromptLines(stripProtocol(active.text));
    if (cleaned !== chat[id].mes) {
        chat[id].mes = cleaned;
        if (Array.isArray(chat[id].swipes) && Number.isInteger(chat[id].swipe_id)) chat[id].swipes[chat[id].swipe_id] = cleaned;
        updateMessageBlock(id, chat[id]);
    }
    active.finalized = true;
    console.debug(`[${EXT_NAME}] foreground reply finalized`, {
        generationId: active.id,
        messageId: id,
        messageType,
        shots: active.records.length,
    });
    await saveChatConditional?.();
    refreshDirectorPrompt();
    scheduleRender(20);
}

function findRecordFromButton(target) {
    const slot = target.closest('.janima-autocg-slot');
    if (!slot) return null;
    const key = `${slot.dataset.generationId || 'persisted'}:${slot.dataset.shotId}`;
    const live = runtime.jobs.get(key);
    if (live) return live;
    const host = target.closest('.mes');
    const messageId = Number(host?.getAttribute('mesid'));
    const persisted = recordsForMessage(messageId).find(item => item.id === slot.dataset.shotId && (item.generationId || '') === (slot.dataset.generationId || ''));
    if (!persisted) return null;
    const record = { ...structuredClone(persisted), messageId, chatId: String(getCurrentChatId?.() || '') };
    runtime.jobs.set(recordKey(record), record);
    return record;
}

function rerollRecord(record) {
    if (!record || ['queued', 'generating'].includes(record.status)) return;
    record.retry = Number(record.retry || 0) + 1;
    record.seed = seedForPacket(record.packet, record.retry);
    record.url = '';
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
    if (runtime.active && runtime.active.chatId && runtime.active.chatId !== current && !runtime.active.finalized) {
        for (const record of runtime.active.records) cancelRecord(record);
        runtime.active.finalized = true;
    }
    for (const record of [...runtime.queue]) {
        if (record.chatId && record.chatId !== current) cancelRecord(record);
    }
    if (runtime.running?.chatId && runtime.running.chatId !== current) cancelRecord(runtime.running);
    runtime.active = null;
    runtime.lastGenerationStartedAt = 0;
    runtime.lastGenerationChatId = current;
    refreshDirectorPrompt();
    setTimeout(() => {
        resumeInterruptedJobs();
        renderAll();
    }, 180);
}

function resumeInterruptedJobs() {
    if (!settings().resumeInterrupted) return;
    const lower = Math.max(0, (chat?.length || 0) - 20);
    for (let messageId = lower; messageId < (chat?.length || 0); messageId++) {
        const shots = storageFor(chat[messageId])?.shots;
        if (!Array.isArray(shots)) continue;
        for (const persisted of shots) {
            if (!['queued', 'generating'].includes(persisted.status) || persisted.url) continue;
            const record = { ...structuredClone(persisted), messageId, chatId: String(getCurrentChatId?.() || ''), status: 'queued', error: '' };
            runtime.jobs.set(recordKey(record), record);
            enqueueRecord(record);
        }
    }
}

function settingsHtml() {
    return `
<div id="janima_autocg_settings" class="extension_container janima-autocg-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>JANIMA Galgame 自动CG</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="janima-autocg-settings-row">
        <span class="janima-autocg-connection" data-role="connection" data-state="unknown">尚未检测</span>
        <button type="button" class="menu_button" data-role="ping">检测 ComfyUI</button>
      </div>
      <label class="checkbox_label"><input type="checkbox" name="enabled">启用同回复自动CG</label>
      <label class="checkbox_label"><input type="checkbox" name="localFallback">模型漏写数据包时使用本地无二次LLM补图</label>
      <label>ComfyUI 地址<input class="text_pole" name="comfyUrl" type="url" autocomplete="off"></label>
      <label>单轮最多CG（建议 3）<input class="text_pole" name="maximumShots" type="number" min="1" max="4" step="1"></label>
      <details>
        <summary>速度与工作流（默认已为当前显卡优化）</summary>
        <label>宽度<input class="text_pole" name="profile.width" type="number" min="256" max="1536" step="64"></label>
        <label>高度<input class="text_pole" name="profile.height" type="number" min="256" max="1536" step="64"></label>
        <label>步数<input class="text_pole" name="profile.steps" type="number" min="1" max="30" step="1"></label>
        <label>CFG<input class="text_pole" name="profile.cfg" type="number" min="0.1" max="20" step="0.1"></label>
      </details>
      <small>正文只显示原位图片槽；无需世界书、智绘姬或生图正则。图片在后台队列生成，不锁住输入框。</small>
    </div>
  </div>
</div>`;
}

function pathGet(root, path) {
    return path.split('.').reduce((value, key) => value?.[key], root);
}

function pathSet(root, path, value) {
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
    if (event_types.STREAM_TOKEN_RECEIVED) eventSource.on(event_types.STREAM_TOKEN_RECEIVED, onStream);
    if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, (messageId, messageType) => void finalizeMessage(messageId, messageType));
    if (event_types.GENERATION_ENDED) eventSource.on(event_types.GENERATION_ENDED, () => {
        const id = latestAssistantId();
        if (id >= 0 && runtime.active && !runtime.active.finalized) void finalizeMessage(id);
    });
    if (event_types.GENERATION_STOPPED) eventSource.on(event_types.GENERATION_STOPPED, () => {
        const id = latestAssistantId();
        if (id >= 0 && runtime.active && !runtime.active.finalized) void finalizeMessage(id);
    });
    if (event_types.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, removeProtocolFromChatMessages);
    if (event_types.GENERATE_AFTER_COMBINE_PROMPTS) eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, removeProtocolFromTextPrompt);
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    [event_types.MESSAGE_UPDATED, event_types.MESSAGE_SWIPED, event_types.MORE_MESSAGES_LOADED]
        .filter(Boolean)
        .forEach(type => eventSource.on(type, () => scheduleRender(80)));
}

function observeChat() {
    if (runtime.observer) return;
    runtime.observer = new MutationObserver(mutations => {
        const meaningful = mutations.some(mutation => {
            const changed = [...mutation.addedNodes, ...mutation.removedNodes];
            return changed.some(node => !(node instanceof Element) || !node.matches('.janima-autocg-slot'));
        });
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
        render: renderAll,
        queueLength: () => runtime.queue.length + (runtime.running ? 1 : 0),
        state: () => ({
            active: runtime.active ? {
                id: runtime.active.id,
                chatId: runtime.active.chatId,
                messageId: runtime.active.messageId,
                finalized: runtime.active.finalized,
                records: runtime.active.records.length,
            } : null,
            queue: runtime.queue.length,
            running: runtime.running ? recordKey(runtime.running) : null,
            lastGenerationStartedAt: runtime.lastGenerationStartedAt,
            currentChatId: String(getCurrentChatId?.() || ''),
        }),
    });
    document.documentElement.dataset.janimaAutocgVersion = EXT_VERSION;
    console.info(`[${EXT_NAME}] v${EXT_VERSION} loaded; direct ComfyUI route=${settings().comfyUrl}; profile=${settings().profile.steps} steps`);
});
