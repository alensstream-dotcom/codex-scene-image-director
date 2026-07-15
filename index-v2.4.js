import {
    chat, characters, eventSource, event_types,
    extension_prompt_roles, extension_prompt_types,
    getCurrentChatId, saveChatConditional, saveSettingsDebounced,
    setExtensionPrompt, this_chid, updateMessageBlock,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import {
    buildDirectorContract, buildFallbackPackets, compilePrompt, createBible,
    extractNarrativeStory, hasFemale, mergePacketIntoBible, parseCgPackets,
    seedForPacket, serializeBible, stableHash, stripLegacyImagePromptLines, stripProtocol,
} from './lib/director-core.mjs';
import { buildAnimaWorkflow, DEFAULT_ANIMA_PROFILE } from './lib/anima-direct-workflow.mjs';
import { buildComfyViewUrl, normalizeComfyUrl, pingComfyNative, submitComfyPrompt, waitForComfyResult } from './lib/comfy-direct.mjs';
import { clampParagraphIndex, paragraphIndexForQuote, semanticBlocks, splitStoryParagraphs } from './lib/scene-anchor.mjs';
import {
    DEFAULT_FIXED_NEGATIVE, DEFAULT_FIXED_POSITIVE, adultSceneAllowed,
    cleanCompiledPrompt, desiredShotCount, selectPacketsAdaptive,
} from './lib/scene-policy.mjs';

const EXT_ID = 'codex_scene_image_director';
const EXT_NAME = 'JANIMA Galgame 自动CG';
const EXT_VERSION = '2.4.0';
const SETTINGS_SELECTOR = '#janima_autocg_settings';
const PROMPT_KEY = 'JANIMA_AUTO_CG_V4_DIRECTOR';
const STORAGE_KEY = 'janimaAutoCg';

const DEFAULT_SETTINGS = Object.freeze({
    schema: 50,
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
    fixedPositive: DEFAULT_FIXED_POSITIVE,
    fixedNegative: DEFAULT_FIXED_NEGATIVE,
    profile: { ...DEFAULT_ANIMA_PROFILE },
});

const runtime = {
    pending: null, queue: [], running: null, jobs: new Map(),
    renderTimer: null, connection: { state: 'unknown', message: '尚未检测' },
    observer: null, processing: new Set(), initialized: false,
};

function mergeKnown(base, incoming) {
    const result = structuredClone(base);
    for (const [key, value] of Object.entries(incoming || {})) {
        if (!(key in result)) continue;
        result[key] = value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object'
            ? mergeKnown(result[key], value) : value;
    }
    return result;
}

function settings() {
    const existing = extension_settings[EXT_ID] || {};
    const next = mergeKnown(DEFAULT_SETTINGS, existing);
    next.schema = DEFAULT_SETTINGS.schema;
    next.minimumShots = Math.max(3, Math.min(5, Number(next.minimumShots) || 3));
    next.maximumShots = Math.max(next.minimumShots, Math.min(5, Number(next.maximumShots) || 5));
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
        visual: [character.description, character.data?.description].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 2200),
    };
}

function latestUserText() {
    for (let i = (chat?.length || 0) - 1; i >= 0; i--) if (chat[i]?.is_user) return String(chat[i].mes || '');
    return '';
}

function isAssistantMessage(id) {
    const message = chat?.[Number(id)];
    return Boolean(message && !message.is_user && !message.is_system);
}

function latestAssistantId() {
    for (let i = (chat?.length || 0) - 1; i >= 0; i--) if (isAssistantMessage(i)) return i;
    return -1;
}

function messageHost(id) {
    return document.querySelector(`#chat .mes[mesid="${Number(id)}"]`)
        || document.querySelector(`#chat .mes[data-mes-id="${Number(id)}"]`);
}

function storageFor(message, create = false) {
    if (!message) return null;
    if (!message.extra && create) message.extra = {};
    if (!message.extra) return null;
    if (!message.extra[STORAGE_KEY] && create) message.extra[STORAGE_KEY] = { version: 4, processedHash: '', shots: [] };
    const storage = message.extra[STORAGE_KEY];
    if (storage && create) {
        storage.version = 4;
        storage.processedHash ||= '';
        storage.shots = Array.isArray(storage.shots) ? storage.shots : [];
    }
    return storage || null;
}

function recordKey(record) { return `${record.generationId || 'persisted'}:${record.id}`; }
function serializeRecord(record) {
    return {
        id: record.id, generationId: record.generationId, chatId: record.chatId,
        messageId: record.messageId, paragraphIndex: record.paragraphIndex,
        packet: record.packet, prompt: record.prompt, negative: record.negative,
        seed: record.seed, retry: record.retry || 0, status: record.status,
        promptId: record.promptId || '', url: record.url || '', image: record.image || null,
        error: record.error || '', createdAt: record.createdAt, completedAt: record.completedAt || 0,
    };
}

function upsertRecord(record) {
    const message = chat?.[Number(record.messageId)];
    if (!message) return;
    const storage = storageFor(message, true);
    const index = storage.shots.findIndex(item => recordKey(item) === recordKey(record));
    const value = serializeRecord(record);
    if (index >= 0) storage.shots[index] = value; else storage.shots.push(value);
}

async function persistRecord(record) {
    upsertRecord(record);
    try { await saveChatConditional?.(); } catch (error) { console.warn(`[${EXT_NAME}] 保存失败`, error); }
}

function recentRecords(limit = 40) {
    const result = [];
    for (let i = (chat?.length || 0) - 1; i >= 0 && result.length < limit; i--) {
        const shots = storageFor(chat[i])?.shots || [];
        for (let j = shots.length - 1; j >= 0 && result.length < limit; j--) if (shots[j]?.packet) result.push(shots[j]);
    }
    return result.reverse();
}

function currentBible() {
    const bible = createBible();
    for (const record of recentRecords()) mergePacketIntoBible(bible, record.packet);
    return bible;
}

function directorContract() {
    const config = settings();
    const character = currentCharacterContext();
    const base = buildDirectorContract({
        bibleText: serializeBible(currentBible()),
        characterContext: `${character.name ? `Name=${character.name}. ` : ''}${character.visual}`,
        maximumShots: config.maximumShots,
    });
    return `${base}\n\n[OVERRIDE — JANIMA v2.4]\nCreate 3 to 5 CG packets according to the actual number of distinct visual beats. Ordinary substantial replies need at least 3. Use 4 for long replies, outfit/location changes, or intimacy progression; use 5 for long multi-stage replies or multiple explicit stages. Never fill the quota with weak static portraits. NSFW/explicit beats have priority over ordinary conversation and must never be skipped when they occur later. Each packet field other than quote and cast id must be concise English image tags or concise English visual descriptions. The quote remains the exact visible source paragraph. Do not put Chinese prose into action, setting, expression, composition, dna, or outfit.`;
}

function refreshDirectorPrompt() {
    const config = settings();
    if (!config.enabled || !config.automatic) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
        document.documentElement.dataset.janimaAutocgEnabled = 'false';
        return;
    }
    setExtensionPrompt(PROMPT_KEY, directorContract(), extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
    document.documentElement.dataset.janimaAutocgEnabled = 'true';
}

function beginGeneration(type, options = {}, dryRun = false) {
    if (dryRun || !settings().enabled || !settings().automatic || type === 'quiet' || type === 'impersonate' || options?.quiet_prompt) return;
    runtime.pending = { chatId: String(getCurrentChatId?.() || ''), startedAt: Date.now() };
    refreshDirectorPrompt();
}

function cleanedStory(raw) {
    const prose = extractNarrativeStory(raw);
    return settings().cleanLegacyPrompts ? stripLegacyImagePromptLines(prose) : prose;
}

function localCharacterEvidence(story) {
    const card = currentCharacterContext();
    const evidence = `${latestUserText()} ${story} ${card.visual}`;
    const female = hasFemale(evidence);
    return {
        name: female ? card.name : '',
        visual: female ? card.visual : '',
        evidence,
    };
}

function mergePacketSources(modelPackets, fallbackPackets) {
    const result = [];
    const seen = new Set();
    for (const packet of [...modelPackets, ...fallbackPackets]) {
        const key = stableHash(`${packet.quote}|${packet.action}|${packet.stage}`);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(packet);
    }
    return result;
}

function canProcess(id, messageType, raw, force) {
    if (force || /<!--\s*JANIMA_CG/i.test(raw)) return true;
    if (id !== latestAssistantId()) return false;
    if (['first_message', 'extension', 'command'].includes(String(messageType || '').toLowerCase())) return false;
    return runtime.pending?.chatId === String(getCurrentChatId?.() || '') && Date.now() - runtime.pending.startedAt < 180000;
}

async function processMessage(messageId, { messageType = '', force = false } = {}) {
    const id = Number(messageId);
    if (!Number.isInteger(id) || id < 0 || !isAssistantMessage(id) || runtime.processing.has(id)) return;
    const raw = String(chat[id]?.mes || '');
    if (!canProcess(id, messageType, raw, force)) return scheduleRender();
    runtime.processing.add(id);
    try {
        const story = cleanedStory(raw);
        if (!splitStoryParagraphs(story).length) return;
        const hash = String(stableHash(story));
        const storage = storageFor(chat[id], true);
        if (!force && storage.processedHash === hash) return scheduleRender();
        storage.processedHash = hash;
        storage.shots = [];

        const config = settings();
        const bible = currentBible();
        const parsed = parseCgPackets(raw);
        const character = localCharacterEvidence(story);
        const desired = desiredShotCount(story, { minimum: config.minimumShots, maximum: config.maximumShots });
        const fallback = config.localFallback ? buildFallbackPackets(story, {
            bible, characterName: character.name, characterVisual: character.visual, maximum: config.maximumShots,
        }) : [];
        const packets = selectPacketsAdaptive(mergePacketSources(parsed.packets, fallback), story, config.maximumShots).slice(0, desired);

        const generationId = `msg-${id}-${hash}`;
        const records = [];
        for (const packet of packets) {
            if (!hasFemale(packet) || !adultSceneAllowed(packet, character.evidence)) continue;
            mergePacketIntoBible(bible, packet);
            const rawCompiled = compilePrompt(packet, bible, packet.cast?.some(cast => cast.dna) ? '' : cardVisual(character));
            const compiled = cleanCompiledPrompt(rawCompiled, packet, {
                fixedPositive: config.fixedPositive,
                fixedNegative: config.fixedNegative,
            });
            const record = {
                id: packet.id, generationId, chatId: String(getCurrentChatId?.() || ''), messageId: id,
                paragraphIndex: paragraphIndexForQuote(story, packet.quote), packet: compiled.packet,
                prompt: compiled.positive, negative: compiled.negative, seed: seedForPacket(compiled.packet),
                retry: 0, status: 'queued', promptId: '', url: '', image: null, error: '',
                createdAt: Date.now(), completedAt: 0,
            };
            records.push(record);
            runtime.jobs.set(recordKey(record), record);
            upsertRecord(record);
        }

        const visible = settings().cleanLegacyPrompts ? stripLegacyImagePromptLines(stripProtocol(raw)) : stripProtocol(raw);
        if (visible !== chat[id].mes) {
            chat[id].mes = visible;
            if (Array.isArray(chat[id].swipes) && Number.isInteger(chat[id].swipe_id)) chat[id].swipes[chat[id].swipe_id] = visible;
            updateMessageBlock(id, chat[id]);
        }
        await saveChatConditional?.();
        for (const record of records) enqueue(record);
        runtime.pending = null;
        refreshDirectorPrompt();
        scheduleRender(20);
        console.info(`[${EXT_NAME}] message=${id}, desired=${desired}, queued=${records.length}`);
    } catch (error) {
        console.error(`[${EXT_NAME}] 分镜失败`, error);
        toast('error', `自动分镜失败：${error?.message || error}`);
    } finally {
        runtime.processing.delete(id);
    }
}

function cardVisual(character) { return character.visual || currentCharacterContext().visual; }

function recordsForMessage(id) {
    const map = new Map();
    for (const item of storageFor(chat?.[Number(id)])?.shots || []) map.set(recordKey(item), item);
    for (const item of runtime.jobs.values()) if (Number(item.messageId) === Number(id)) map.set(recordKey(item), item);
    return [...map.values()].sort((a, b) => Number(a.paragraphIndex ?? 999) - Number(b.paragraphIndex ?? 999));
}

function actionButton(label, action) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'janima-autocg-action menu_button';
    button.dataset.action = action; button.textContent = label; return button;
}

function buildSlot(record) {
    const slot = document.createElement('section');
    slot.className = `janima-autocg-slot is-${record.status || 'queued'}`;
    slot.dataset.shotId = record.id; slot.dataset.generationId = record.generationId || '';
    if (record.status === 'done' && record.url) {
        const image = document.createElement('img');
        image.className = 'janima-autocg-image'; image.src = record.url; image.loading = 'lazy'; image.alt = '剧情自动CG';
        slot.append(image);
    } else {
        const status = document.createElement('div'); status.className = 'janima-autocg-status';
        const spinner = document.createElement('span'); spinner.className = 'janima-autocg-spinner';
        if (!['queued', 'submitting', 'generating'].includes(record.status)) spinner.hidden = true;
        const body = document.createElement('span'); body.className = 'janima-autocg-status-body';
        body.textContent = record.status === 'error' ? `生成失败：${record.error || '未知错误'}`
            : record.status === 'generating' ? 'ComfyUI 正在绘制这一幕…'
                : record.status === 'submitting' ? '正在提交这一幕…' : '这一幕已进入队列…';
        status.append(spinner, body); slot.append(status);
    }
    const controls = document.createElement('div'); controls.className = 'janima-autocg-controls';
    if (['done', 'error', 'cancelled'].includes(record.status)) controls.append(actionButton('重绘', 'reroll'));
    if (['queued', 'submitting', 'generating'].includes(record.status)) controls.append(actionButton('停止', 'cancel'));
    if (controls.childElementCount) slot.append(controls);
    return slot;
}

function renderMessage(id) {
    const host = messageHost(id); const root = host?.querySelector('.mes_text'); if (!root) return;
    root.querySelectorAll('.janima-autocg-slot').forEach(node => node.remove());
    const blocks = semanticBlocks(root); const lastByIndex = new Map();
    for (const record of recordsForMessage(id)) {
        const slot = buildSlot(record);
        if (!blocks.length) { root.append(slot); continue; }
        const index = clampParagraphIndex(record.paragraphIndex, blocks.length);
        const anchor = lastByIndex.get(index) || blocks[index];
        anchor.insertAdjacentElement('afterend', slot); lastByIndex.set(index, slot);
    }
}

function renderAll() {
    document.querySelectorAll('#chat .mes[mesid], #chat .mes[data-mes-id]').forEach(host => {
        const id = Number(host.getAttribute('mesid') ?? host.dataset.mesId);
        if (isAssistantMessage(id)) renderMessage(id);
    });
}
function scheduleRender(delay = 50) { clearTimeout(runtime.renderTimer); runtime.renderTimer = setTimeout(renderAll, delay); }

function friendlyError(error) {
    const text = String(error?.message || error || '未知错误');
    return /Failed to fetch|NetworkError|Load failed/i.test(text)
        ? '无法直连 ComfyUI。确认使用电脑局域网 IP，并启用 --listen 0.0.0.0 与 --enable-cors-header *。' : text;
}

async function pingComfy({ notify = false } = {}) {
    runtime.connection = { state: 'checking', message: '正在连接…' }; updateConnectionUi();
    try {
        const result = await pingComfyNative(settings().comfyUrl, { timeoutMs: 7000 });
        runtime.connection = { state: 'ok', message: `已连接（${result.endpoint}）` };
        if (notify) toast('success', `已连接 ${normalizeComfyUrl(settings().comfyUrl)}`); return true;
    } catch (error) {
        runtime.connection = { state: 'error', message: '连接失败' };
        if (notify) toast('error', friendlyError(error)); return false;
    } finally { updateConnectionUi(); }
}

function enqueue(record) {
    if (runtime.queue.some(item => recordKey(item) === recordKey(record))) return;
    record.status = 'queued'; record.error = ''; runtime.queue.push(record); upsertRecord(record); scheduleRender(); void pump();
}

async function generate(record) {
    const config = settings(); record.controller = new AbortController();
    try {
        record.status = record.promptId ? 'generating' : 'submitting'; upsertRecord(record); scheduleRender();
        if (!record.promptId) {
            const workflow = buildAnimaWorkflow({ positive: record.prompt, negative: record.negative, seed: record.seed, profile: config.profile });
            record.promptId = (await submitComfyPrompt(config.comfyUrl, workflow, { signal: record.controller.signal })).promptId;
            record.status = 'generating'; await persistRecord(record); scheduleRender();
        }
        const result = await waitForComfyResult(config.comfyUrl, record.promptId, {
            signal: record.controller.signal, timeoutMs: config.generationTimeoutMs, pollIntervalMs: config.pollIntervalMs,
        });
        record.image = result.images.at(-1); record.url = buildComfyViewUrl(config.comfyUrl, record.image);
        record.status = 'done'; record.completedAt = Date.now();
        runtime.connection = { state: 'ok', message: 'ComfyUI 已连接' };
    } catch (error) {
        record.status = record.cancelRequested ? 'cancelled' : 'error'; record.error = record.cancelRequested ? '' : friendlyError(error);
        runtime.connection = { state: 'error', message: '生成失败' };
    } finally {
        delete record.controller; delete record.cancelRequested; await persistRecord(record); updateConnectionUi(); scheduleRender();
    }
}

async function pump() {
    if (runtime.running || !settings().enabled) return;
    const record = runtime.queue.shift(); if (!record) return; runtime.running = record;
    try { await generate(record); } finally { runtime.running = null; if (runtime.queue.length) setTimeout(() => void pump(), 30); }
}

function recordFromButton(target) {
    const slot = target.closest('.janima-autocg-slot'); if (!slot) return null;
    const key = `${slot.dataset.generationId}:${slot.dataset.shotId}`;
    return runtime.jobs.get(key) || recordsForMessage(Number(target.closest('.mes')?.getAttribute('mesid')))
        .find(item => recordKey(item) === key) || null;
}

function bindActions() {
    document.addEventListener('click', event => {
        const target = event.target.closest?.('.janima-autocg-action'); if (!target) return;
        const record = recordFromButton(target); if (!record) return;
        if (target.dataset.action === 'cancel') {
            runtime.queue = runtime.queue.filter(item => recordKey(item) !== recordKey(record));
            record.cancelRequested = true; record.controller?.abort('cancelled'); record.status = 'cancelled'; void persistRecord(record); scheduleRender();
        } else if (target.dataset.action === 'reroll') {
            record.retry = Number(record.retry || 0) + 1; record.seed = seedForPacket(record.packet, record.retry);
            record.promptId = ''; record.url = ''; record.image = null; record.error = ''; enqueue(record);
        }
    });
}

function settingsHtml() {
    return `<div id="janima_autocg_settings" class="extension_container janima-autocg-settings"><div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header"><b>JANIMA Galgame 自动CG v${EXT_VERSION}</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
    <div class="inline-drawer-content">
      <div class="janima-autocg-settings-row"><span class="janima-autocg-connection" data-role="connection">尚未检测</span><button class="menu_button" data-role="ping">检测 ComfyUI</button></div>
      <label class="checkbox_label"><input type="checkbox" name="enabled">启用自动CG</label>
      <label class="checkbox_label"><input type="checkbox" name="localFallback">模型漏写分镜时用本地规则补齐</label>
      <label>ComfyUI 地址<input class="text_pole" name="comfyUrl" type="url"></label>
      <div class="janima-autocg-settings-row"><label>最少CG<input class="text_pole" name="minimumShots" type="number" min="3" max="5"></label><label>最多CG<input class="text_pole" name="maximumShots" type="number" min="3" max="5"></label></div>
      <label>固定正面提示词<textarea class="text_pole" name="fixedPositive" rows="4"></textarea></label>
      <label>固定负面提示词<textarea class="text_pole" name="fixedNegative" rows="5"></textarea></label>
      <details><summary>模型与工作流</summary>
        <label>UNet<input class="text_pole" name="profile.model"></label><label>CLIP<input class="text_pole" name="profile.clip"></label><label>VAE<input class="text_pole" name="profile.vae"></label><label>LoRA<input class="text_pole" name="profile.lora"></label>
      </details>
      <small>v2.4 会根据剧情在 3–5 张之间变化，NSFW/explicit 阶段优先。固定提示词只控制画质、风格和常见错误；剧情相关性由分镜选择与英文场景标签决定。</small>
    </div></div></div>`;
}

function pathGet(root, path) { return path.split('.').reduce((value, key) => value?.[key], root); }
function pathSet(root, path, value) { const keys = path.split('.'); const last = keys.pop(); let target = root; for (const key of keys) target = target[key] ||= {}; target[last] = value; }
function syncSettings() {
    const root = document.querySelector(SETTINGS_SELECTOR); if (!root) return;
    root.querySelectorAll('[name]').forEach(input => { const value = pathGet(settings(), input.name); input.type === 'checkbox' ? input.checked = Boolean(value) : input.value = value ?? ''; });
    updateConnectionUi();
}
function updateConnectionUi() { const node = document.querySelector(`${SETTINGS_SELECTOR} [data-role="connection"]`); if (node) { node.dataset.state = runtime.connection.state; node.textContent = runtime.connection.message; } }
function bindSettings() {
    const root = document.querySelector(SETTINGS_SELECTOR); if (!root) return;
    root.addEventListener('change', event => {
        const input = event.target.closest('[name]'); if (!input) return;
        let value = input.type === 'checkbox' ? input.checked : input.value; if (input.type === 'number') value = Number(value);
        pathSet(settings(), input.name, value); settings(); saveSettingsDebounced?.(); refreshDirectorPrompt();
    });
    root.querySelector('[data-role="ping"]')?.addEventListener('click', () => void pingComfy({ notify: true }));
}

function resumeJobs() {
    if (!settings().resumeInterrupted) return;
    for (let id = Math.max(0, (chat?.length || 0) - 20); id < (chat?.length || 0); id++) {
        for (const stored of storageFor(chat[id])?.shots || []) {
            if (!['queued', 'submitting', 'generating'].includes(stored.status) || stored.url) continue;
            const record = { ...structuredClone(stored), messageId: id, chatId: String(getCurrentChatId?.() || ''), status: 'queued', error: '' };
            runtime.jobs.set(recordKey(record), record); enqueue(record);
        }
    }
}

function bindEvents() {
    const startEvent = event_types.GENERATION_STARTED || event_types.GENERATION_AFTER_COMMANDS;
    if (startEvent) eventSource.on(startEvent, beginGeneration);
    eventSource.on(event_types.MESSAGE_RECEIVED, (id, type) => setTimeout(() => void processMessage(id, { messageType: type }), 60));
    eventSource.on(event_types.GENERATION_ENDED, () => { const id = latestAssistantId(); if (id >= 0) setTimeout(() => void processMessage(id), 80); });
    if (event_types.GENERATION_STOPPED) eventSource.on(event_types.GENERATION_STOPPED, () => { const id = latestAssistantId(); if (id >= 0) setTimeout(() => void processMessage(id), 80); });
    if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, id => setTimeout(() => void processMessage(id, { force: true }), 100));
    if (event_types.CHAT_COMPLETION_PROMPT_READY) eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, data => { for (const message of data.chat || []) if (typeof message.content === 'string') message.content = stripProtocol(message.content); });
    if (event_types.GENERATE_AFTER_COMBINE_PROMPTS) eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, data => { if (typeof data.prompt === 'string') data.prompt = stripProtocol(data.prompt); });
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, () => { runtime.pending = null; refreshDirectorPrompt(); setTimeout(() => { resumeJobs(); renderAll(); }, 180); });
    [event_types.MESSAGE_UPDATED, event_types.MORE_MESSAGES_LOADED].filter(Boolean).forEach(type => eventSource.on(type, () => scheduleRender()));
}

function observeChat() {
    runtime.observer = new MutationObserver(() => scheduleRender(80));
    runtime.observer.observe(document.querySelector('#chat') || document.body, { childList: true, subtree: true });
}

jQuery(() => {
    if (runtime.initialized) return; runtime.initialized = true; settings();
    const container = document.querySelector('#extensions_settings') || document.querySelector('#extensions_settings2');
    if (container && !document.querySelector(SETTINGS_SELECTOR)) container.insertAdjacentHTML('beforeend', settingsHtml());
    syncSettings(); bindSettings(); bindActions(); bindEvents(); observeChat(); refreshDirectorPrompt(); resumeJobs(); renderAll();
    setTimeout(() => void pingComfy(), 500);
    globalThis.JANIMA_AUTO_CG = Object.freeze({ version: EXT_VERSION, ping: () => pingComfy({ notify: true }), processLatest: () => processMessage(latestAssistantId(), { force: true }), state: () => ({ queue: runtime.queue.length, running: runtime.running?.id || '', settings: settings() }) });
    document.documentElement.dataset.janimaAutocgVersion = EXT_VERSION;
    console.info(`[${EXT_NAME}] v${EXT_VERSION} loaded`);
});
