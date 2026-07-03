import {
    chat,
    chat_metadata,
    characters,
    eventSource,
    event_types,
    getCurrentChatId,
    saveSettingsDebounced,
    this_chid,
} from '../../../../script.js';
import {
    extension_settings,
    getContext,
    saveMetadataDebounced,
} from '../../../extensions.js';

const EXT_ID = 'codex_scene_image_director';
const EXT_NAME = '剧情镜头导演';
const SETTINGS_SELECTOR = '#codex_scene_image_director';
const TH_MEMORY_KEY = 'codexSceneImageDirector';

const DEFAULT_SETTINGS = {
    version: 1,
    api: {
        enabled: false,
        url: '',
        key: '',
        model: '',
        timeoutMs: 8000,
        temperature: 0.1,
    },
    behavior: {
        autoMemory: true,
        syncTavernHelper: false,
        allowPermanentOverwrite: false,
        maxRecentMessages: 8,
        promptLanguage: 'mixed',
    },
    prompt: {
        stylePreset: 'anime',
        quality: 'masterpiece, best quality, detailed eyes, clean lineart, expressive face',
        positivePrefix: '',
        negative: 'lowres, blurry, bad anatomy, extra fingers, missing fingers, deformed hands, duplicate, watermark, text, logo, cropped, out of frame',
        camera: 'cinematic composition, dynamic angle',
    },
    memory: {
        world: {
            name: '',
            genre: '',
            rules: '',
            visualStyle: '',
            negativeRules: '',
        },
        characters: {},
        locations: {},
    },
    ui: {
        open: true,
        tab: 'compose',
    },
    runtime: {
        lastAnalyzedHash: '',
    },
};

const DEFAULT_CHAT_MEMORY = {
    version: 1,
    scene: {
        location: '',
        time: '',
        weather: '',
        lighting: '',
        mood: '',
        worldState: '',
    },
    characters: {},
    history: [],
    runtime: {
        lastMessageHash: '',
        lastUpdateAt: 0,
    },
};

const STYLE_PRESETS = {
    anime: 'anime illustration, refined character design, soft shading',
    cinematic: 'cinematic lighting, film still, dramatic composition',
    realistic: 'realistic portrait, natural skin texture, detailed environment',
    comic: 'comic illustration, sharp silhouette, expressive panel composition',
    custom: '',
};

const FIELD_LABELS = {
    appearance: '固定外观',
    currentOutfit: '当前服装',
    expression: '表情',
    pose: '姿势',
    state: '状态',
    accessories: '饰品',
};

const CN_TO_TAG = [
    [/卧室|房间|寝室/g, 'bedroom'],
    [/客厅/g, 'living room'],
    [/浴室|洗浴/g, 'bathroom'],
    [/厨房/g, 'kitchen'],
    [/街道|街上/g, 'street'],
    [/雨/g, 'rain'],
    [/雪/g, 'snow'],
    [/夜晚|深夜|晚上/g, 'night'],
    [/黄昏|傍晚/g, 'dusk'],
    [/清晨|早晨/g, 'morning'],
    [/阳光/g, 'sunlight'],
    [/月光/g, 'moonlight'],
    [/白色/g, 'white'],
    [/黑色/g, 'black'],
    [/红色/g, 'red'],
    [/蓝色/g, 'blue'],
    [/金色/g, 'golden'],
    [/银色/g, 'silver'],
    [/连衣裙/g, 'dress'],
    [/睡裙/g, 'nightgown'],
    [/校服/g, 'school uniform'],
    [/衬衫/g, 'shirt'],
    [/外套/g, 'coat'],
    [/长发/g, 'long hair'],
    [/短发/g, 'short hair'],
    [/微笑/g, 'smile'],
    [/害羞/g, 'shy'],
    [/哭|泪/g, 'tears'],
    [/拥抱/g, 'hugging'],
    [/坐/g, 'sitting'],
    [/站/g, 'standing'],
    [/躺/g, 'lying down'],
    [/跪/g, 'kneeling'],
];

let state = {
    selectedMessages: new Set(),
    stEventsBound: false,
    lastPositive: '',
    lastNegative: '',
    lastShotCard: '',
    analyzerRunning: false,
    analyzerQueue: [],
    saveTimer: null,
};

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function deepMerge(base, extra) {
    const output = deepClone(base);
    mergeInto(output, extra || {});
    return output;
}

function mergeInto(target, source) {
    for (const [key, value] of Object.entries(source || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
                target[key] = {};
            }
            mergeInto(target[key], value);
        } else if (value !== undefined) {
            target[key] = value;
        }
    }
    return target;
}

function ensureSettings() {
    if (!extension_settings[EXT_ID]) {
        extension_settings[EXT_ID] = deepClone(DEFAULT_SETTINGS);
    }
    extension_settings[EXT_ID] = deepMerge(DEFAULT_SETTINGS, extension_settings[EXT_ID]);
    return extension_settings[EXT_ID];
}

function ensureChatMemory() {
    if (!chat_metadata[EXT_ID]) {
        chat_metadata[EXT_ID] = deepClone(DEFAULT_CHAT_MEMORY);
    }
    chat_metadata[EXT_ID] = deepMerge(DEFAULT_CHAT_MEMORY, chat_metadata[EXT_ID]);
    return chat_metadata[EXT_ID];
}

function saveAll() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
        saveSettingsDebounced();
        saveMetadataDebounced();
    }, 120);
}

function getCurrentCharacterName() {
    const ctx = safeContext();
    const fromContext = ctx?.name2 || ctx?.char?.name;
    const fromCharacter = characters?.[this_chid]?.name;
    return fromContext || fromCharacter || '角色';
}

function safeContext() {
    try {
        return getContext?.();
    } catch {
        return {};
    }
}

function getCharacterMemory(name = getCurrentCharacterName()) {
    const settings = ensureSettings();
    const chatMemory = ensureChatMemory();
    if (!settings.memory.characters[name]) {
        settings.memory.characters[name] = {
            appearance: '',
            currentOutfit: '',
            expression: '',
            pose: '',
            state: '',
            accessories: '',
            negative: '',
            locked: {
                appearance: true,
                currentOutfit: false,
                accessories: true,
            },
        };
    }
    if (!chatMemory.characters[name]) {
        chatMemory.characters[name] = {
            currentOutfit: '',
            expression: '',
            pose: '',
            state: '',
            accessories: '',
        };
    }
    return deepMerge(settings.memory.characters[name], chatMemory.characters[name]);
}

function updateCharacterMemory(name, patch, options = {}) {
    if (!name || !patch || typeof patch !== 'object') return;
    const settings = ensureSettings();
    const chatMemory = ensureChatMemory();
    getCharacterMemory(name);
    const permanentKeys = ['appearance', 'negative'];
    const globalTarget = settings.memory.characters[name];
    const chatTarget = chatMemory.characters[name] || {};
    for (const [key, value] of Object.entries(patch)) {
        if (!isUsefulText(value)) continue;
        if (permanentKeys.includes(key)) {
            if (settings.behavior.allowPermanentOverwrite || options.manual) {
                globalTarget[key] = normalizeLine(value);
            }
            continue;
        }
        chatTarget[key] = normalizeLine(value);
    }
    chatMemory.characters[name] = chatTarget;
}

function isUsefulText(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function normalizeLine(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueParts(parts) {
    const seen = new Set();
    const output = [];
    for (const part of parts) {
        const clean = normalizeLine(part).replace(/^,+|,+$/g, '').trim();
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(clean);
    }
    return output;
}

function joinPrompt(parts) {
    return uniqueParts(parts).join(', ');
}

function getSelectedText() {
    const text = String(window.getSelection?.() || '').trim();
    return text;
}

function getMessageText(message) {
    return normalizeMultiline(message?.mes || message?.message || message?.text || '');
}

function normalizeMultiline(value) {
    return String(value || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function hashText(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return String(hash >>> 0);
}

function compactPreview(text, length = 90) {
    const clean = normalizeLine(text);
    return clean.length > length ? `${clean.slice(0, length)}...` : clean;
}

function translateKnownTags(text) {
    let output = text;
    for (const [pattern, tag] of CN_TO_TAG) {
        if (pattern.test(output)) {
            output += `, ${tag}`;
        }
        pattern.lastIndex = 0;
    }
    return output;
}

function extractSceneLocal(text) {
    const clean = normalizeMultiline(text);
    const result = {
        location: '',
        time: '',
        weather: '',
        lighting: '',
        mood: '',
        action: '',
        expression: '',
        outfit: '',
        camera: '',
        props: '',
    };

    const locationMatch = clean.match(/(?:在|来到|走进|进入|回到|躲进|站在|坐在)([^，。！？\n]{1,18}(?:房间|卧室|客厅|浴室|厨房|街道|巷子|教室|办公室|森林|旅馆|酒店|床边|窗边|门口|走廊|屋顶|车里|沙发|浴缸|庭院|阳台))/);
    if (locationMatch) result.location = locationMatch[1];

    const outfitMatch = clean.match(/(?:穿着|换上|披着|脱下|套着|裹着|身上是|衣服是)([^，。！？\n]{1,32})/);
    if (outfitMatch) result.outfit = outfitMatch[1];

    const expressionMatch = clean.match(/(微笑|笑了|脸红|害羞|哭|流泪|皱眉|惊讶|愤怒|温柔|冷淡|紧张|迷茫|疲惫|兴奋|委屈|认真|羞涩)/);
    if (expressionMatch) result.expression = expressionMatch[1];

    const timeMatch = clean.match(/(清晨|早晨|上午|中午|下午|黄昏|傍晚|夜晚|深夜|凌晨|雨夜|雪夜)/);
    if (timeMatch) result.time = timeMatch[1];

    const weatherMatch = clean.match(/(下雨|雨中|暴雨|小雨|下雪|雪中|大雪|雾|薄雾|晴朗|阴天|雷雨|风很大)/);
    if (weatherMatch) result.weather = weatherMatch[1];

    const lightingMatch = clean.match(/(阳光|月光|灯光|烛光|霓虹|昏暗|逆光|暖光|冷光|阴影|晨光|夕阳)/);
    if (lightingMatch) result.lighting = lightingMatch[1];

    const actionMatches = clean.match(/(?:她|他|你|我|少女|男人|女人|女孩|少年|[^，。！？\n]{1,10})(?:轻轻|慢慢|突然|正|正在)?(?:抱住|靠近|坐下|站起|躺下|跪下|回头|低头|抬头|伸手|握住|亲吻|凝视|推开|拉住|转身|蜷缩|倚着|贴近)[^，。！？\n]{0,24}/g);
    if (actionMatches?.length) result.action = actionMatches.slice(-2).join(', ');

    const propMatch = clean.match(/(?:拿着|握着|抱着|捧着|戴着)([^，。！？\n]{1,20})/);
    if (propMatch) result.props = propMatch[1];

    result.camera = inferCamera(clean);
    result.mood = inferMood(clean);
    return result;
}

function inferCamera(text) {
    if (/全身|站在|走在|奔跑|街道|森林|大厅/.test(text)) return 'full body, environmental shot';
    if (/脸|眼睛|泪|亲吻|靠近|凝视|低声/.test(text)) return 'close-up, intimate framing';
    if (/坐|沙发|床边|桌前|拥抱/.test(text)) return 'medium shot';
    return '';
}

function inferMood(text) {
    if (/紧张|害怕|颤抖|危险|压抑/.test(text)) return 'tense atmosphere';
    if (/温柔|安心|轻轻|微笑|拥抱/.test(text)) return 'tender atmosphere';
    if (/暧昧|脸红|贴近|亲吻/.test(text)) return 'romantic tension';
    if (/战斗|怒|冲|血|破碎/.test(text)) return 'dramatic tension';
    return '';
}

function buildShotCard(inputText, localScene) {
    const settings = ensureSettings();
    const chatMemory = ensureChatMemory();
    const name = getCurrentCharacterName();
    const charMemory = getCharacterMemory(name);
    const lines = [
        `人物: ${name}`,
        `固定外观: ${charMemory.appearance || '未填写'}`,
        `当前服装: ${localScene.outfit || charMemory.currentOutfit || '未填写'}`,
        `地点: ${localScene.location || chatMemory.scene.location || '未填写'}`,
        `时间/光线: ${localScene.time || chatMemory.scene.time || ''} ${localScene.lighting || chatMemory.scene.lighting || ''}`.trim(),
        `动作: ${localScene.action || charMemory.pose || '未填写'}`,
        `表情/氛围: ${localScene.expression || charMemory.expression || ''} ${localScene.mood || chatMemory.scene.mood || ''}`.trim(),
        `镜头: ${localScene.camera || settings.prompt.camera}`,
        `剧情段落: ${compactPreview(inputText, 220)}`,
    ];
    return lines.join('\n');
}

function compilePrompt(inputText) {
    const settings = ensureSettings();
    const chatMemory = ensureChatMemory();
    const name = getCurrentCharacterName();
    const charMemory = getCharacterMemory(name);
    const localScene = extractSceneLocal(inputText);
    const style = STYLE_PRESETS[settings.prompt.stylePreset] || '';
    const sceneLocation = localScene.location || chatMemory.scene.location;
    const sceneTime = localScene.time || chatMemory.scene.time;
    const sceneWeather = localScene.weather || chatMemory.scene.weather;
    const sceneLighting = localScene.lighting || chatMemory.scene.lighting;
    const sceneMood = localScene.mood || chatMemory.scene.mood;
    const outfit = localScene.outfit || charMemory.currentOutfit;
    const expression = localScene.expression || charMemory.expression;
    const pose = localScene.action || charMemory.pose;
    const translatedInput = settings.behavior.promptLanguage === 'zh' ? inputText : translateKnownTags(inputText);

    const positive = joinPrompt([
        settings.prompt.positivePrefix,
        settings.prompt.quality,
        style,
        settings.memory.world.visualStyle,
        settings.memory.world.genre,
        settings.memory.world.rules,
        `${name}`,
        charMemory.appearance,
        charMemory.accessories,
        outfit,
        charMemory.state,
        sceneLocation,
        sceneTime,
        sceneWeather,
        sceneLighting,
        sceneMood,
        localScene.props,
        expression,
        pose,
        localScene.camera || settings.prompt.camera,
        translatedInput,
    ]);

    const negative = joinPrompt([
        settings.prompt.negative,
        settings.memory.world.negativeRules,
        charMemory.negative,
    ]);

    const shotCard = buildShotCard(inputText, localScene);
    return { positive, negative, shotCard, localScene };
}

function updateMemoryFromSelectedScene(inputText, localScene) {
    const chatMemory = ensureChatMemory();
    const name = getCurrentCharacterName();
    if (localScene.location) chatMemory.scene.location = localScene.location;
    if (localScene.time) chatMemory.scene.time = localScene.time;
    if (localScene.weather) chatMemory.scene.weather = localScene.weather;
    if (localScene.lighting) chatMemory.scene.lighting = localScene.lighting;
    if (localScene.mood) chatMemory.scene.mood = localScene.mood;
    updateCharacterMemory(name, {
        currentOutfit: localScene.outfit,
        expression: localScene.expression,
        pose: localScene.action,
        state: localScene.props,
    });
    addHistory('compose', inputText);
    saveAll();
}

function addHistory(type, text, patch = null) {
    const memory = ensureChatMemory();
    memory.history.unshift({
        type,
        at: Date.now(),
        chatId: getCurrentChatId?.() || '',
        preview: compactPreview(text, 160),
        patch,
    });
    memory.history = memory.history.slice(0, 30);
}

function getRecentMessages() {
    const max = ensureSettings().behavior.maxRecentMessages || 8;
    return (chat || [])
        .map((message, index) => ({ message, index, text: getMessageText(message) }))
        .filter(item => item.text && !item.message?.is_system)
        .slice(-max)
        .reverse();
}

function buildSelectedRecentText() {
    const selected = [...state.selectedMessages].sort((a, b) => a - b);
    return selected.map(index => getMessageText(chat[index])).filter(Boolean).join('\n\n');
}

function getLatestAssistantMessage() {
    for (let i = chat.length - 1; i >= 0; i -= 1) {
        const message = chat[i];
        if (!message?.is_system && !message?.is_user && getMessageText(message)) {
            return { index: i, text: getMessageText(message) };
        }
    }
    return null;
}

function enqueueMemoryAnalysis(text, source = 'message') {
    const settings = ensureSettings();
    if (!settings.behavior.autoMemory || !text) return;
    const hash = hashText(`${source}:${text}`);
    const memory = ensureChatMemory();
    if (memory.runtime.lastMessageHash === hash || settings.runtime.lastAnalyzedHash === hash) return;
    memory.runtime.lastMessageHash = hash;
    settings.runtime.lastAnalyzedHash = hash;
    state.analyzerQueue.push({ text, source, hash });
    runAnalyzerQueue();
}

async function runAnalyzerQueue() {
    if (state.analyzerRunning) return;
    state.analyzerRunning = true;
    setStatus('后台记忆队列处理中');
    try {
        while (state.analyzerQueue.length) {
            const item = state.analyzerQueue.shift();
            try {
                const patch = await analyzeMemoryPatch(item.text);
                applyMemoryPatch(patch, item.text, item.source);
            } catch (error) {
                console.warn(`[${EXT_NAME}] memory analysis failed`, error);
                const fallback = patchFromLocalHeuristics(item.text);
                applyMemoryPatch(fallback, item.text, `${item.source}:local`);
            }
        }
    } finally {
        state.analyzerRunning = false;
        setStatus('后台记忆空闲');
        renderMemoryFields();
    }
}

function patchFromLocalHeuristics(text) {
    const scene = extractSceneLocal(text);
    const name = getCurrentCharacterName();
    return {
        confidence: 0.55,
        scene: {
            location: scene.location,
            time: scene.time,
            weather: scene.weather,
            lighting: scene.lighting,
            mood: scene.mood,
        },
        characters: {
            [name]: {
                currentOutfit: scene.outfit,
                expression: scene.expression,
                pose: scene.action,
                state: scene.props,
            },
        },
    };
}

async function analyzeMemoryPatch(text) {
    const settings = ensureSettings();
    if (!settings.api.enabled || !settings.api.url) {
        return patchFromLocalHeuristics(text);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1500, settings.api.timeoutMs || 8000));
    const currentMemory = {
        chat: ensureChatMemory(),
        character: getCharacterMemory(),
        world: settings.memory.world,
    };
    const url = normalizeApiUrl(settings.api.url);
    const body = {
        model: settings.api.model || undefined,
        temperature: Number(settings.api.temperature ?? 0.1),
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: [
                    '你是 SillyTavern 文生图插件的视觉记忆更新器。',
                    '只根据新增剧情提取视觉状态变化，返回严格 JSON。',
                    '不要续写剧情，不要解释。',
                    '永久外观如发色、瞳色、体型、种族默认不要覆盖，除非文本明确是稳定设定。',
                    '优先更新 currentOutfit、location、time、weather、lighting、mood、expression、pose、state。',
                    'JSON 格式: {"confidence":0-1,"scene":{},"characters":{"角色名":{}},"world":{},"notes":[]}',
                ].join('\n'),
            },
            {
                role: 'user',
                content: JSON.stringify({
                    currentMemory,
                    newText: text,
                    currentCharacter: getCurrentCharacterName(),
                }),
            },
        ],
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(settings.api.key ? { Authorization: `Bearer ${settings.api.key}` } : {}),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`API ${response.status}`);
        }
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? data;
        return parsePatchContent(content);
    } finally {
        clearTimeout(timeout);
    }
}

function normalizeApiUrl(url) {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(clean)) return clean;
    if (/\/v1$/.test(clean)) return `${clean}/chat/completions`;
    return `${clean}/v1/chat/completions`;
}

function parsePatchContent(content) {
    if (typeof content === 'object') return content;
    const text = String(content || '').trim();
    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error('API did not return JSON');
    }
}

function applyMemoryPatch(patch, sourceText = '', source = 'api') {
    if (!patch || typeof patch !== 'object') return;
    const confidence = Number(patch.confidence ?? 0.5);
    if (confidence < 0.35) return;
    const settings = ensureSettings();
    const memory = ensureChatMemory();
    const scene = patch.scene || {};
    for (const key of ['location', 'time', 'weather', 'lighting', 'mood', 'worldState']) {
        if (isUsefulText(scene[key])) memory.scene[key] = normalizeLine(scene[key]);
    }
    if (patch.world && typeof patch.world === 'object') {
        for (const key of ['name', 'genre', 'rules', 'visualStyle', 'negativeRules']) {
            if (isUsefulText(patch.world[key]) && (settings.behavior.allowPermanentOverwrite || !settings.memory.world[key])) {
                settings.memory.world[key] = normalizeLine(patch.world[key]);
            }
        }
    }
    for (const [name, charPatch] of Object.entries(patch.characters || {})) {
        updateCharacterMemory(name || getCurrentCharacterName(), charPatch);
    }
    addHistory(source, sourceText, patch);
    memory.runtime.lastUpdateAt = Date.now();
    syncTavernHelperMemory();
    saveAll();
}

function getTavernHelper() {
    return window.TavernHelper || globalThis.TavernHelper;
}

function syncTavernHelperMemory() {
    const settings = ensureSettings();
    if (!settings.behavior.syncTavernHelper) return;
    const th = getTavernHelper();
    if (!th?.insertOrAssignVariables) return;
    try {
        th.insertOrAssignVariables({ [TH_MEMORY_KEY]: exportMemoryObject() }, { type: 'chat' });
    } catch (error) {
        console.warn(`[${EXT_NAME}] TavernHelper sync failed`, error);
    }
}

function importTavernHelperMemory() {
    const th = getTavernHelper();
    if (!th?.getVariables) {
        setStatus('没有检测到酒馆助手 TavernHelper');
        return;
    }
    try {
        const vars = th.getVariables({ type: 'chat' });
        const data = vars?.[TH_MEMORY_KEY];
        if (!data) {
            setStatus('酒馆助手里没有本插件记忆');
            return;
        }
        importMemoryObject(data);
        setStatus('已从酒馆助手变量导入');
    } catch (error) {
        setStatus(`导入失败: ${error.message}`);
    }
}

function exportMemoryObject() {
    return {
        exportedAt: new Date().toISOString(),
        settingsMemory: ensureSettings().memory,
        chatMemory: ensureChatMemory(),
    };
}

function importMemoryObject(data) {
    if (!data || typeof data !== 'object') return;
    const settings = ensureSettings();
    if (data.settingsMemory) {
        settings.memory = deepMerge(settings.memory, data.settingsMemory);
    }
    if (data.chatMemory) {
        chat_metadata[EXT_ID] = deepMerge(ensureChatMemory(), data.chatMemory);
    }
    renderMemoryFields();
    saveAll();
}

function downloadMemory() {
    const blob = new Blob([JSON.stringify(exportMemoryObject(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scene-image-memory-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            importMemoryObject(JSON.parse(String(reader.result || '{}')));
            setStatus('记忆文件已导入');
        } catch (error) {
            setStatus(`导入失败: ${error.message}`);
        }
    };
    reader.readAsText(file);
}

function setStatus(text) {
    const el = document.querySelector(`${SETTINGS_SELECTOR} [data-role="status"]`);
    if (el) el.textContent = text;
}

function readFormToSettings() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    if (!root) return;
    const settings = ensureSettings();
    settings.api.enabled = root.querySelector('[name="api.enabled"]').checked;
    settings.api.url = root.querySelector('[name="api.url"]').value.trim();
    settings.api.key = root.querySelector('[name="api.key"]').value.trim();
    settings.api.model = root.querySelector('[name="api.model"]').value.trim();
    settings.api.timeoutMs = Number(root.querySelector('[name="api.timeoutMs"]').value || 8000);
    settings.api.temperature = Number(root.querySelector('[name="api.temperature"]').value || 0.1);
    settings.behavior.autoMemory = root.querySelector('[name="behavior.autoMemory"]').checked;
    settings.behavior.syncTavernHelper = root.querySelector('[name="behavior.syncTavernHelper"]').checked;
    settings.behavior.allowPermanentOverwrite = root.querySelector('[name="behavior.allowPermanentOverwrite"]').checked;
    settings.behavior.promptLanguage = root.querySelector('[name="behavior.promptLanguage"]').value;
    settings.prompt.stylePreset = root.querySelector('[name="prompt.stylePreset"]').value;
    settings.prompt.quality = root.querySelector('[name="prompt.quality"]').value.trim();
    settings.prompt.positivePrefix = root.querySelector('[name="prompt.positivePrefix"]').value.trim();
    settings.prompt.negative = root.querySelector('[name="prompt.negative"]').value.trim();
    settings.prompt.camera = root.querySelector('[name="prompt.camera"]').value.trim();
    settings.memory.world.name = root.querySelector('[name="world.name"]').value.trim();
    settings.memory.world.genre = root.querySelector('[name="world.genre"]').value.trim();
    settings.memory.world.rules = root.querySelector('[name="world.rules"]').value.trim();
    settings.memory.world.visualStyle = root.querySelector('[name="world.visualStyle"]').value.trim();
    settings.memory.world.negativeRules = root.querySelector('[name="world.negativeRules"]').value.trim();
    saveAll();
}

function readFormToMemory() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    if (!root) return;
    const name = getCurrentCharacterName();
    const settings = ensureSettings();
    const chatMemory = ensureChatMemory();
    getCharacterMemory(name);
    settings.memory.characters[name].appearance = root.querySelector('[name="char.appearance"]').value.trim();
    settings.memory.characters[name].accessories = root.querySelector('[name="char.accessories"]').value.trim();
    settings.memory.characters[name].negative = root.querySelector('[name="char.negative"]').value.trim();
    chatMemory.characters[name].currentOutfit = root.querySelector('[name="char.currentOutfit"]').value.trim();
    chatMemory.characters[name].expression = root.querySelector('[name="char.expression"]').value.trim();
    chatMemory.characters[name].pose = root.querySelector('[name="char.pose"]').value.trim();
    chatMemory.characters[name].state = root.querySelector('[name="char.state"]').value.trim();
    chatMemory.scene.location = root.querySelector('[name="scene.location"]').value.trim();
    chatMemory.scene.time = root.querySelector('[name="scene.time"]').value.trim();
    chatMemory.scene.weather = root.querySelector('[name="scene.weather"]').value.trim();
    chatMemory.scene.lighting = root.querySelector('[name="scene.lighting"]').value.trim();
    chatMemory.scene.mood = root.querySelector('[name="scene.mood"]').value.trim();
    saveAll();
}

function renderMemoryFields() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    if (!root) return;
    const settings = ensureSettings();
    const chatMemory = ensureChatMemory();
    const name = getCurrentCharacterName();
    const charMemory = getCharacterMemory(name);
    setValue(root, 'char.name', name);
    for (const key of Object.keys(FIELD_LABELS)) {
        setValue(root, `char.${key}`, charMemory[key] || '');
    }
    for (const key of ['location', 'time', 'weather', 'lighting', 'mood']) {
        setValue(root, `scene.${key}`, chatMemory.scene[key] || '');
    }
    for (const key of ['name', 'genre', 'rules', 'visualStyle', 'negativeRules']) {
        setValue(root, `world.${key}`, settings.memory.world[key] || '');
    }
    renderRecentMessages();
    renderHistory();
}

function setValue(root, name, value) {
    const el = root.querySelector(`[name="${name}"]`);
    if (el) el.value = value ?? '';
}

function renderRecentMessages() {
    const box = document.querySelector(`${SETTINGS_SELECTOR} [data-role="recent-messages"]`);
    if (!box) return;
    const items = getRecentMessages();
    box.innerHTML = items.map(item => {
        const checked = state.selectedMessages.has(item.index) ? 'checked' : '';
        const speaker = item.message?.name || (item.message?.is_user ? 'user' : 'assistant');
        return `
            <label class="csid-message-row">
                <input type="checkbox" data-message-index="${item.index}" ${checked}>
                <span class="csid-message-speaker">${escapeHtml(speaker)}</span>
                <span class="csid-message-preview">${escapeHtml(compactPreview(item.text, 100))}</span>
            </label>
        `;
    }).join('');
}

function renderHistory() {
    const box = document.querySelector(`${SETTINGS_SELECTOR} [data-role="history"]`);
    if (!box) return;
    const history = ensureChatMemory().history.slice(0, 8);
    box.innerHTML = history.length
        ? history.map(item => `<div class="csid-history-item"><b>${escapeHtml(item.type)}</b><span>${escapeHtml(item.preview)}</span></div>`).join('')
        : '<div class="csid-empty">暂无记录</div>';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function fillFormFromSettings() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    if (!root) return;
    const settings = ensureSettings();
    root.querySelector('[name="api.enabled"]').checked = settings.api.enabled;
    root.querySelector('[name="api.url"]').value = settings.api.url;
    root.querySelector('[name="api.key"]').value = settings.api.key;
    root.querySelector('[name="api.model"]').value = settings.api.model;
    root.querySelector('[name="api.timeoutMs"]').value = settings.api.timeoutMs;
    root.querySelector('[name="api.temperature"]').value = settings.api.temperature;
    root.querySelector('[name="behavior.autoMemory"]').checked = settings.behavior.autoMemory;
    root.querySelector('[name="behavior.syncTavernHelper"]').checked = settings.behavior.syncTavernHelper;
    root.querySelector('[name="behavior.allowPermanentOverwrite"]').checked = settings.behavior.allowPermanentOverwrite;
    root.querySelector('[name="behavior.promptLanguage"]').value = settings.behavior.promptLanguage;
    root.querySelector('[name="prompt.stylePreset"]').value = settings.prompt.stylePreset;
    root.querySelector('[name="prompt.quality"]').value = settings.prompt.quality;
    root.querySelector('[name="prompt.positivePrefix"]').value = settings.prompt.positivePrefix;
    root.querySelector('[name="prompt.negative"]').value = settings.prompt.negative;
    root.querySelector('[name="prompt.camera"]').value = settings.prompt.camera;
    renderMemoryFields();
}

function buildSettingsHtml() {
    return `
        <div id="codex_scene_image_director" class="csid-root">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>${EXT_NAME}</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="csid-status" data-role="status">就绪</div>
                    <div class="csid-tabs">
                        <button class="menu_button csid-tab is-active" data-tab="compose">生图</button>
                        <button class="menu_button csid-tab" data-tab="memory">记忆</button>
                        <button class="menu_button csid-tab" data-tab="settings">设置</button>
                    </div>

                    <section class="csid-panel is-active" data-panel="compose">
                        <textarea class="text_pole csid-textarea" data-role="scene-input" placeholder="粘贴或读取选中的剧情段落"></textarea>
                        <div class="csid-actions">
                            <button class="menu_button" data-action="read-selection">读取选中</button>
                            <button class="menu_button" data-action="use-recent">使用勾选</button>
                            <button class="menu_button" data-action="use-latest">最新回复</button>
                            <button class="menu_button result-control" data-action="compose">生成提示词</button>
                        </div>
                        <div class="csid-recent" data-role="recent-messages"></div>
                        <label class="csid-label">镜头卡</label>
                        <textarea class="text_pole csid-output" data-role="shot-card" readonly></textarea>
                        <label class="csid-label">正向提示词</label>
                        <textarea class="text_pole csid-output" data-role="positive" readonly></textarea>
                        <label class="csid-label">反向提示词</label>
                        <textarea class="text_pole csid-output small" data-role="negative" readonly></textarea>
                        <div class="csid-actions">
                            <button class="menu_button" data-action="copy-positive">复制正向</button>
                            <button class="menu_button" data-action="copy-negative">复制反向</button>
                            <button class="menu_button" data-action="analyze-input">后台记忆</button>
                        </div>
                    </section>

                    <section class="csid-panel" data-panel="memory">
                        <div class="csid-grid two">
                            <label>当前角色<input class="text_pole" name="char.name" readonly></label>
                            <label>当前地点<input class="text_pole" name="scene.location"></label>
                            <label>时间<input class="text_pole" name="scene.time"></label>
                            <label>天气<input class="text_pole" name="scene.weather"></label>
                            <label>光线<input class="text_pole" name="scene.lighting"></label>
                            <label>氛围<input class="text_pole" name="scene.mood"></label>
                        </div>
                        <label class="csid-label">固定外观</label>
                        <textarea class="text_pole csid-memory-area" name="char.appearance"></textarea>
                        <div class="csid-grid two">
                            <label>当前服装<input class="text_pole" name="char.currentOutfit"></label>
                            <label>饰品<input class="text_pole" name="char.accessories"></label>
                            <label>表情<input class="text_pole" name="char.expression"></label>
                            <label>姿势<input class="text_pole" name="char.pose"></label>
                        </div>
                        <label class="csid-label">状态</label>
                        <textarea class="text_pole csid-memory-area" name="char.state"></textarea>
                        <label class="csid-label">角色负面词</label>
                        <textarea class="text_pole csid-memory-area small" name="char.negative"></textarea>
                        <div class="csid-actions">
                            <button class="menu_button result-control" data-action="save-memory">保存记忆</button>
                            <button class="menu_button" data-action="import-th">导入酒馆助手</button>
                            <button class="menu_button" data-action="export-memory">导出记忆</button>
                            <label class="menu_button csid-file-button">导入文件<input type="file" data-action="import-file" accept="application/json"></label>
                        </div>
                        <div class="csid-history" data-role="history"></div>
                    </section>

                    <section class="csid-panel" data-panel="settings">
                        <div class="csid-grid two">
                            <label>世界名<input class="text_pole" name="world.name"></label>
                            <label>世界类型<input class="text_pole" name="world.genre"></label>
                        </div>
                        <label class="csid-label">世界观限制</label>
                        <textarea class="text_pole csid-memory-area" name="world.rules"></textarea>
                        <label class="csid-label">视觉风格</label>
                        <textarea class="text_pole csid-memory-area" name="world.visualStyle"></textarea>
                        <label class="csid-label">世界负面限制</label>
                        <textarea class="text_pole csid-memory-area small" name="world.negativeRules"></textarea>

                        <div class="csid-grid two">
                            <label>画风
                                <select class="text_pole" name="prompt.stylePreset">
                                    <option value="anime">二次元</option>
                                    <option value="cinematic">电影感</option>
                                    <option value="realistic">写实</option>
                                    <option value="comic">漫画</option>
                                    <option value="custom">自定义</option>
                                </select>
                            </label>
                            <label>提示词语言
                                <select class="text_pole" name="behavior.promptLanguage">
                                    <option value="mixed">混合</option>
                                    <option value="zh">中文</option>
                                </select>
                            </label>
                        </div>
                        <label class="csid-label">质量词</label>
                        <textarea class="text_pole csid-memory-area small" name="prompt.quality"></textarea>
                        <label class="csid-label">固定前缀</label>
                        <textarea class="text_pole csid-memory-area small" name="prompt.positivePrefix"></textarea>
                        <label class="csid-label">默认镜头</label>
                        <input class="text_pole" name="prompt.camera">
                        <label class="csid-label">默认反向词</label>
                        <textarea class="text_pole csid-memory-area" name="prompt.negative"></textarea>

                        <div class="csid-toggles">
                            <label><input type="checkbox" name="behavior.autoMemory"> 自动后台记忆</label>
                            <label><input type="checkbox" name="behavior.syncTavernHelper"> 同步酒馆助手变量</label>
                            <label><input type="checkbox" name="behavior.allowPermanentOverwrite"> 允许覆盖永久设定</label>
                            <label><input type="checkbox" name="api.enabled"> 启用额外 API</label>
                        </div>
                        <div class="csid-grid two">
                            <label>API 地址<input class="text_pole" name="api.url" placeholder="http://127.0.0.1:8000/v1"></label>
                            <label>模型<input class="text_pole" name="api.model"></label>
                            <label>超时 ms<input class="text_pole" type="number" name="api.timeoutMs" min="1500" step="500"></label>
                            <label>温度<input class="text_pole" type="number" name="api.temperature" min="0" max="2" step="0.1"></label>
                        </div>
                        <label class="csid-label">API Key</label>
                        <input class="text_pole" type="password" name="api.key" autocomplete="off">
                        <div class="csid-actions">
                            <button class="menu_button result-control" data-action="save-settings">保存设置</button>
                            <button class="menu_button" data-action="test-api">测试 API</button>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    `;
}

function bindEvents() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    if (!root || root.dataset.csidBound === '1') return;
    root.dataset.csidBound = '1';
    root.addEventListener('click', event => {
        const tab = event.target.closest('[data-tab]');
        if (tab) {
            switchTab(tab.dataset.tab);
            return;
        }
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'read-selection') readSelectionIntoInput();
        if (action === 'use-recent') useRecentIntoInput();
        if (action === 'use-latest') useLatestIntoInput();
        if (action === 'compose') composeFromInput();
        if (action === 'copy-positive') copyText(state.lastPositive, '已复制正向提示词');
        if (action === 'copy-negative') copyText(state.lastNegative, '已复制反向提示词');
        if (action === 'analyze-input') analyzeInputNow();
        if (action === 'save-memory') {
            readFormToMemory();
            setStatus('记忆已保存');
        }
        if (action === 'save-settings') {
            readFormToSettings();
            setStatus('设置已保存');
        }
        if (action === 'export-memory') downloadMemory();
        if (action === 'import-th') importTavernHelperMemory();
        if (action === 'test-api') testApi();
    });
    root.addEventListener('change', event => {
        const msg = event.target.closest('[data-message-index]');
        if (msg) {
            const index = Number(msg.dataset.messageIndex);
            if (msg.checked) state.selectedMessages.add(index);
            else state.selectedMessages.delete(index);
        }
        if (event.target.matches('[data-action="import-file"]')) {
            readImportFile(event.target.files?.[0]);
            event.target.value = '';
        }
    });
    root.addEventListener('input', event => {
        if (event.target.closest('[name]')) {
            readFormToSettings();
            readFormToMemory();
        }
    });
}

function switchTab(tabName) {
    const root = document.querySelector(SETTINGS_SELECTOR);
    root.querySelectorAll('[data-tab]').forEach(tab => tab.classList.toggle('is-active', tab.dataset.tab === tabName));
    root.querySelectorAll('[data-panel]').forEach(panel => panel.classList.toggle('is-active', panel.dataset.panel === tabName));
    ensureSettings().ui.tab = tabName;
    saveAll();
}

function readSelectionIntoInput() {
    const text = getSelectedText();
    if (!text) {
        setStatus('没有读取到选中文本');
        return;
    }
    document.querySelector(`${SETTINGS_SELECTOR} [data-role="scene-input"]`).value = text;
    setStatus('已读取选中文本');
}

function useRecentIntoInput() {
    const text = buildSelectedRecentText();
    if (!text) {
        setStatus('没有勾选最近消息');
        return;
    }
    document.querySelector(`${SETTINGS_SELECTOR} [data-role="scene-input"]`).value = text;
    setStatus('已填入勾选消息');
}

function useLatestIntoInput() {
    const latest = getLatestAssistantMessage();
    if (!latest) {
        setStatus('没有找到最新回复');
        return;
    }
    document.querySelector(`${SETTINGS_SELECTOR} [data-role="scene-input"]`).value = latest.text;
    setStatus(`已填入第 ${latest.index} 楼`);
}

function composeFromInput() {
    readFormToSettings();
    readFormToMemory();
    const input = document.querySelector(`${SETTINGS_SELECTOR} [data-role="scene-input"]`).value.trim();
    if (!input) {
        setStatus('请先选择或粘贴剧情段落');
        return;
    }
    const result = compilePrompt(input);
    state.lastPositive = result.positive;
    state.lastNegative = result.negative;
    state.lastShotCard = result.shotCard;
    document.querySelector(`${SETTINGS_SELECTOR} [data-role="positive"]`).value = result.positive;
    document.querySelector(`${SETTINGS_SELECTOR} [data-role="negative"]`).value = result.negative;
    document.querySelector(`${SETTINGS_SELECTOR} [data-role="shot-card"]`).value = result.shotCard;
    updateMemoryFromSelectedScene(input, result.localScene);
    syncTavernHelperMemory();
    renderMemoryFields();
    setStatus('提示词已生成');
}

function analyzeInputNow() {
    const input = document.querySelector(`${SETTINGS_SELECTOR} [data-role="scene-input"]`).value.trim();
    if (!input) {
        setStatus('没有可分析的剧情段落');
        return;
    }
    enqueueMemoryAnalysis(input, 'manual');
}

async function testApi() {
    readFormToSettings();
    setStatus('API 测试中');
    try {
        const patch = await analyzeMemoryPatch('她在深夜的旅馆房间里换上白色睡裙，灯光很柔和。');
        setStatus(`API 正常: ${JSON.stringify(patch).slice(0, 80)}`);
    } catch (error) {
        setStatus(`API 测试失败: ${error.message}`);
    }
}

async function copyText(text, okStatus) {
    if (!text) {
        setStatus('没有可复制内容');
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const area = document.createElement('textarea');
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
    }
    setStatus(okStatus);
}

function onStEvent(eventType, handler) {
    if (!eventType || !eventSource?.on) return;
    eventSource.on(eventType, handler);
}

function bindStEvents() {
    if (state.stEventsBound) return;
    state.stEventsBound = true;
    onStEvent(event_types.CHAT_CHANGED, () => {
        ensureChatMemory();
        state.selectedMessages.clear();
        setTimeout(() => {
            fillFormFromSettings();
            renderMemoryFields();
        }, 150);
    });
    onStEvent(event_types.MESSAGE_RECEIVED, messageId => {
        const text = getMessageText(chat?.[Number(messageId)]);
        if (text) enqueueMemoryAnalysis(text, 'message_received');
        setTimeout(renderRecentMessages, 150);
    });
    onStEvent(event_types.MESSAGE_UPDATED, messageId => {
        const text = getMessageText(chat?.[Number(messageId)]);
        if (text) enqueueMemoryAnalysis(text, 'message_updated');
        setTimeout(renderRecentMessages, 150);
    });
    onStEvent(event_types.GENERATION_ENDED, () => {
        const latest = getLatestAssistantMessage();
        if (latest?.text) enqueueMemoryAnalysis(latest.text, 'generation_ended');
        setTimeout(renderRecentMessages, 150);
    });
}

function init() {
    ensureSettings();
    ensureChatMemory();
    if (!document.querySelector(SETTINGS_SELECTOR)) {
        $('#extensions_settings').append(buildSettingsHtml());
    }
    bindEvents();
    bindStEvents();
    fillFormFromSettings();
    const tab = ensureSettings().ui.tab || 'compose';
    switchTab(tab);
    exposeDebugApi();
    setStatus(getTavernHelper() ? '就绪，已检测到酒馆助手' : '就绪，独立记忆模式');
}

function exposeDebugApi() {
    globalThis.codexSceneImageDirector = {
        version: '0.1.0',
        extractSceneLocal,
        compilePrompt,
        composeText(text, { updateMemory = false } = {}) {
            const result = compilePrompt(String(text || ''));
            if (updateMemory) {
                updateMemoryFromSelectedScene(String(text || ''), result.localScene);
                syncTavernHelperMemory();
            }
            return result;
        },
        getSettings: () => structuredClone(ensureSettings()),
        getMemory: () => structuredClone(ensureChatMemory()),
    };
}
$(() => init());




