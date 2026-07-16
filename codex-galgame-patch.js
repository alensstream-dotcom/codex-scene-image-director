import { extension_settings } from '../../../extensions.js';
import { getContext } from '../../../st-context.js';
import {
    chat,
    eventSource,
    event_types,
    getRequestHeaders,
    is_send_press,
    reloadCurrentChat,
    saveChatConditional,
    saveSettingsDebounced,
} from '../../../../script.js';
import {
    DEFAULT_DIRECTOR_SETTINGS,
    DIRECTOR_SCHEMA,
    buildDirectorMessages,
    cleanStory,
    composeDirectedMessage,
    completeScenes,
    desiredShotCount,
    mergeCharactersIntoBible,
    normalizeDirectorSettings,
    parseDirectorResponse,
    processingKey,
} from './lib/galgame-director.mjs';
import { createBible, mergePacketIntoBible } from './lib/director-core.mjs';

const EXTENSION_NAME = 'st-chatu8';
const PATCH_VERSION = '3.2.0';
const AUTO_PRESET = 'Galgame 自动导演';
const TURBO_WORKFLOW_NAME = 'JANIMA Turbo 8步';
const active = new Map();
let initialized = false;
let latestMessagePoll = null;

function log(...values) {
    console.info('[智绘姬 Galgame 导演]', ...values);
}

function warn(...values) {
    console.warn('[智绘姬 Galgame 导演]', ...values);
}

function baseSettings() {
    extension_settings[EXTENSION_NAME] ||= {};
    return extension_settings[EXTENSION_NAME];
}

function directorState() {
    const root = baseSettings();
    root.codexGalgameDirector = {
        schema: DIRECTOR_SCHEMA,
        ...DEFAULT_DIRECTOR_SETTINGS,
        charactersByChat: {},
        ...root.codexGalgameDirector,
    };
    root.codexGalgameDirector.charactersByChat ||= {};
    return root.codexGalgameDirector;
}

function chatKey() {
    const context = getContext?.() || {};
    return `${context.groupId ?? context.characterId ?? 'chat'}:${context.chatId ?? 'current'}`;
}

function bibleForCurrentChat() {
    const state = directorState();
    const key = chatKey();
    state.charactersByChat[key] ||= createBible();
    return state.charactersByChat[key];
}

function janimaTurboWorkflow() {
    return JSON.stringify({
        2: { inputs: { unet_name: 'JANIMA_v10.safetensors', weight_dtype: 'default' }, class_type: 'UNETLoader', _meta: { title: 'JANIMA v10' } },
        5: { inputs: { clip_name: 'qwen_3_06b_base.safetensors', type: 'stable_diffusion', device: 'default' }, class_type: 'CLIPLoader', _meta: { title: 'Qwen 3 0.6B' } },
        6: { inputs: { vae_name: 'qwen_image_vae.safetensors' }, class_type: 'VAELoader', _meta: { title: 'Qwen VAE' } },
        7: { inputs: { lora_name: 'anima-turbo-lora-v0.2.safetensors', strength_model: 1, strength_clip: 1, model: ['2', 0], clip: ['5', 0] }, class_type: 'LoraLoader', _meta: { title: 'Anima Turbo LoRA' } },
        8: { inputs: { text: '%prompt%', clip: ['7', 1] }, class_type: 'CLIPTextEncode', _meta: { title: 'Positive prompt' } },
        9: { inputs: { text: '%negative_prompt%', clip: ['7', 1] }, class_type: 'CLIPTextEncode', _meta: { title: 'Negative prompt' } },
        10: { inputs: { width: '%width%', height: '%height%', batch_size: 1 }, class_type: 'EmptyLatentImage', _meta: { title: '768 x 1024' } },
        11: { inputs: { seed: '%seed%', steps: '%steps%', cfg: '%cfg_scale%', sampler_name: '%sampler_name%', scheduler: '%scheduler%', denoise: 1, model: ['7', 0], positive: ['8', 0], negative: ['9', 0], latent_image: ['10', 0] }, class_type: 'KSampler', _meta: { title: 'Turbo 8 steps' } },
        12: { inputs: { samples: ['11', 0], vae: ['6', 0] }, class_type: 'VAEDecode', _meta: { title: 'Decode' } },
        13: { inputs: { filename_prefix: 'ST_JANIMA_GALGAME', images: ['12', 0] }, class_type: 'SaveImage', _meta: { title: 'Save image' } },
    });
}

function configureBasePlugin() {
    const root = baseSettings();
    const state = directorState();
    root.scriptEnabled = true;
    root.mode = 'comfyui';
    root.client = 'browser';
    root.startTag = '[';
    root.endTag = ']';
    root.newlineFixEnabled = true;
    root.insertOriginalText = true;
    root.dbclike = false;
    // The director creates grounded inline buttons. Rendering is always a
    // deliberate player action so an unwanted candidate never consumes time.
    state.autoGenerate = false;
    root.zidongdianji = false;
    root.zidongdianji2 = false;
    root.enablePregen = false;
    root.autoLLMImageGen = false;
    root.imageGenInterval = 0;
    root.aiAutonomousResolution = false;
    root.comfyuiUrl ||= 'http://192.168.1.12:8188';
    root.comfyui_width = 768;
    root.comfyui_height = 1024;
    root.comfyui_steps = 8;
    root.cfg_comfyui = 1;
    root.comfyui_seed = 1548236793;
    root.sampler_name = 'euler';
    root.scheduler = 'normal';
    const negativePrompt = [
        'worst quality', 'low quality', 'bad anatomy', 'bad hands', 'extra fingers', 'missing fingers',
        'duplicated person', 'duplicate heroine', 'clone', 'identical twins', 'same face', 'merged bodies',
        'different face', 'wrong hair color', 'wrong eye color',
        'wrong clothes', 'male only', 'scenery only', 'empty scene', 'text', 'logo', 'signature', 'watermark',
    ].join(', ');
    root.negativePrompt_comfyui = negativePrompt;
    // ChatU8 uses UCP_comfyui as the final ComfyUI negative prompt.
    root.UCP_comfyui = negativePrompt;
    root.workers ||= {};
    root.workers[TURBO_WORKFLOW_NAME] = janimaTurboWorkflow();
    root.workerid = TURBO_WORKFLOW_NAME;
    root.worker = root.workers[TURBO_WORKFLOW_NAME];
    root.comfyui_profiles ||= {};
    root.comfyui_profiles[TURBO_WORKFLOW_NAME] = {
        ...(root.comfyui_profiles[TURBO_WORKFLOW_NAME] || {}),
        comfyuiUrl: root.comfyuiUrl,
        comfyui_width: 768,
        comfyui_height: 1024,
        comfyui_steps: 8,
        cfg_comfyui: 1,
        sampler_name: 'euler',
        scheduler: 'normal',
        workerid: TURBO_WORKFLOW_NAME,
        worker: root.workers[TURBO_WORKFLOW_NAME],
    };
    state.patchVersion = PATCH_VERSION;
    saveSettingsDebounced();
    window.dispatchEvent(new CustomEvent('st-chatu8-config-updated'));
}

function setStatus(message, kind = '') {
    const element = document.getElementById('codex-galgame-status');
    if (!element) return;
    element.textContent = message;
    element.dataset.kind = kind;
}

function responseContent(data) {
    return data?.choices?.[0]?.message?.content
        ?? data?.choices?.[0]?.text
        ?? data?.message?.content
        ?? data?.content
        ?? data?.response
        ?? '';
}

async function requestStoryboard(messages, config) {
    if (!config.apiKey) throw new Error('未填写 DeepSeek API Key');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('导演请求超时'), config.timeoutMs);
    try {
        const response = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: getRequestHeaders(),
            signal: controller.signal,
            body: JSON.stringify({
                chat_completion_source: 'custom',
                custom_url: config.apiUrl,
                custom_include_headers: `Authorization: "Bearer ${config.apiKey}"`,
                model: config.model,
                messages,
                temperature: config.temperature,
                top_p: 0.9,
                max_tokens: config.maxTokens,
                stream: false,
                response_format: { type: 'json_object' },
            }),
        });
        if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
        const data = await response.json();
        const content = responseContent(data);
        if (!content) throw new Error('DeepSeek 返回空内容');
        return content;
    } finally {
        clearTimeout(timeout);
    }
}

function syncChatU8Characters(characters, bible) {
    if (!characters?.length) return;
    const root = baseSettings();
    root.characterPresets ||= {};
    root.outfitPresets ||= {};
    root.characterEnablePresets ||= {};
    root.outfitEnablePresets ||= {};
    const characterIds = [];
    const outfitIds = [];
    for (const item of characters) {
        if (item.sex === 'male') continue;
        const locked = bible[item.id.toLowerCase()] || item;
        const characterId = `自动·${item.id}`;
        const outfitId = `自动·${item.id}·当前服装`;
        const oldCharacter = root.characterPresets[characterId] || {};
        root.characterPresets[characterId] = {
            nameCN: item.id,
            nameEN: locked.prompt_name || item.prompt_name || item.id,
            characterTraits: locked.dna || item.dna || '',
            facialFeatures: locked.dna || item.dna || '',
            facialFeaturesBack: locked.dna || item.dna || '',
            upperBodySFW: locked.dna || item.dna || '',
            upperBodySFWBack: locked.dna || item.dna || '',
            fullBodySFW: locked.dna || item.dna || '',
            fullBodySFWBack: locked.dna || item.dna || '',
            upperBodyNSFW: locked.dna || item.dna || '',
            upperBodyNSFWBack: locked.dna || item.dna || '',
            fullBodyNSFW: locked.dna || item.dna || '',
            fullBodyNSFWBack: locked.dna || item.dna || '',
            outfits: uniqueList([...(oldCharacter.outfits || []), outfitId]),
            photoImageIds: oldCharacter.photoImageIds || [],
            selectedPhotoIndex: oldCharacter.selectedPhotoIndex || 0,
            photoPrompt: oldCharacter.photoPrompt || '',
            sendPhoto: false,
            generationContext: '',
            generationWorldBook: '',
            generationVariables: oldCharacter.generationVariables || {},
        };
        root.outfitPresets[outfitId] = {
            ...(root.outfitPresets[outfitId] || {}),
            nameCN: `${item.id}当前服装`,
            nameEN: `${locked.prompt_name || item.prompt_name || item.id} current outfit`,
            owner: item.id,
            upperBody: locked.outfit || item.outfit || '',
            upperBodyBack: locked.outfit || item.outfit || '',
            fullBody: locked.outfit || item.outfit || '',
            fullBodyBack: locked.outfit || item.outfit || '',
            photoImageIds: root.outfitPresets[outfitId]?.photoImageIds || [],
            selectedPhotoIndex: root.outfitPresets[outfitId]?.selectedPhotoIndex || 0,
            photoPrompt: root.outfitPresets[outfitId]?.photoPrompt || '',
            sendPhoto: false,
        };
        characterIds.push(characterId);
        outfitIds.push(outfitId);
    }
    root.characterEnablePresets[AUTO_PRESET] = { characters: characterIds };
    root.outfitEnablePresets[AUTO_PRESET] = { outfits: outfitIds };
    root.characterEnablePresetId = AUTO_PRESET;
    root.outfitEnablePresetId = AUTO_PRESET;
}

function uniqueList(values) {
    return [...new Set(values.filter(Boolean))];
}

function messageAlreadyProcessed(message, key) {
    const director = message?.extra?.codexGalgameDirector;
    return director?.key === key && director?.version === PATCH_VERSION;
}

function buttonPrompt(button) {
    return String(
        button?.dataset?.link
        || button?.dataset?.imageTag
        || button?.dataset?.prompt
        || button?.getAttribute?.('data-link')
        || button?.getAttribute?.('data-image-tag')
        || '',
    );
}

function isDirectorImagePrompt(value) {
    const compact = String(value || '').toLowerCase().replace(/\s+/g, '');
    return compact.includes('originalstoryaction:') && compact.includes('consistentcharacterdesign');
}

function sanitizeRenderedButtons(messageId) {
    const root = document.querySelector(`.mes[mesid="${messageId}"]`);
    const buttons = root?.querySelectorAll('.st-chatu8-image-button, .image-tag-button') || [];
    buttons.forEach(button => {
        const directorButton = isDirectorImagePrompt(buttonPrompt(button));
        button.dataset.codexDirectorButton = String(directorButton);
        if (!directorButton) {
            button.hidden = true;
            button.setAttribute('aria-hidden', 'true');
            button.style.setProperty('display', 'none', 'important');
        }
    });
    return [...buttons].filter(button => button.dataset.codexDirectorButton === 'true');
}

async function refreshMessage(messageId) {
    const scroll = document.getElementById('chat');
    const top = scroll?.scrollTop;
    await reloadCurrentChat();
    if (scroll && Number.isFinite(top)) scroll.scrollTop = Math.max(top, scroll.scrollHeight - scroll.clientHeight);
    setTimeout(() => {
        window.dispatchEvent(new CustomEvent('st-chatu8-config-updated'));
    }, 50);
}

async function processMessage(messageId, messageType = '') {
    const id = Number(messageId);
    const message = chat[id];
    const state = directorState();
    const config = normalizeDirectorSettings(state);
    if (!config.enabled || !message || message.is_user || id !== chat.length - 1) return;
    if (/first_message|system/i.test(String(messageType))) return;
    const raw = String(message.mes || '');
    const story = cleanStory(raw);
    const wanted = desiredShotCount(story, config);
    if (!wanted) return;
    const key = processingKey(raw);
    if (messageAlreadyProcessed(message, key) || active.has(id)) return;

    const job = (async () => {
        const started = performance.now();
        document.documentElement.dataset.codexGalgameDirector = `processing:${id}`;
        const bible = bibleForCurrentChat();
        const lastUser = [...chat.slice(0, id)].reverse().find(item => item?.is_user)?.mes || '';
        let parsed = { characters: [], scenes: [] };
        let source = 'DeepSeek';
        let fallbackReason = '';
        setStatus(`正在理解本轮完整剧情，目标 ${wanted} 个镜头…`, 'working');
        try {
            const messages = buildDirectorMessages({ story, lastUserMessage: lastUser, bible, settings: config });
            const content = await requestStoryboard(messages, config);
            parsed = parseDirectorResponse(content, { story, bible, settings: config });
        } catch (error) {
            source = '本地快速回退';
            fallbackReason = String(error?.message || error).slice(0, 240);
            warn('导演请求未完成，立即使用本地回退：', error?.message || error);
        }

        // Model-level character data establishes immutable identity only. The
        // selected scenes below own the chronological outfit snapshots.
        mergeCharactersIntoBible(bible, parsed.characters);
        const scenes = completeScenes({ story, parsedScenes: parsed.scenes, bible, settings: config });
        if (!scenes.length) {
            message.extra ||= {};
            message.extra.codexGalgameDirector = { key, status: 'no-valid-female-scene', source };
            saveSettingsDebounced();
            await saveChatConditional();
            setStatus('本轮没有可安全生成的女性剧情镜头。', 'idle');
            return;
        }
        for (const scene of scenes) mergePacketIntoBible(bible, scene.packet);
        const synchronizedCharacters = [...new Map([
            ...parsed.characters,
            ...scenes.flatMap(scene => scene.packet.cast || []),
        ].filter(item => item?.id).map(item => [item.id.toLowerCase(), item])).values()];
        syncChatU8Characters(synchronizedCharacters, bible);

        const insertion = composeDirectedMessage(raw, story, scenes);
        if (!insertion.inserted) throw new Error('选中的原文锚点无法原位插入');
        message.mes = insertion.message;
        message.extra ||= {};
        message.extra.codexGalgameDirector = {
            key: processingKey(insertion.message),
            source,
            fallbackReason,
            scenes: scenes.map(scene => ({
                anchor: scene.anchor,
                stage: scene.packet.stage,
                cast: scene.packet.cast.map(item => item.id),
                outfits: Object.fromEntries(scene.packet.cast.map(item => [item.id, item.outfit])),
                evidenceWindow: scene.evidenceWindow,
                audit: scene.audit,
            })),
            elapsedMs: Math.round(performance.now() - started),
            version: PATCH_VERSION,
        };
        saveSettingsDebounced();
        await saveChatConditional();
        await refreshMessage(id);
        const elapsed = ((performance.now() - started) / 1000).toFixed(1);
        const sourceLabel = fallbackReason ? `${source}（${fallbackReason}）` : source;
        setStatus(`已用 ${sourceLabel} 在 ${elapsed}s 内原位插入 ${insertion.inserted} 个镜头；人物与服装已自动记忆。`, 'ok');
        log(`楼层 ${id}: ${insertion.inserted} 个原位镜头，${elapsed}s，来源=${source}`);
        document.documentElement.dataset.codexGalgameDirector = `complete:${id}:${insertion.inserted}`;
    })().catch(error => {
        document.documentElement.dataset.codexGalgameDirector = `error:${id}:${String(error?.message || error).slice(0, 120)}`;
        warn('处理失败：', error);
        setStatus(`处理失败：${error?.message || error}`, 'error');
    }).finally(() => active.delete(id));
    active.set(id, job);
    await job;
}

function scheduleLatestMessageProcessing(reason = 'reload', attempt = 0) {
    // Some front ends do not emit MESSAGE_RECEIVED reliably. The poll below is
    // the safety net, but it must never inspect a half-streamed assistant reply.
    if (is_send_press) {
        if (reason !== 'poll' && attempt < 80) {
            setTimeout(() => scheduleLatestMessageProcessing(reason, attempt + 1), 750);
        }
        return;
    }
    const id = chat.length - 1;
    const message = chat[id];
    if (message && !message.is_user) {
        sanitizeRenderedButtons(id);
        processMessage(id, reason);
        return;
    }
    if (attempt < 30) setTimeout(() => scheduleLatestMessageProcessing(reason, attempt + 1), 750);
}

function bindDirectorUi() {
    const host = document.getElementById('codex-galgame-director-settings');
    if (!host || host.dataset.bound === 'true') return;
    host.dataset.bound = 'true';
    const state = directorState();
    const fields = {
        enabled: document.getElementById('codex-galgame-enabled'),
        apiUrl: document.getElementById('codex-galgame-api-url'),
        apiKey: document.getElementById('codex-galgame-api-key'),
        model: document.getElementById('codex-galgame-model'),
        minimumShots: document.getElementById('codex-galgame-min-shots'),
        maximumShots: document.getElementById('codex-galgame-max-shots'),
        timeoutMs: document.getElementById('codex-galgame-timeout'),
    };
    for (const [key, element] of Object.entries(fields)) {
        if (!element) continue;
        if (element.type === 'checkbox') element.checked = state[key] !== false;
        else element.value = state[key] ?? DEFAULT_DIRECTOR_SETTINGS[key] ?? '';
        element.addEventListener(element.type === 'checkbox' ? 'change' : 'input', () => {
            state[key] = element.type === 'checkbox'
                ? element.checked
                : element.type === 'number' ? Number(element.value) : element.value;
            configureBasePlugin();
        });
    }
    document.getElementById('codex-galgame-test')?.addEventListener('click', async () => {
        const button = document.getElementById('codex-galgame-test');
        button.disabled = true;
        setStatus('正在测试 DeepSeek 单次导演请求…', 'working');
        try {
            const config = normalizeDirectorSettings(directorState());
            const messages = [{ role: 'system', content: 'Return only {"ok":true} as JSON.' }, { role: 'user', content: 'test' }];
            await requestStoryboard(messages, { ...config, maxTokens: 32, timeoutMs: Math.min(config.timeoutMs, 8000) });
            setStatus('DeepSeek 连接成功。', 'ok');
        } catch (error) {
            setStatus(`连接失败：${error?.message || error}`, 'error');
        } finally {
            button.disabled = false;
        }
    });
}

function initialize() {
    if (initialized) return;
    initialized = true;
    configureBasePlugin();
    bindDirectorUi();
    const observer = new MutationObserver(bindDirectorUi);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    eventSource.on(event_types.MESSAGE_RECEIVED, (messageId, messageType) => processMessage(messageId, messageType));
    if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, messageId => processMessage(messageId, 'swipe'));
    if (event_types.MESSAGE_RENDERED) eventSource.on(event_types.MESSAGE_RENDERED, messageId => processMessage(messageId, 'rendered'));
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, () => scheduleLatestMessageProcessing('chat-changed'));
    setTimeout(() => scheduleLatestMessageProcessing('reload'), 1200);
    latestMessagePoll ||= setInterval(() => scheduleLatestMessageProcessing('poll'), 2000);
    setStatus('Galgame 自动导演已启用。', 'ok');
    log(`v${PATCH_VERSION} 已加载；原生慢速二次 LLM 已关闭。`);
}

if (event_types.APP_READY) eventSource.on(event_types.APP_READY, () => setTimeout(initialize, 800));
if (document.readyState !== 'loading') setTimeout(initialize, 1400);
