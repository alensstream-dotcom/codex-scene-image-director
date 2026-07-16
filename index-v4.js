import {
    chat,
    characters,
    eventSource,
    event_types,
    generateRaw,
    getCurrentChatId,
    saveChatConditional,
    saveSettingsDebounced,
    setExtensionPrompt,
    this_chid,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { buildAnimaWorkflow, DEFAULT_ANIMA_PROFILE } from './lib/anima-direct-workflow.mjs';
import {
    buildComfyViewUrl,
    normalizeComfyUrl,
    pingComfyNative,
    submitComfyPrompt,
    waitForComfyResult,
} from './lib/comfy-direct.mjs';
import { semanticBlocks } from './lib/scene-anchor.mjs';
import { findBestDomAnchor } from './lib/scene-lock-v3.mjs';
import {
    DEFAULT_V4_NEGATIVE,
    DEFAULT_V4_POSITIVE,
    buildFallbackShotsV4,
    buildPlannerPrompt,
    composePromptV4,
    parsePlannerResponse,
    seedForShotV4,
    selectShotsV4,
} from './lib/director-v4.mjs';
import {
    extractNarrativeStory,
    stableHash,
    stripLegacyImagePromptLines,
    stripProtocol,
} from './lib/director-core.mjs';

const EXT_ID = 'codex_scene_image_director';
const EXT_NAME = 'JANIMA Galgame 自动CG';
const VERSION = '4.0.0';
const SETTINGS_SELECTOR = '#janima_autocg_settings';
const STORAGE_KEY = 'janimaAutoCg';

const DEFAULT_SETTINGS = Object.freeze({
    schema: 80,
    enabled: true,
    automatic: true,
    plannerRetry: true,
    localFallback: true,
    minimumShots: 3,
    maximumShots: 5,
    plannerResponseLength: 2200,
    comfyUrl: 'http://192.168.1.12:8188',
    generationTimeoutMs: 240000,
    pollIntervalMs: 1000,
    resumeInterrupted: true,
    showSceneDetails: true,
    manualCharacterLock: '',
    manualOutfitLock: '',
    fixedPositive: DEFAULT_V4_POSITIVE,
    fixedNegative: DEFAULT_V4_NEGATIVE,
    profile: { ...DEFAULT_ANIMA_PROFILE },
});

const runtime = {
    pending: null,
    planning: new Set(),
    processing: new Set(),
    queue: [],
    running: null,
    jobs: new Map(),
    renderTimer: null,
    observer: null,
    initialized: false,
    plannerActive: false,
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
    next.plannerResponseLength = Math.max(800, Math.min(5000, Number(next.plannerResponseLength) || 2200));
    next.generationTimeoutMs = Math.max(30000, Number(next.generationTimeoutMs) || 240000);
    next.pollIntervalMs = Math.max(300, Number(next.pollIntervalMs) || 1000);
    if (!String(next.fixedPositive || '').trim()) next.fixedPositive = DEFAULT_V4_POSITIVE;
    if (!String(next.fixedNegative || '').trim()) next.fixedNegative = DEFAULT_V4_NEGATIVE;
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
            .slice(0, 2400),
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

function cleanStory(raw = '') {
    return stripLegacyImagePromptLines(extractNarrativeStory(stripProtocol(raw)))
        .replace(/<!--\s*JANIMA_V3\s*:[\s\S]*?-->/gi, '')
        .trim();
}

function storageFor(message, create = false) {
    if (!message) return null;
    if (!message.extra && create) message.extra = {};
    if (!message.extra) return null;
    if (!message.extra[STORAGE_KEY] && create) {
        message.extra[STORAGE_KEY] = { version: 8, processedHash: '', planner: null, shots: [] };
    }
    const storage = message.extra[STORAGE_KEY] || null;
    if (storage && create) {
        storage.version = 8;
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
        anchor: record.anchor,
        quote: record.quote,
        shot: record.shot,
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
    try { await saveChatConditional?.(); }
    catch (error) { console.warn(`[${EXT_NAME}] 保存 CG 状态失败`, error); }
}

function recentRecords(limit = 24) {
    const records = [];
    for (let messageId = (chat?.length || 0) - 1; messageId >= 0 && records.length < limit; messageId--) {
        for (const shot of storageFor(chat[messageId])?.shots || []) {
            if (shot?.shot) records.push(shot);
        }
    }
    return records.slice(-limit);
}

function identityMemory() {
    const lines = [];
    const seen = new Set();
    for (const record of recentRecords().reverse()) {
        const shot = record.shot || {};
        const identity = String(shot.characterTags || '').trim();
        if (!identity) continue;
        const key = identity.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(`- ${identity}; outfit=${shot.outfitTags || 'unknown'}`);
        if (lines.length >= 6) break;
    }
    return lines.reverse().join('\n').slice(0, 1800);
}

function beginGeneration(type, options = {}, dryRun = false) {
    if (runtime.plannerActive || dryRun || !settings().enabled || !settings().automatic) return;
    if (type === 'quiet' || type === 'impersonate' || options?.quiet_prompt || options?.quietImage) return;
    runtime.pending = { chatId: String(getCurrentChatId?.() || ''), startedAt: Date.now() };
}

function canProcess(messageId, messageType, force) {
    if (force) return true;
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

async function runPlanner(story) {
    const config = settings();
    const request = buildPlannerPrompt({
        story,
        card: currentCharacterContext(),
        identityMemory: identityMemory(),
        minimum: config.minimumShots,
        maximum: config.maximumShots,
    });
    runtime.plannerActive = true;
    try {
        const raw = await generateRaw({
            prompt: request.userPrompt,
            systemPrompt: request.systemPrompt,
            responseLength: config.plannerResponseLength,
        });
        try {
            return { parsed: parsePlannerResponse(raw, story), raw, retried: false };
        } catch (error) {
            if (!config.plannerRetry) throw error;
            const repair = await generateRaw({
                prompt: `${request.userPrompt}\n\nYour previous output was invalid. Return corrected strict JSON only. Previous output:\n${String(raw || '').slice(0, 5000)}`,
                systemPrompt: `${request.systemPrompt}\nThe previous response failed JSON validation. Correct it without commentary.`,
                responseLength: config.plannerResponseLength,
            });
            return { parsed: parsePlannerResponse(repair, story), raw: repair, retried: true };
        }
    } finally {
        runtime.plannerActive = false;
    }
}

async function processAssistantMessage(messageId, { messageType = '', force = false } = {}) {
    const id = Number(messageId);
    if (!settings().enabled || !Number.isInteger(id) || id < 0 || !isAssistantMessage(id)) return;
    if (runtime.processing.has(id) || !canProcess(id, messageType, force)) return;
    const story = cleanStory(String(chat[id]?.mes || ''));
    if (!story) return;
    const storyHash = String(stableHash(story));
    const storage = storageFor(chat[id], true);
    if (!force && storage.processedHash === storyHash) return scheduleRender();

    runtime.processing.add(id);
    runtime.planning.add(id);
    scheduleRender(10);
    try {
        clearLiveMessageRecords(id);
        storage.processedHash = storyHash;
        storage.shots = [];
        storage.planner = null;

        let planner = { parsed: { targetCount: settings().minimumShots, characters: [], shots: [], errors: ['planner unavailable'] }, raw: '', retried: false };
        try {
            planner = await runPlanner(story);
        } catch (error) {
            console.error(`[${EXT_NAME}] 独立导演调用失败`, error);
            toast('warning', `独立导演失败，改用本地补漏：${error?.message || error}`);
        }

        const fallbackShots = settings().localFallback ? buildFallbackShotsV4(story) : [];
        const plan = selectShotsV4({
            story,
            plannerShots: planner.parsed.shots,
            fallbackShots,
            minimum: settings().minimumShots,
            maximum: settings().maximumShots,
            requestedCount: planner.parsed.targetCount,
        });
        storage.planner = {
            retried: planner.retried,
            errors: planner.parsed.errors,
            diagnostics: plan.diagnostics,
            characterCount: planner.parsed.characters.length,
        };

        const generationId = `v4-${id}-${storyHash}`;
        const globalCharacters = planner.parsed.characters;
        const globalIdentityKey = globalCharacters.map(item => `${item.name}:${item.identity}`).join('|');
        const identityKey = settings().manualCharacterLock
            || globalIdentityKey
            || currentCharacterContext().name
            || String(getCurrentChatId?.() || 'janima');
        const records = [];
        for (const shot of plan.shots) {
            const named = globalCharacters.filter(item => item.name && shot.paragraph.includes(item.name));
            const relevant = named.length
                ? named
                : globalCharacters.length === 1 || /2girls|1girl\s*,\s*1boy|2people/i.test(shot.people)
                    ? globalCharacters.slice(0, 2)
                    : [];
            const stableIdentity = relevant.map(item => [item.name, item.identity].filter(Boolean).join(', ')).filter(Boolean).join(', ');
            const stableOutfit = relevant.map(item => item.outfit).filter(Boolean).join(', ');
            const lockedShot = {
                ...shot,
                characterTags: [stableIdentity, shot.characterTags].filter(Boolean).join(', '),
                outfitTags: shot.outfitTags || stableOutfit,
            };
            const compiled = composePromptV4(lockedShot, {
                fixedPositive: settings().fixedPositive,
                fixedNegative: settings().fixedNegative,
                manualCharacterLock: settings().manualCharacterLock,
                manualOutfitLock: settings().manualOutfitLock,
                identityMemory: stableIdentity || identityMemory(),
            });
            const record = {
                id: shot.id,
                generationId,
                chatId: String(getCurrentChatId?.() || ''),
                messageId: id,
                paragraphIndex: shot.paragraphIndex,
                anchor: shot.anchor,
                quote: shot.paragraph,
                shot: lockedShot,
                prompt: compiled.positive,
                negative: compiled.negative,
                seed: seedForShotV4(shot, identityKey),
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

        await saveChatConditional?.();
        for (const record of records) enqueueRecord(record);
        runtime.pending = null;
        console.info(`[${EXT_NAME}] V4 storyboard`, {
            desired: plan.desired,
            plannerShots: planner.parsed.shots.length,
            fallbackShots: fallbackShots.length,
            selected: records.length,
            diagnostics: plan.diagnostics,
            plannerErrors: planner.parsed.errors,
        });
        if (!records.length) toast('error', '没有找到可用镜头，请打开“显示导演详情”后重试。');
    } catch (error) {
        console.error(`[${EXT_NAME}] V4 处理失败`, error);
        toast('error', `自动CG失败：${error?.message || error}`);
    } finally {
        runtime.planning.delete(id);
        runtime.processing.delete(id);
        scheduleRender(20);
    }
}

function recordsForMessage(messageId) {
    const map = new Map();
    for (const record of storageFor(chat?.[Number(messageId)])?.shots || []) map.set(recordKey(record), record);
    for (const record of runtime.jobs.values()) {
        if (Number(record.messageId) === Number(messageId)) map.set(recordKey(record), record);
    }
    return [...map.values()].sort((a, b) => Number(a.paragraphIndex ?? 9999) - Number(b.paragraphIndex ?? 9999));
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

function buildPlanningSlot() {
    const slot = document.createElement('section');
    slot.className = 'janima-autocg-slot is-planning';
    slot.dataset.planning = 'true';
    const status = document.createElement('div');
    status.className = 'janima-autocg-status';
    const spinner = document.createElement('span');
    spinner.className = 'janima-autocg-spinner';
    const text = document.createElement('span');
    text.className = 'janima-autocg-status-body';
    text.textContent = '独立导演正在通读整条回复、锁定人物服装并选择前中后镜头…';
    status.append(spinner, text);
    slot.append(status);
    return slot;
}

function sceneDetails(record) {
    if (!settings().showSceneDetails) return null;
    const details = document.createElement('details');
    details.className = 'janima-autocg-details';
    const summary = document.createElement('summary');
    summary.textContent = `V4 导演详情 · ${record.shot?.source === 'planner' ? '独立模型' : '本地补漏'} · P${record.paragraphIndex} · NSFW ${record.shot?.nsfwLevel || 0} · ${record.shot?.stage || 'scene'}`;
    const quote = document.createElement('div');
    quote.className = 'janima-autocg-quote';
    quote.textContent = `取材：${record.quote || record.anchor || ''}`;
    const prompt = document.createElement('code');
    prompt.className = 'janima-autocg-prompt';
    prompt.textContent = `Positive：${record.prompt}\n\nNegative：${record.negative}`;
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
    const lastByAnchor = new Map();
    for (const record of recordsForMessage(messageId)) {
        const slot = buildSlot(record);
        if (!blocks.length) {
            root.append(slot);
            continue;
        }
        const matched = findBestDomAnchor(blocks, record.anchor || record.quote, record.paragraphIndex) || blocks[Math.min(blocks.length - 1, Math.max(0, record.paragraphIndex || 0))];
        const key = Math.max(0, blocks.indexOf(matched));
        const anchor = lastByAnchor.get(key) || matched;
        anchor.insertAdjacentElement('afterend', slot);
        lastByAnchor.set(key, slot);
    }
    if (runtime.planning.has(Number(messageId))) root.append(buildPlanningSlot());
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

function friendlyError(error) {
    const text = String(error?.message || error || '未知错误');
    if (/Failed to fetch|NetworkError|Load failed/i.test(text)) {
        return '无法直连 ComfyUI。确认使用电脑局域网 IP，并启用 --listen 0.0.0.0 与 --enable-cors-header *。';
    }
    return text;
}

function updateConnectionUi() {
    const node = document.querySelector(`${SETTINGS_SELECTOR} [data-role="connection"]`);
    if (!node) return;
    node.dataset.state = runtime.connection.state;
    node.textContent = runtime.connection.message;
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
    try { await generateRecord(record); }
    finally {
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
            record.seed = seedForShotV4(record.shot || {}, settings().manualCharacterLock || record.shot?.characterTags || '', record.retry);
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
            const record = { ...structuredClone(persisted), messageId, chatId: String(getCurrentChatId?.() || ''), status: 'queued', error: '' };
            runtime.jobs.set(recordKey(record), record);
            enqueueRecord(record);
        }
    }
}

function settingsHtml() {
    return `<div id="janima_autocg_settings" class="extension_container janima-autocg-settings"><div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header"><b>JANIMA Galgame 自动CG v${VERSION}</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
      <div class="inline-drawer-content">
        <div class="janima-autocg-settings-row"><span class="janima-autocg-connection" data-role="connection">尚未检测</span><button type="button" class="menu_button" data-role="ping">检测 ComfyUI</button></div>
        <label class="checkbox_label"><input type="checkbox" name="enabled">启用 V4 精确导演</label>
        <label class="checkbox_label"><input type="checkbox" name="plannerRetry">导演 JSON 无效时自动修复一次</label>
        <label class="checkbox_label"><input type="checkbox" name="localFallback">导演漏掉关键动作/成人阶段时本地补漏</label>
        <label class="checkbox_label"><input type="checkbox" name="showSceneDetails">显示每张图的取材段落与最终 Prompt</label>
        <small>V4 会在正文完成后额外调用一次当前模型，只分析这条正文，不读取世界书，速度会慢一点，但镜头、服装、人物和 NSFW 动作会明显更准确。</small>
        <label>ComfyUI 地址<input class="text_pole" name="comfyUrl" type="url"></label>
        <div class="janima-autocg-settings-row"><label>最少CG<input class="text_pole" name="minimumShots" type="number" min="3" max="5"></label><label>最多CG<input class="text_pole" name="maximumShots" type="number" min="3" max="5"></label></div>
        <label>导演最大输出 Tokens<input class="text_pole" name="plannerResponseLength" type="number" min="800" max="5000" step="100"></label>
        <label>人物固定描述（留空由导演统一）<textarea class="text_pole" name="manualCharacterLock" rows="3" placeholder="adult woman, long black hair, golden eyes, oval face"></textarea></label>
        <label>服装强制描述（留空按每个剧情段落）<textarea class="text_pole" name="manualOutfitLock" rows="3" placeholder="white hanfu, pale blue sash, silver hairpin"></textarea></label>
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
        scheduleRender();
    });
    root.querySelector('[data-role="ping"]')?.addEventListener('click', () => void pingComfy({ notify: true }));
}

function bindEvents() {
    const startEvent = event_types.GENERATION_STARTED || event_types.GENERATION_AFTER_COMMANDS;
    if (startEvent) eventSource.on(startEvent, beginGeneration);
    if (event_types.MESSAGE_RECEIVED) {
        eventSource.on(event_types.MESSAGE_RECEIVED, (messageId, messageType) => {
            setTimeout(() => void processAssistantMessage(messageId, { messageType }), 100);
        });
    }
    if (event_types.GENERATION_ENDED) {
        eventSource.on(event_types.GENERATION_ENDED, () => {
            if (runtime.plannerActive) return;
            const id = latestAssistantId();
            if (id >= 0) setTimeout(() => void processAssistantMessage(id), 140);
        });
    }
    if (event_types.MESSAGE_SWIPED) {
        eventSource.on(event_types.MESSAGE_SWIPED, messageId => setTimeout(() => void processAssistantMessage(messageId, { force: true }), 120));
    }
    if (event_types.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            runtime.pending = null;
            setTimeout(() => { resumeInterruptedJobs(); renderAll(); }, 180);
        });
    }
    [event_types.MESSAGE_UPDATED, event_types.MORE_MESSAGES_LOADED]
        .filter(Boolean)
        .forEach(type => eventSource.on(type, () => scheduleRender(80)));
}

function observeChat() {
    if (runtime.observer) return;
    runtime.observer = new MutationObserver(() => scheduleRender(80));
    runtime.observer.observe(document.querySelector('#chat') || document.body, { childList: true, subtree: true });
}

jQuery(() => {
    if (runtime.initialized) return;
    runtime.initialized = true;
    settings();
    for (const key of ['JANIMA_AUTO_CG_V3_DIRECT_STORYBOARD', 'JANIMA_AUTO_CG_V4_DIRECTOR', 'JANIMA_AUTO_CG_V3_DIRECTOR']) {
        try { setExtensionPrompt(key, ''); } catch { /* old prompt key absent */ }
    }
    const container = document.querySelector('#extensions_settings') || document.querySelector('#extensions_settings2');
    if (container && !document.querySelector(SETTINGS_SELECTOR)) container.insertAdjacentHTML('beforeend', settingsHtml());
    syncSettingsUi();
    bindSettings();
    bindSlotActions();
    bindEvents();
    observeChat();
    resumeInterruptedJobs();
    renderAll();
    setTimeout(() => void pingComfy(), 500);
    globalThis.JANIMA_AUTO_CG = Object.freeze({
        version: VERSION,
        ping: () => pingComfy({ notify: true }),
        processLatest: () => {
            const id = latestAssistantId();
            return id >= 0 ? processAssistantMessage(id, { force: true }) : Promise.resolve();
        },
        inspectLatest: () => {
            const id = latestAssistantId();
            return id >= 0 ? recordsForMessage(id).map(record => ({
                paragraphIndex: record.paragraphIndex,
                source: record.shot?.source,
                stage: record.shot?.stage,
                nsfwLevel: record.shot?.nsfwLevel,
                quote: record.quote,
                prompt: record.prompt,
                negative: record.negative,
                status: record.status,
            })) : [];
        },
        state: () => ({
            plannerActive: runtime.plannerActive,
            planning: [...runtime.planning],
            queue: runtime.queue.length,
            running: runtime.running ? recordKey(runtime.running) : null,
            settings: settings(),
        }),
    });
    document.documentElement.dataset.janimaAutocgVersion = VERSION;
    console.info(`[${EXT_NAME}] v${VERSION} loaded; isolated planner mode`);
});
