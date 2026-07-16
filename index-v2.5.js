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
    extractNarrativeStory,
    seedForPacket,
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
    paragraphIndexForQuote,
    semanticBlocks,
    splitStoryParagraphs,
} from './lib/scene-anchor.mjs';
import {
    DEFAULT_GROUNDED_NEGATIVE,
    DEFAULT_GROUNDED_POSITIVE,
    adultPacketAllowed,
    buildLocalGroundedPackets,
    compileGroundedPrompt,
    desiredGroundedCount,
    mergeGroundedPackets,
    parseRichPackets,
    selectGroundedPackets,
} from './lib/scene-grounding.mjs';

const EXT_ID = 'codex_scene_image_director';
const EXT_NAME = 'JANIMA Galgame 自动CG';
const EXT_VERSION = '2.5.0';
const PROMPT_KEY = 'JANIMA_AUTO_CG_V5_DIRECTOR';
const SETTINGS_SELECTOR = '#janima_autocg_settings';
const STORAGE_KEY = 'janimaAutoCg';

const DEFAULT_SETTINGS = Object.freeze({
    schema: 60,
    enabled: true,
    automatic: true,
    localFallback: true,
    cleanLegacyPrompts: true,
    minimumShots: 3,
    maximumShots: 5,
    comfyUrl: 'http://192.168.1.12:8188',
    generationTimeoutMs: 240000,
    pollIntervalMs: 1000,
    resumeInterrupted: true,
    showSceneDetails: true,
    fixedPositive: DEFAULT_GROUNDED_POSITIVE,
    fixedNegative: DEFAULT_GROUNDED_NEGATIVE,
    profile: { ...DEFAULT_ANIMA_PROFILE },
});

const runtime = {
    pending: null,
    queue: [],
    running: null,
    jobs: new Map(),
    processing: new Set(),
    renderTimer: null,
    observer: null,
    initialized: false,
    connection: { state: 'unknown', message: '尚未检测' },
};

function mergeKnown(base, incoming) {
    const result = structuredClone(base);
    for (const [key, value] of Object.entries(incoming || {})) {
        if (!(key in result)) continue;
        result[key] = value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object'
            ? mergeKnown(result[key], value)
            : value;
    }
    return result;
}

function settings() {
    const existing = extension_settings[EXT_ID] || {};
    const next = mergeKnown(DEFAULT_SETTINGS, existing);
    next.schema = DEFAULT_SETTINGS.schema;
    next.minimumShots = Math.max(3, Math.min(5, Number(next.minimumShots) || 3));
    next.maximumShots = Math.max(next.minimumShots, Math.min(5, Number(next.maximumShots) || 5));
    next.generationTimeoutMs = Math.max(30000, Number(next.generationTimeoutMs) || 240000);
    next.pollIntervalMs = Math.max(300, Number(next.pollIntervalMs) || 1000);
    extension_settings[EXT_ID] = next;
    if (Number(existing.schema) !== DEFAULT_SETTINGS.schema) saveSettingsDebounced?.();
    return next;
}

function toast(level, message) {
    if (globalThis.toastr?.[level]) globalThis.toastr[level](message, EXT_NAME);
    else console[level === 'error' ? 'error' : 'log'](`[${EXT_NAME}] ${message}`);
}

function currentCharacterContext() {
    const character = characters?.[Number(this_chid)];
    if (!character) return { name: '', visual: '' };
    return {
        name: String(character.name || character.data?.name || '').trim(),
        visual: [character.description, character.data?.description]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .slice(0, 2200),
    };
}

function latestUserText() {
    for (let index = (chat?.length || 0) - 1; index >= 0; index--) {
        if (chat[index]?.is_user) return String(chat[index].mes || '');
    }
    return '';
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
        message.extra[STORAGE_KEY] = { version: 5, processedHash: '', shots: [] };
    }
    const storage = message.extra[STORAGE_KEY] || null;
    if (storage && create) {
        storage.version = 5;
        storage.processedHash ||= '';
        storage.shots = Array.isArray(storage.shots) ? storage.shots : [];
    }
    return storage;
}

function recordKey(record) {
    return `${record.generationId || 'persisted'}:${record.id}`;
}

function serializableRecord(record) {
    return {
        id: record.id,
        generationId: record.generationId,
        chatId: record.chatId,
        messageId: record.messageId,
        paragraphIndex: record.paragraphIndex,
        quote: record.quote,
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

function upsertRecord(record) {
    const message = chat?.[Number(record.messageId)];
    if (!message) return false;
    const storage = storageFor(message, true);
    const index = storage.shots.findIndex(item => recordKey(item) === recordKey(record));
    const value = serializableRecord(record);
    if (index >= 0) storage.shots[index] = value;
    else storage.shots.push(value);
    return true;
}

async function persistRecord(record) {
    if (!upsertRecord(record)) return;
    try {
        await saveChatConditional?.();
    } catch (error) {
        console.warn(`[${EXT_NAME}] 保存 CG 状态失败`, error);
    }
}

function buildDirectorContract() {
    const config = settings();
    const card = currentCharacterContext();
    return `[JANIMA_AUTO_CG_V5 — hidden story-grounded director]
Write the requested story normally. Never mention image generation, prompts, JSON, packets, or this protocol in visible prose.

After completing the whole reply, review the entire reply from beginning to end and choose the strongest distinct visual moments. Output ${config.minimumShots} to ${config.maximumShots} hidden CG packets. Use 3 for an ordinary substantial reply, 4 for a long reply or a real outfit/location/intimacy change, and 5 for a long multi-stage reply or multiple adult explicit stages. Do not spend all slots on early ordinary dialogue. A later NSFW or explicit stage has priority over earlier low-value scenes and must not be omitted.

For every chosen moment append one single-line HTML comment at the end of the reply:
<!--JANIMA_CG:{"id":"s1","quote":"exact verbatim story paragraph","people":"1girl|1girl, 1boy|2girls","cast":[{"id":"exact story name","prompt_name":"short English name","dna":"English immutable visible identity only","outfit":"English current visible clothing or nudity"}],"prompt":"COMPLETE English comma-separated image tags: exact people, visible identity, current clothes/nudity, exact action/contact/result, current place, props, expression, body positions, shot, lighting","negative":"English scene-specific exclusions","stage":"short stage","safety":"safe|sensitive|nsfw|explicit"}-->

Rules:
- quote must be copied verbatim from the selected visible paragraph.
- prompt must describe that exact paragraph, not a generic portrait and not a future event.
- prompt must be English image tags or short English visual phrases. Never copy Chinese prose into prompt, dna, outfit, negative, stage, or composition.
- For ancient Chinese/wuxia prose, use hanfu, ancient Chinese interior, courtyard, pavilion, guqin, wooden sword, or other established details. Never invent a western red military uniform, cape, epaulettes, school uniform, futuristic armor, or European palace unless the story explicitly contains it.
- Every image must show a woman actually present in that story window. Do not choose scenery-only or male-only paragraphs.
- Preserve all distinct adult NSFW stages that truly occur: undressing, intimate touching, oral/manual action, penetration, position change, climax, aftercare. Only clearly adult participants may appear.
- Use the active character card only when its exact character name appears in the selected paragraph or cast. Active card name: ${card.name || '(none)'}. Do not force its appearance onto other named story characters.
- End with <!--JANIMA_CG_END:{"count":N}--> and nothing after it.`;
}

function refreshDirectorPrompt() {
    const config = settings();
    if (!config.enabled || !config.automatic) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
        document.documentElement.dataset.janimaAutocgEnabled = 'false';
        return;
    }
    setExtensionPrompt(PROMPT_KEY, buildDirectorContract(), extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
    document.documentElement.dataset.janimaAutocgEnabled = 'true';
}

function beginGeneration(type, options = {}, dryRun = false) {
    if (dryRun || !settings().enabled || !settings().automatic) return;
    if (type === 'quiet' || type === 'impersonate' || options?.quiet_prompt || options?.quietImage) return;
    runtime.pending = {
        chatId: String(getCurrentChatId?.() || ''),
        startedAt: Date.now(),
    };
    refreshDirectorPrompt();
}

function cleanStory(raw = '') {
    const narrative = extractNarrativeStory(raw);
    return settings().cleanLegacyPrompts ? stripLegacyImagePromptLines(narrative) : narrative;
}

function canProcess(messageId, messageType, raw, force) {
    if (force || /<!--\s*JANIMA_CG\s*:/i.test(raw)) return true;
    if (Number(messageId) !== latestAssistantId()) return false;
    if (['first_message', 'extension', 'command'].includes(String(messageType || '').toLowerCase())) return false;
    return runtime.pending?.chatId === String(getCurrentChatId?.() || '')
        && Date.now() - runtime.pending.startedAt < 180000;
}

function clearLiveMessageRecords(messageId) {
    const id = Number(messageId);
    runtime.queue = runtime.queue.filter(record => Number(record.messageId) !== id);
    for (const [key, record] of runtime.jobs.entries()) {
        if (Number(record.messageId) !== id) continue;
        record.cancelRequested = true;
        record.controller?.abort('message-reprocessed');
        runtime.jobs.delete(key);
    }
}

async function processAssistantMessage(messageId, { messageType = '', force = false } = {}) {
    const id = Number(messageId);
    if (!settings().enabled || !Number.isInteger(id) || id < 0 || !isAssistantMessage(id)) return;
    if (runtime.processing.has(id)) return;
    const raw = String(chat[id]?.mes || '');
    if (!canProcess(id, messageType, raw, force)) {
        scheduleRender();
        return;
    }

    runtime.processing.add(id);
    try {
        const story = cleanStory(raw);
        if (!splitStoryParagraphs(story).length) return;
        const storyHash = String(stableHash(story));
        const storage = storageFor(chat[id], true);
        if (!force && storage.processedHash === storyHash) {
            scheduleRender();
            return;
        }

        clearLiveMessageRecords(id);
        storage.processedHash = storyHash;
        storage.shots = [];

        const config = settings();
        const parsed = parseRichPackets(raw);
        if (parsed.errors.length) console.warn(`[${EXT_NAME}] 隐藏分镜格式错误`, parsed.errors);
        const localPackets = config.localFallback
            ? buildLocalGroundedPackets(story, { maximum: config.maximumShots })
            : [];
        const merged = mergeGroundedPackets(parsed.packets, localPackets);
        const selected = selectGroundedPackets(merged, story, {
            minimum: config.minimumShots,
            maximum: config.maximumShots,
        });
        const desired = desiredGroundedCount(story, {
            minimum: config.minimumShots,
            maximum: config.maximumShots,
        });

        const card = currentCharacterContext();
        const adultContext = `${latestUserText()} ${story} ${card.visual}`;
        const generationId = `msg-${id}-${storyHash}`;
        const records = [];
        for (const packet of selected) {
            if (!adultPacketAllowed(packet, adultContext)) {
                console.warn(`[${EXT_NAME}] 已跳过包含未成年证据的成人分镜`, packet.id);
                continue;
            }
            const compiled = compileGroundedPrompt(packet, {
                fixedPositive: config.fixedPositive,
                fixedNegative: config.fixedNegative,
                card,
            });
            const record = {
                id: packet.id,
                generationId,
                chatId: String(getCurrentChatId?.() || ''),
                messageId: id,
                paragraphIndex: paragraphIndexForQuote(story, packet.quote),
                quote: packet.quote,
                packet,
                prompt: compiled.positive,
                negative: compiled.negative,
                seed: seedForPacket(packet),
                retry: 0,
                status: 'queued',
                promptId: '',
                url: '',
                image: null,
                error: '',
                createdAt: Date.now(),
                completedAt: 0,
            };
            records.push(record);
            runtime.jobs.set(recordKey(record), record);
            upsertRecord(record);
        }

        const visible = settings().cleanLegacyPrompts
            ? stripLegacyImagePromptLines(stripProtocol(raw))
            : stripProtocol(raw);
        if (visible !== chat[id].mes) {
            chat[id].mes = visible;
            if (Array.isArray(chat[id].swipes) && Number.isInteger(chat[id].swipe_id)) {
                chat[id].swipes[chat[id].swipe_id] = visible;
            }
            updateMessageBlock(id, chat[id]);
        }

        await saveChatConditional?.();
        for (const record of records) enqueueRecord(record);
        runtime.pending = null;
        refreshDirectorPrompt();
        scheduleRender(20);
        console.info(`[${EXT_NAME}] message=${id}, desired=${desired}, model=${parsed.packets.length}, local=${localPackets.length}, queued=${records.length}`);
    } catch (error) {
        console.error(`[${EXT_NAME}] 自动分镜失败`, error);
        toast('error', `自动分镜失败：${error?.message || error}`);
    } finally {
        runtime.processing.delete(id);
    }
}

function recordsForMessage(messageId) {
    const map = new Map();
    for (const record of storageFor(chat?.[Number(messageId)])?.shots || []) map.set(recordKey(record), record);
    for (const record of runtime.jobs.values()) {
        if (Number(record.messageId) === Number(messageId)) map.set(recordKey(record), record);
    }
    return [...map.values()].sort((a, b) => Number(a.paragraphIndex ?? 9999) - Number(b.paragraphIndex ?? 9999)
        || Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

function actionButton(label, action, title = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'janima-autocg-action menu_button';
    button.dataset.action = action;
    button.textContent = label;
    if (title) button.title = title;
    return button;
}

function sceneDetails(record) {
    if (!settings().showSceneDetails) return null;
    const details = document.createElement('details');
    details.className = 'janima-autocg-details';
    const summary = document.createElement('summary');
    summary.textContent = '查看取材剧情与实际提示词';
    const quote = document.createElement('div');
    quote.className = 'janima-autocg-quote';
    quote.textContent = `取材：${record.quote || record.packet?.quote || '无'}`;
    const prompt = document.createElement('code');
    prompt.className = 'janima-autocg-prompt';
    prompt.textContent = record.prompt || '';
    details.append(summary, quote, prompt);
    return details;
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
        image.loading = 'lazy';
        image.decoding = 'async';
        image.alt = '剧情自动CG';
        slot.append(image);
    } else {
        const status = document.createElement('div');
        status.className = 'janima-autocg-status';
        const spinner = document.createElement('span');
        spinner.className = 'janima-autocg-spinner';
        if (!['queued', 'submitting', 'generating'].includes(record.status)) spinner.hidden = true;
        const body = document.createElement('span');
        body.className = 'janima-autocg-status-body';
        const scene = String(record.quote || '').replace(/\s+/g, ' ').slice(0, 54);
        body.textContent = record.status === 'error'
            ? `生成失败：${record.error || '未知错误'}`
            : record.status === 'generating'
                ? `正在绘制：${scene}${scene.length >= 54 ? '…' : ''}`
                : record.status === 'submitting'
                    ? `正在提交：${scene}${scene.length >= 54 ? '…' : ''}`
                    : `排队中：${scene}${scene.length >= 54 ? '…' : ''}`;
        status.append(spinner, body);
        slot.append(status);
    }

    const details = sceneDetails(record);
    if (details) slot.append(details);
    const controls = document.createElement('div');
    controls.className = 'janima-autocg-controls';
    if (['done', 'error', 'cancelled'].includes(record.status)) controls.append(actionButton('重绘', 'reroll'));
    if (['queued', 'submitting', 'generating'].includes(record.status)) controls.append(actionButton('停止', 'cancel'));
    if (controls.childElementCount) slot.append(controls);
    return slot;
}

function renderMessage(messageId) {
    const host = messageHost(messageId);
    const root = host?.querySelector('.mes_text');
    if (!root) return;
    root.querySelectorAll('.janima-autocg-slot').forEach(node => node.remove());
    const blocks = semanticBlocks(root);
    const lastByParagraph = new Map();
    for (const record of recordsForMessage(messageId)) {
        const slot = buildSlot(record);
        if (!blocks.length) {
            root.append(slot);
            continue;
        }
        const index = clampParagraphIndex(record.paragraphIndex, blocks.length);
        const anchor = lastByParagraph.get(index) || blocks[index];
        anchor.insertAdjacentElement('afterend', slot);
        lastByParagraph.set(index, slot);
    }
}

function renderAll() {
    document.querySelectorAll('#chat .mes[mesid], #chat .mes[data-mes-id]').forEach(host => {
        const id = Number(host.getAttribute('mesid') ?? host.dataset.mesId);
        if (isAssistantMessage(id)) renderMessage(id);
    });
}

function scheduleRender(delay = 50) {
    clearTimeout(runtime.renderTimer);
    runtime.renderTimer = setTimeout(renderAll, delay);
}

function updateConnectionUi() {
    const node = document.querySelector(`${SETTINGS_SELECTOR} [data-role="connection"]`);
    if (!node) return;
    node.dataset.state = runtime.connection.state;
    node.textContent = runtime.connection.message;
}

function friendlyError(error) {
    const text = String(error?.message || error || '未知错误');
    if (/Failed to fetch|NetworkError|Load failed/i.test(text)) {
        return '无法直连 ComfyUI。确认使用电脑局域网 IP，并启用 --listen 0.0.0.0 与 --enable-cors-header *。';
    }
    return text;
}

async function pingComfy({ notify = false } = {}) {
    runtime.connection = { state: 'checking', message: '正在连接…' };
    updateConnectionUi();
    try {
        const result = await pingComfyNative(settings().comfyUrl, { timeoutMs: 7000 });
        runtime.connection = { state: 'ok', message: `已连接（${result.endpoint}）` };
        if (notify) toast('success', `已连接 ${normalizeComfyUrl(settings().comfyUrl)}`);
        return true;
    } catch (error) {
        runtime.connection = { state: 'error', message: '连接失败' };
        if (notify) toast('error', friendlyError(error));
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
    upsertRecord(record);
    scheduleRender();
    void pumpQueue();
}

async function generateRecord(record) {
    const config = settings();
    record.controller = new AbortController();
    try {
        record.status = record.promptId ? 'generating' : 'submitting';
        upsertRecord(record);
        scheduleRender();
        if (!record.promptId) {
            const workflow = buildAnimaWorkflow({
                positive: record.prompt,
                negative: record.negative,
                seed: record.seed,
                profile: config.profile,
            });
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
            timeoutMs: config.generationTimeoutMs,
            pollIntervalMs: config.pollIntervalMs,
            requestTimeoutMs: 12000,
        });
        record.image = result.images.at(-1);
        record.url = buildComfyViewUrl(config.comfyUrl, record.image);
        record.status = 'done';
        record.error = '';
        record.completedAt = Date.now();
        runtime.connection = { state: 'ok', message: 'ComfyUI 已连接' };
    } catch (error) {
        record.status = record.cancelRequested ? 'cancelled' : 'error';
        record.error = record.cancelRequested ? '' : friendlyError(error).slice(0, 1000);
        runtime.connection = { state: 'error', message: '生成失败' };
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
    try {
        await generateRecord(record);
    } finally {
        runtime.running = null;
        if (runtime.queue.length) setTimeout(() => void pumpQueue(), 30);
    }
}

function recordFromButton(target) {
    const slot = target.closest('.janima-autocg-slot');
    if (!slot) return null;
    const key = `${slot.dataset.generationId || 'persisted'}:${slot.dataset.shotId}`;
    const live = runtime.jobs.get(key);
    if (live) return live;
    const host = target.closest('.mes');
    const messageId = Number(host?.getAttribute('mesid') ?? host?.dataset?.mesId);
    const persisted = recordsForMessage(messageId).find(record => recordKey(record) === key);
    if (!persisted) return null;
    const record = { ...structuredClone(persisted), messageId, chatId: String(getCurrentChatId?.() || '') };
    runtime.jobs.set(key, record);
    return record;
}

function bindSlotActions() {
    document.addEventListener('click', event => {
        const target = event.target.closest?.('.janima-autocg-action');
        if (!target) return;
        const record = recordFromButton(target);
        if (!record) return;
        if (target.dataset.action === 'cancel') {
            runtime.queue = runtime.queue.filter(item => recordKey(item) !== recordKey(record));
            record.cancelRequested = true;
            record.controller?.abort('cancelled');
            record.status = 'cancelled';
            void persistRecord(record);
            scheduleRender();
        }
        if (target.dataset.action === 'reroll') {
            record.retry = Number(record.retry || 0) + 1;
            record.seed = seedForPacket(record.packet, record.retry);
            record.promptId = '';
            record.url = '';
            record.image = null;
            record.error = '';
            record.completedAt = 0;
            enqueueRecord(record);
        }
    });
}

function resumeInterruptedJobs() {
    if (!settings().resumeInterrupted) return;
    for (let messageId = Math.max(0, (chat?.length || 0) - 20); messageId < (chat?.length || 0); messageId++) {
        for (const persisted of storageFor(chat[messageId])?.shots || []) {
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

function settingsHtml() {
    return `<div id="janima_autocg_settings" class="extension_container janima-autocg-settings"><div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header"><b>JANIMA Galgame 自动CG v${EXT_VERSION}</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
      <div class="inline-drawer-content">
        <div class="janima-autocg-settings-row"><span class="janima-autocg-connection" data-role="connection">尚未检测</span><button type="button" class="menu_button" data-role="ping">检测 ComfyUI</button></div>
        <label class="checkbox_label"><input type="checkbox" name="enabled">启用自动CG</label>
        <label class="checkbox_label"><input type="checkbox" name="localFallback">同时使用本地剧情分镜补漏</label>
        <label class="checkbox_label"><input type="checkbox" name="showSceneDetails">显示每张图的取材剧情和实际提示词</label>
        <label>ComfyUI 地址<input class="text_pole" name="comfyUrl" type="url"></label>
        <div class="janima-autocg-settings-row"><label>最少CG<input class="text_pole" name="minimumShots" type="number" min="3" max="5"></label><label>最多CG<input class="text_pole" name="maximumShots" type="number" min="3" max="5"></label></div>
        <label>固定正面提示词<textarea class="text_pole" name="fixedPositive" rows="4"></textarea></label>
        <label>固定负面提示词<textarea class="text_pole" name="fixedNegative" rows="5"></textarea></label>
        <details><summary>模型与工作流</summary>
          <label>UNet<input class="text_pole" name="profile.model"></label>
          <label>CLIP<input class="text_pole" name="profile.clip"></label>
          <label>VAE<input class="text_pole" name="profile.vae"></label>
          <label>LoRA<input class="text_pole" name="profile.lora"></label>
          <label>宽度<input class="text_pole" name="profile.width" type="number" min="256" max="1536" step="64"></label>
          <label>高度<input class="text_pole" name="profile.height" type="number" min="256" max="1536" step="64"></label>
          <label>步数<input class="text_pole" name="profile.steps" type="number" min="1" max="30"></label>
          <label>CFG<input class="text_pole" name="profile.cfg" type="number" min="0.1" max="20" step="0.1"></label>
        </details>
        <small>v2.5 不再把当前角色卡外貌强塞给其他剧情人物。每张图都可展开查看“取材剧情”和真正提交给 ComfyUI 的 Prompt。</small>
      </div>
    </div></div>`;
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
        settings();
        saveSettingsDebounced?.();
        refreshDirectorPrompt();
        scheduleRender();
    });
    root.querySelector('[data-role="ping"]')?.addEventListener('click', () => void pingComfy({ notify: true }));
}

function stripProtocolFromChatPrompt(eventData = {}) {
    if (!Array.isArray(eventData.chat)) return;
    for (const message of eventData.chat) {
        if (typeof message?.content === 'string') message.content = stripProtocol(message.content);
    }
}

function bindEvents() {
    const startEvent = event_types.GENERATION_STARTED || event_types.GENERATION_AFTER_COMMANDS;
    if (startEvent) eventSource.on(startEvent, beginGeneration);
    if (event_types.MESSAGE_RECEIVED) {
        eventSource.on(event_types.MESSAGE_RECEIVED, (messageId, messageType) => {
            setTimeout(() => void processAssistantMessage(messageId, { messageType }), 60);
        });
    }
    if (event_types.GENERATION_ENDED) {
        eventSource.on(event_types.GENERATION_ENDED, () => {
            const id = latestAssistantId();
            if (id >= 0) setTimeout(() => void processAssistantMessage(id), 80);
        });
    }
    if (event_types.GENERATION_STOPPED) {
        eventSource.on(event_types.GENERATION_STOPPED, () => {
            const id = latestAssistantId();
            if (id >= 0) setTimeout(() => void processAssistantMessage(id), 80);
        });
    }
    if (event_types.MESSAGE_SWIPED) {
        eventSource.on(event_types.MESSAGE_SWIPED, messageId => {
            setTimeout(() => void processAssistantMessage(messageId, { force: true }), 100);
        });
    }
    if (event_types.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, stripProtocolFromChatPrompt);
    if (event_types.GENERATE_AFTER_COMBINE_PROMPTS) {
        eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, eventData => {
            if (typeof eventData.prompt === 'string') eventData.prompt = stripProtocol(eventData.prompt);
        });
    }
    if (event_types.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            runtime.pending = null;
            refreshDirectorPrompt();
            setTimeout(() => {
                resumeInterruptedJobs();
                renderAll();
            }, 180);
        });
    }
    [event_types.MESSAGE_UPDATED, event_types.MORE_MESSAGES_LOADED]
        .filter(Boolean)
        .forEach(type => eventSource.on(type, () => scheduleRender(80)));
}

function observeChat() {
    if (runtime.observer) return;
    runtime.observer = new MutationObserver(mutations => {
        const meaningful = mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes]
            .some(node => !(node instanceof Element) || !node.matches('.janima-autocg-slot')));
        if (meaningful) scheduleRender(80);
    });
    runtime.observer.observe(document.querySelector('#chat') || document.body, { childList: true, subtree: true });
}

jQuery(() => {
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
        inspectLatest: () => {
            const id = latestAssistantId();
            return id >= 0 ? recordsForMessage(id).map(record => ({
                quote: record.quote,
                prompt: record.prompt,
                negative: record.negative,
                status: record.status,
                paragraphIndex: record.paragraphIndex,
            })) : [];
        },
        state: () => ({
            queue: runtime.queue.length,
            running: runtime.running ? recordKey(runtime.running) : null,
            currentChatId: String(getCurrentChatId?.() || ''),
            settings: settings(),
        }),
    });
    document.documentElement.dataset.janimaAutocgVersion = EXT_VERSION;
    console.info(`[${EXT_NAME}] v${EXT_VERSION} loaded; grounded scene mode`);
});
