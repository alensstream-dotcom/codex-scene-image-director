import {
    chat,
    chat_metadata,
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
const STORY_MEMORY_PROMPT_KEY = EXT_ID + '_story_memory';

const DEFAULT_SETTINGS = {
    version: 2,
    api: {
        enabled: false,
        url: '',
        key: '',
        model: '',
        models: [],
        timeoutMs: 12000,
        temperature: 0.1,
    },
    behavior: {
        autoMemory: true,
        syncTavernHelper: false,
        allowPermanentOverwrite: false,
        maxRecentMessages: 8,
        promptLanguage: 'en',
        preferClipboard: true,
    },
    storyMemory: {
        enabled: true,
        autoIndex: true,
        injectToPrompt: true,
        includeOriginal: true,
        useApiSummary: true,
        injectDepth: 2,
        maxEntries: 500,
        maxRetrieved: 8,
        maxInjectChars: 1800,
        maxEntryChars: 900,
    },
    chatu8: {
        enabled: true,
        startTag: '[',
        endTag: ']',
        insertToChatInput: true,
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
    version: 2,
    scene: {
        location: '',
        time: '',
        weather: '',
        lighting: '',
        mood: '',
        worldState: '',
    },
    characters: {},
    longTerm: {
        summary: '',
        facts: [],
        relationships: {},
        visualNotes: [],
        visualEvents: [],
        summaryTree: { l1: [], l2: [], l3: [] },
    },
    story: {
        summary: '',
        facts: [],
        relationships: {},
        openThreads: [],
        characterStates: {},
        entries: [],
        summaryTree: { l1: [], l2: [], l3: [] },
        lastRetrieval: [],
        lastInjectedPrompt: '',
    },
    history: [],
    runtime: {
        lastMessageHash: '',
        lastStoryHash: '',
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
    [/旅馆房间|酒店房间|旅店房间/g, 'hotel room'],
    [/旅馆|酒店|旅店/g, 'hotel'],
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
    messageMenuBound: false,
    activeMessageId: null,
    lastPositive: '',
    lastNegative: '',
    lastShotCard: '',
    lastTrigger: '',
    lastImageDataUrl: '',
    analyzerRunning: false,
    analyzerQueue: [],
    storyAnalyzerRunning: false,
    storyAnalyzerQueue: [],
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
    migrateSettings(extension_settings[EXT_ID]);
    return extension_settings[EXT_ID];
}

function migrateSettings(settings) {
    if (!settings || settings.version >= DEFAULT_SETTINGS.version) return;
    settings.behavior.promptLanguage = 'en';
    settings.behavior.preferClipboard = true;
    settings.chatu8.enabled = true;
    settings.chatu8.insertToChatInput = true;
    settings.chatu8.startTag = settings.chatu8.startTag || '[';
    settings.chatu8.endTag = settings.chatu8.endTag || ']';
    settings.api.timeoutMs = Math.max(Number(settings.api.timeoutMs || 0), 12000);
    settings.version = DEFAULT_SETTINGS.version;
}

function ensureChatMemory() {
    chat_metadata.variables ||= {};
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

function textArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(item => normalizeLine(item)).filter(Boolean);
    return String(value)
        .split(/\n|；|;/)
        .map(item => normalizeLine(item))
        .filter(Boolean);
}

function pushUniqueLimited(target, values, limit = 60) {
    if (!Array.isArray(target)) return [];
    const seen = new Set(target.map(item => normalizeLine(item).toLowerCase()));
    for (const value of textArray(values)) {
        const key = value.toLowerCase();
        if (!key || seen.has(key)) continue;
        target.unshift(value);
        seen.add(key);
    }
    return target.slice(0, limit);
}

function mergeRelationshipMemory(target, patch) {
    if (!patch || typeof patch !== 'object') return target;
    for (const [name, value] of Object.entries(patch)) {
        if (!name || value === undefined || value === null) continue;
        if (typeof value === 'string') {
            target[name] = normalizeLine(value);
        } else if (typeof value === 'object') {
            target[name] = { ...(target[name] && typeof target[name] === 'object' ? target[name] : {}), ...value };
        }
    }
    return target;
}

function getAllCharacterMemories() {
    const settings = ensureSettings();
    const chatMemory = ensureChatMemory();
    const names = uniqueParts([
        getCurrentCharacterName(),
        ...Object.keys(settings.memory.characters || {}),
        ...Object.keys(chatMemory.characters || {}),
    ].filter(Boolean));
    const output = {};
    for (const name of names) output[name] = getCharacterMemory(name);
    return output;
}

function buildVisualMemoryContext(selectedText = '') {
    const settings = ensureSettings();
    const memory = ensureChatMemory();
    return {
        scene: memory.scene,
        world: settings.memory.world,
        characters: getAllCharacterMemories(),
        longTerm: ensureLongTermMemory(),
        retrieved: retrieveRelevantMemories(selectedText, 10),
        recentHistory: (memory.history || []).slice(0, 10).map(item => ({ type: item.type, preview: item.preview })),
        selectedTextPreview: compactPreview(selectedText, 260),
    };
}

function mergeLongTermMemory(patch, sourceText = '') {
    const memory = ensureChatMemory();
    memory.longTerm = ensureLongTermMemory();
    const longTerm = patch.longTerm || patch.long_term || {};
    const summary = longTerm.summary || patch.summary;
    if (isUsefulText(summary)) memory.longTerm.summary = normalizeLine(summary);
    memory.longTerm.facts = pushUniqueLimited(memory.longTerm.facts || [], longTerm.facts || patch.facts || [], 80);
    memory.longTerm.visualNotes = pushUniqueLimited(memory.longTerm.visualNotes || [], longTerm.visualNotes || longTerm.visual_notes || patch.visualNotes || patch.visual_notes || patch.notes || [], 60);
    memory.longTerm.relationships ||= {};
    mergeRelationshipMemory(memory.longTerm.relationships, longTerm.relationships || patch.relationships || {});
    if (!memory.longTerm.summary && sourceText) memory.longTerm.summary = compactPreview(sourceText, 220);
}

function ensureLongTermMemory() {
    const memory = ensureChatMemory();
    memory.longTerm ||= {};
    memory.longTerm.summary ||= '';
    memory.longTerm.facts ||= [];
    memory.longTerm.relationships ||= {};
    memory.longTerm.visualNotes ||= [];
    memory.longTerm.visualEvents ||= [];
    memory.longTerm.summaryTree ||= { l1: [], l2: [], l3: [] };
    memory.longTerm.summaryTree.l1 ||= [];
    memory.longTerm.summaryTree.l2 ||= [];
    memory.longTerm.summaryTree.l3 ||= [];
    return memory.longTerm;
}

function memoryTokens(...parts) {
    const text = normalizeLine(parts.filter(Boolean).join(' ')).toLowerCase();
    const tokens = new Set();
    const matches = text.match(/[a-z0-9_]{3,}|[\u4e00-\u9fff]{2,}/g) || [];
    for (const raw of matches) {
        const token = normalizeLine(raw);
        if (!token) continue;
        tokens.add(token);
        if (/^[\u4e00-\u9fff]+$/.test(token) && token.length > 2) {
            for (let i = 0; i < token.length - 1; i++) tokens.add(token.slice(i, i + 2));
            for (let i = 0; i < token.length - 3; i += 2) tokens.add(token.slice(i, i + 4));
        }
    }
    return tokens;
}

function summarizePatchForMemory(patch, sourceText = '') {
    const parts = [];
    const scene = patchSceneWithSourceFacts(patch?.scene || {}, sourceText);
    for (const key of ['location', 'time', 'weather', 'lighting', 'mood', 'worldState']) {
        if (isUsefulText(scene[key])) parts.push(scene[key]);
    }
    for (const [name, charPatch] of Object.entries(patch?.characters || {})) {
        const details = ['appearance', 'currentOutfit', 'accessories', 'expression', 'pose', 'state']
            .map(key => charPatch?.[key])
            .filter(isUsefulText)
            .join('，');
        if (details) parts.push((name || getCurrentCharacterName()) + '：' + details);
    }
    const longTerm = patch?.longTerm || patch?.long_term || {};
    parts.push(...textArray(longTerm.visualNotes || longTerm.visual_notes || patch?.visualNotes || patch?.visual_notes || patch?.notes || []));
    return compactPreview(parts.filter(Boolean).join('；') || sourceText, 260);
}

function addVisualMemoryEvent(sourceText = '', patch = {}, source = 'memory') {
    const longTerm = ensureLongTermMemory();
    const summary = summarizePatchForMemory(patch, sourceText);
    if (!summary) return;
    const scene = patchSceneWithSourceFacts(patch?.scene || {}, sourceText);
    const charNames = Object.keys(patch?.characters || {}).filter(Boolean);
    const id = hashText([source, sourceText, summary].join('\n'));
    longTerm.visualEvents = (longTerm.visualEvents || []).filter(item => item.id !== id);
    const keywords = [...memoryTokens(sourceText, summary, scene.location, scene.time, scene.weather, charNames.join(' '))].slice(0, 80);
    longTerm.visualEvents.unshift({
        id,
        at: Date.now(),
        source,
        preview: compactPreview(sourceText, 220),
        summary,
        scene,
        characters: charNames,
        keywords,
    });
    longTerm.visualEvents = longTerm.visualEvents.slice(0, 160);
    rebuildVisualSummaryTree(longTerm);
}

function makeSummaryNode(level, items, index) {
    const summaries = items.map(item => item.summary || item.preview).filter(Boolean);
    const keywords = [...memoryTokens(...summaries, ...items.flatMap(item => item.keywords || []))].slice(0, 90);
    return {
        id: level + '-' + index + '-' + hashText(summaries.join('\n')).slice(0, 8),
        level,
        at: Math.max(...items.map(item => Number(item.at || 0)), 0),
        summary: compactPreview(summaries.join('；'), level === 'L1' ? 360 : 520),
        keywords,
        children: items.map(item => item.id).filter(Boolean).slice(0, 60),
    };
}

function chunkItems(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
}

function rebuildVisualSummaryTree(longTerm = ensureLongTermMemory()) {
    const events = longTerm.visualEvents || [];
    const l1 = chunkItems(events, 8).map((items, index) => makeSummaryNode('L1', items, index));
    const l2 = chunkItems(l1, 6).map((items, index) => makeSummaryNode('L2', items, index));
    const l3 = chunkItems(l2, 6).map((items, index) => makeSummaryNode('L3', items, index));
    longTerm.summaryTree = { l1: l1.slice(0, 40), l2: l2.slice(0, 16), l3: l3.slice(0, 8) };
}

function scoreMemoryItem(item, tokens, recencyWeight = 0.2) {
    const itemTokens = new Set(item.keywords || [...memoryTokens(item.summary, item.preview)]);
    let score = 0;
    for (const token of tokens) if (itemTokens.has(token)) score += token.length >= 4 ? 2 : 1;
    const ageHours = Math.max(0, (Date.now() - Number(item.at || 0)) / 36e5);
    return score + Math.max(0, 1 - ageHours / 168) * recencyWeight;
}

function retrieveRelevantMemories(selectedText = '', limit = 10) {
    const longTerm = ensureLongTermMemory();
    const tokens = memoryTokens(selectedText, getCurrentCharacterName(), ensureChatMemory().scene.location, ensureChatMemory().scene.time);
    const candidates = [
        ...(longTerm.summaryTree?.l3 || []).map(item => ({ ...item, kind: 'L3' })),
        ...(longTerm.summaryTree?.l2 || []).map(item => ({ ...item, kind: 'L2' })),
        ...(longTerm.summaryTree?.l1 || []).map(item => ({ ...item, kind: 'L1' })),
        ...(longTerm.visualEvents || []).map(item => ({ ...item, kind: 'event' })),
    ];
    const ranked = candidates
        .map(item => ({ item, score: scoreMemoryItem(item, tokens) }))
        .filter(entry => entry.score > 0 || !selectedText)
        .sort((a, b) => b.score - a.score || Number(b.item.at || 0) - Number(a.item.at || 0))
        .slice(0, limit)
        .map(entry => ({
            kind: entry.item.kind,
            score: Number(entry.score.toFixed(2)),
            summary: entry.item.summary || entry.item.preview || '',
            preview: entry.item.preview || '',
            scene: entry.item.scene || undefined,
            characters: entry.item.characters || undefined,
        }));
    return ranked;
}


function ensureStoryMemory() {
    const memory = ensureChatMemory();
    memory.story ||= {};
    memory.story.summary ||= '';
    memory.story.facts ||= [];
    memory.story.relationships ||= {};
    memory.story.openThreads ||= [];
    memory.story.characterStates ||= {};
    memory.story.entries ||= [];
    memory.story.summaryTree ||= { l1: [], l2: [], l3: [] };
    memory.story.summaryTree.l1 ||= [];
    memory.story.summaryTree.l2 ||= [];
    memory.story.summaryTree.l3 ||= [];
    memory.story.lastRetrieval ||= [];
    memory.story.lastInjectedPrompt ||= '';
    return memory.story;
}

function getStoryConfig() {
    const settings = ensureSettings();
    settings.storyMemory = deepMerge(DEFAULT_SETTINGS.storyMemory, settings.storyMemory || {});
    return settings.storyMemory;
}

function clampText(text, max = 1000) {
    const clean = normalizeMultiline(text || '');
    const limit = Math.max(80, Number(max) || 1000);
    return clean.length > limit ? clean.slice(0, limit - 12).trimEnd() + '\n...(截断)' : clean;
}

function stripGeneratedPromptText(text) {
    return normalizeMultiline(text)
        .replace(/\n{1,2}\[[A-Za-z0-9\s,.;:'"()_+\-\/\\|]+\]\s*$/g, '')
        .replace(/^\s*(scene_position|prompt|negative_prompt)\s*:\s*[^\n]*(?:\n|$)/gmi, '')
        .trim();
}

function looksLikePromptScaffold(text) {
    const clean = normalizeMultiline(text);
    const hits = [
        '剧情要求', '详略安排', '文笔要求', '补充要求', '增项检查', '创作预备',
        '生图处理', '正文模型禁止输出', 'JSON 格式', 'positive_prompt', 'negative_prompt',
        'scene_position', '不要输出任何图片标签', '基于历史对话',
    ].filter(term => clean.includes(term)).length;
    return hits >= 2 || /^\s*(prompt|negative_prompt|scene_position)\s*:/mi.test(clean);
}

function isStoryIndexableText(text) {
    const clean = stripGeneratedPromptText(text);
    if (clean.length < 12) return false;
    if (looksLikePromptScaffold(clean)) return false;
    return true;
}

function getMessageRole(message) {
    if (message?.is_user) return 'user';
    if (message?.is_system) return 'system';
    return 'assistant';
}

function getMessageSpeaker(message) {
    return normalizeLine(message?.name || (message?.is_user ? 'user' : getCurrentCharacterName()));
}

function extractImportantStoryLines(text, pattern, limit = 5) {
    const clean = normalizeMultiline(text);
    const lines = clean
        .split(/(?<=[。！？!?])\s*|\n+/)
        .map(line => normalizeLine(line))
        .filter(line => line.length >= 8 && line.length <= 180);
    return uniqueParts(lines.filter(line => pattern.test(line))).slice(0, limit);
}

function createStoryEntry(text, source = 'message', index = null, patch = {}) {
    const cfg = getStoryConfig();
    const clean = stripGeneratedPromptText(text);
    const message = Number.isInteger(Number(index)) ? chat?.[Number(index)] : null;
    const id = patch.id || hashText([getCurrentChatId?.() || '', Number.isInteger(Number(index)) ? Number(index) : '', clean].join('\n'));
    const summary = normalizeLine(patch.summary || patch.entrySummary || compactPreview(clean, 260));
    return {
        id,
        at: Number(patch.at || Date.now()),
        index: Number.isInteger(Number(index)) ? Number(index) : null,
        role: patch.role || getMessageRole(message),
        name: patch.name || getMessageSpeaker(message),
        source,
        summary,
        text: clampText(patch.text || patch.original || clean, cfg.maxEntryChars),
        keywords: uniqueParts([...(patch.keywords || []), ...memoryTokens(clean, summary)].map(String)).slice(0, 90),
        importance: Number.isFinite(Number(patch.importance)) ? Number(patch.importance) : 0.5,
    };
}

function storyPatchFromLocal(text, source = 'message', index = null) {
    const clean = stripGeneratedPromptText(text);
    const factPattern = /(设定|身份|名字|叫|来自|属于|规则|不能|必须|曾经|过去|契约|秘密|真相|目标|任务|约定|承诺|关系|喜欢|讨厌|害怕|信任|背叛|死亡|受伤|发现|知道|记得|忘记|原因|因为|所以|世界|组织|地点|家族|能力|魔法|天使|恶魔|决定|选择)/;
    const threadPattern = /(还没|尚未|准备|打算|决定|将要|之后|接下来|寻找|调查|等待|疑问|为什么|怎么办|是否|能否|没有解决|留下|伏笔|\?|？)/;
    return {
        confidence: 0.45,
        facts: extractImportantStoryLines(clean, factPattern, 4),
        openThreads: extractImportantStoryLines(clean, threadPattern, 4),
        entry: createStoryEntry(clean, source, index),
    };
}

function sanitizeStoryEntry(entry) {
    const cfg = getStoryConfig();
    const cleanText = clampText(entry.text || entry.original || entry.preview || '', cfg.maxEntryChars);
    const summary = normalizeLine(entry.summary || compactPreview(cleanText, 260));
    return {
        id: entry.id || hashText([entry.index ?? '', summary, cleanText].join('\n')),
        at: Number(entry.at || Date.now()),
        index: Number.isInteger(Number(entry.index)) ? Number(entry.index) : null,
        role: entry.role || 'assistant',
        name: normalizeLine(entry.name || ''),
        source: entry.source || 'story',
        summary,
        text: cleanText,
        keywords: uniqueParts([...(entry.keywords || []), ...memoryTokens(summary, cleanText)].map(String)).slice(0, 90),
        importance: Number.isFinite(Number(entry.importance)) ? Number(entry.importance) : 0.5,
    };
}

function mergeNamedMemoryMap(target, patch) {
    if (!patch || typeof patch !== 'object') return target;
    for (const [name, value] of Object.entries(patch)) {
        if (!normalizeLine(name)) continue;
        if (typeof value === 'string') target[name] = normalizeLine(value);
        else if (value && typeof value === 'object') target[name] = normalizeLine(Object.entries(value).map(([key, item]) => key + ': ' + item).join('；'));
    }
    return target;
}

function applyStoryMemoryPatch(patch, sourceText = '', source = 'story', index = null, options = {}) {
    if (!patch || typeof patch !== 'object') return;
    const confidence = Number(patch.confidence ?? 0.5);
    if (confidence < 0.25) return;
    const cfg = getStoryConfig();
    const story = ensureStoryMemory();
    const summary = patch.summary || patch.storySummary || patch.longTermSummary;
    if (isUsefulText(summary)) story.summary = normalizeLine(summary);
    story.facts = pushUniqueLimited(story.facts || [], patch.facts || patch.keyFacts || [], 160);
    story.openThreads = pushUniqueLimited(story.openThreads || [], patch.openThreads || patch.threads || patch.unresolved || [], 120);
    story.relationships ||= {};
    story.characterStates ||= {};
    mergeNamedMemoryMap(story.relationships, patch.relationships || {});
    mergeNamedMemoryMap(story.characterStates, patch.characterStates || patch.characters || {});

    const clean = stripGeneratedPromptText(sourceText);
    if (clean || patch.entry) {
        const entry = sanitizeStoryEntry({ ...createStoryEntry(clean, source, index, patch.entry || {}), ...(patch.entry || {}) });
        story.entries = (story.entries || []).filter(item => item.id !== entry.id);
        story.entries.unshift(entry);
        story.entries = story.entries.slice(0, Math.max(50, Number(cfg.maxEntries) || 500));
    }

    rebuildStorySummaryTree(story);
    updateStoryMemoryInjection();
    if (!options.deferRender) renderStoryMemoryFields();
    if (!options.deferSave) saveAll();
}

function rebuildStorySummaryTree(story = ensureStoryMemory()) {
    const entries = story.entries || [];
    const l1 = chunkItems(entries, 10).map((items, index) => makeSummaryNode('L1', items, index));
    const l2 = chunkItems(l1, 6).map((items, index) => makeSummaryNode('L2', items, index));
    const l3 = chunkItems(l2, 6).map((items, index) => makeSummaryNode('L3', items, index));
    story.summaryTree = { l1: l1.slice(0, 60), l2: l2.slice(0, 24), l3: l3.slice(0, 10) };
}

function formatNamedMemoryMap(map, limit = 24) {
    return Object.entries(map || {})
        .filter(([name, value]) => normalizeLine(name) && isUsefulText(String(value)))
        .slice(0, limit)
        .map(([name, value]) => name + '：' + normalizeLine(typeof value === 'string' ? value : JSON.stringify(value)))
        .join('\n');
}

function parseNamedMemoryLines(text) {
    const output = {};
    for (const line of String(text || '').split(/\n+/)) {
        const clean = normalizeLine(line);
        if (!clean) continue;
        const match = clean.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
        if (match) output[match[1].trim()] = match[2].trim();
    }
    return output;
}

function buildStoryMemoryApiContext() {
    const story = ensureStoryMemory();
    return {
        summary: story.summary,
        facts: (story.facts || []).slice(0, 30),
        relationships: story.relationships || {},
        openThreads: (story.openThreads || []).slice(0, 30),
        characterStates: story.characterStates || {},
        recentEntries: (story.entries || []).slice(0, 12).map(item => ({ name: item.name, role: item.role, summary: item.summary })),
    };
}

async function analyzeStoryMemoryPatch(text, source = 'message', index = null) {
    const settings = ensureSettings();
    const cfg = getStoryConfig();
    if (!settings.api.enabled || !settings.api.url || !cfg.useApiSummary) return null;
    const clean = stripGeneratedPromptText(text);
    if (!isStoryIndexableText(clean)) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(2500, settings.api.timeoutMs || 12000));
    const body = {
        model: settings.api.model || undefined,
        temperature: Number(settings.api.temperature ?? 0.1),
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: [
                    '你是 SillyTavern 角色扮演/小说创作的长期剧情记忆整理器。',
                    '只整理已经发生或已经明确设定的内容，返回严格 JSON，不要续写剧情，不要解释。',
                    '目标是防止后续正文生成吃设定：保留人物身份、世界规则、前因后果、关系变化、承诺、秘密、目标、未解决伏笔。',
                    '不要记录临时画面细节，如当前服装、光线、姿势，除非它们成为剧情设定。不要记录系统提示、写作要求、prompt、negative_prompt。',
                    'summary 是当前长期剧情状态的一段短摘要；facts 是稳定事实；relationships 是人物关系；openThreads 是未解决目标/伏笔；characterStates 是持续性心理/立场/伤势/能力状态。',
                    'entry.summary 是这条新增文本的剧情摘要，keywords 是用于检索的中文关键词。',
                    'JSON 格式: {"confidence":0-1,"summary":"","facts":[],"relationships":{},"openThreads":[],"characterStates":{},"entry":{"summary":"","importance":0-1,"keywords":[]}}',
                ].join('\n'),
            },
            {
                role: 'user',
                content: JSON.stringify({
                    currentStoryMemory: buildStoryMemoryApiContext(),
                    newText: clean,
                    source,
                    index,
                    currentCharacter: getCurrentCharacterName(),
                    world: ensureSettings().memory.world,
                }),
            },
        ],
    };
    try {
        const response = await fetch(normalizeApiUrl(settings.api.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(settings.api.key ? { Authorization: 'Bearer ' + settings.api.key } : {}) },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error('story memory API ' + response.status);
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? data;
        return parsePatchContent(content);
    } finally {
        clearTimeout(timeout);
    }
}

function enqueueStoryIndex(text, source = 'message', index = null) {
    const settings = ensureSettings();
    const cfg = getStoryConfig();
    const clean = stripGeneratedPromptText(text);
    if (!cfg.enabled || !cfg.autoIndex || !isStoryIndexableText(clean)) return;
    const hash = hashText([getCurrentChatId?.() || '', Number.isInteger(Number(index)) ? Number(index) : source, clean].join('\n'));
    const memory = ensureChatMemory();
    if (memory.runtime.lastStoryHash === hash) return;
    memory.runtime.lastStoryHash = hash;
    applyStoryMemoryPatch(storyPatchFromLocal(clean, source, index), clean, source, index, { deferRender: true, deferSave: true });
    updateStoryMemoryInjection();
    saveAll();
    if (settings.api.enabled && settings.api.url && cfg.useApiSummary) {
        state.storyAnalyzerQueue.push({ text: clean, source, index, hash });
        runStoryAnalyzerQueue();
    }
}

async function runStoryAnalyzerQueue() {
    if (state.storyAnalyzerRunning) return;
    state.storyAnalyzerRunning = true;
    try {
        while (state.storyAnalyzerQueue.length) {
            const item = state.storyAnalyzerQueue.shift();
            try {
                const patch = await analyzeStoryMemoryPatch(item.text, item.source, item.index);
                if (patch) applyStoryMemoryPatch(patch, item.text, item.source + ':api', item.index);
            } catch (error) {
                console.warn('[' + EXT_NAME + '] story memory analysis failed', error);
            }
        }
    } finally {
        state.storyAnalyzerRunning = false;
        renderStoryMemoryFields();
    }
}

function retrieveStoryMemories(query = '', limit = getStoryConfig().maxRetrieved || 8) {
    const story = ensureStoryMemory();
    const tokens = memoryTokens(query, getCurrentCharacterName(), story.summary, (story.facts || []).slice(0, 12).join(' '));
    const latestIndex = Math.max(0, (chat || []).length - 1);
    const candidates = [
        ...(story.summaryTree?.l3 || []).map(item => ({ ...item, kind: 'L3' })),
        ...(story.summaryTree?.l2 || []).map(item => ({ ...item, kind: 'L2' })),
        ...(story.summaryTree?.l1 || []).map(item => ({ ...item, kind: 'L1' })),
        ...(story.entries || []).filter(item => Number(item.index) !== latestIndex).map(item => ({ ...item, kind: '原文' })),
    ];
    let ranked = candidates
        .map(item => ({ item, score: scoreMemoryItem(item, tokens, 0.08) }))
        .filter(entry => entry.score > 0 || !query)
        .sort((a, b) => b.score - a.score || Number(b.item.at || 0) - Number(a.item.at || 0))
        .slice(0, Math.max(1, Number(limit) || 8))
        .map(entry => ({
            kind: entry.item.kind,
            score: Number(entry.score.toFixed(2)),
            summary: entry.item.summary || entry.item.preview || '',
            text: entry.item.text || entry.item.preview || '',
            name: entry.item.name || '',
            role: entry.item.role || '',
            index: entry.item.index ?? null,
        }));
    if (!ranked.length) {
        ranked = (story.entries || [])
            .filter(item => Number(item.index) !== latestIndex)
            .slice(0, Math.max(1, Number(limit) || 8))
            .map(item => ({ kind: '原文', score: 0, summary: item.summary, text: item.text, name: item.name, role: item.role, index: item.index ?? null }));
    }
    const seen = new Set();
    ranked = ranked.filter(item => {
        const key = normalizeLine(item.summary || item.text).slice(0, 120);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    story.lastRetrieval = ranked;
    return ranked;
}

function getLatestStoryQuery() {
    const recent = (chat || [])
        .slice(-6)
        .map(message => stripGeneratedPromptText(getMessageText(message)))
        .filter(Boolean)
        .join('\n\n');
    return recent || getCurrentCharacterName();
}

function buildStoryMemoryPrompt(query = '') {
    const cfg = getStoryConfig();
    if (!cfg.enabled || !cfg.injectToPrompt) return '';
    const story = ensureStoryMemory();
    const hasMemory = story.summary || (story.facts || []).length || (story.entries || []).length || Object.keys(story.relationships || {}).length;
    if (!hasMemory) return '';
    const retrieved = retrieveStoryMemories(query || getLatestStoryQuery(), cfg.maxRetrieved);
    const lines = [
        '[剧情长期记忆]',
        '用途：保持角色设定、世界规则、前文因果、关系变化和未解决伏笔一致；只在相关时自然使用，不要声明你读取了记忆。',
    ];
    if (story.summary) lines.push('长期摘要：' + story.summary);
    if ((story.facts || []).length) lines.push('关键设定：\n- ' + story.facts.slice(0, 18).join('\n- '));
    const relationshipLines = formatNamedMemoryMap(story.relationships, 16);
    if (relationshipLines) lines.push('人物关系：\n' + relationshipLines.split('\n').map(line => '- ' + line).join('\n'));
    const stateLines = formatNamedMemoryMap(story.characterStates, 16);
    if (stateLines) lines.push('持续状态：\n' + stateLines.split('\n').map(line => '- ' + line).join('\n'));
    if ((story.openThreads || []).length) lines.push('未解决伏笔/目标：\n- ' + story.openThreads.slice(0, 14).join('\n- '));
    if (retrieved.length) {
        lines.push('相关旧剧情：');
        for (const item of retrieved.slice(0, cfg.maxRetrieved)) {
            const prefix = item.index !== null && item.index !== undefined ? '#' + item.index + ' ' : '';
            const original = cfg.includeOriginal && item.text ? '；原文片段：' + compactPreview(item.text, 180) : '';
            lines.push('- ' + prefix + compactPreview(item.summary, 220) + original);
        }
    }
    lines.push('[/剧情长期记忆]');
    const prompt = clampText(lines.join('\n'), cfg.maxInjectChars);
    story.lastInjectedPrompt = prompt;
    return prompt;
}

function clearStoryMemoryInjection() {
    try {
        setExtensionPrompt(STORY_MEMORY_PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
    } catch (error) {
        console.warn('[' + EXT_NAME + '] clear story injection failed', error);
    }
}

function updateStoryMemoryInjection(query = '') {
    const cfg = getStoryConfig();
    if (!cfg.enabled || !cfg.injectToPrompt) {
        clearStoryMemoryInjection();
        return '';
    }
    const prompt = buildStoryMemoryPrompt(query || getLatestStoryQuery());
    try {
        setExtensionPrompt(
            STORY_MEMORY_PROMPT_KEY,
            prompt,
            extension_prompt_types.IN_CHAT,
            Math.max(0, Number(cfg.injectDepth) || 0),
            false,
            extension_prompt_roles.SYSTEM,
        );
    } catch (error) {
        console.warn('[' + EXT_NAME + '] update story injection failed', error);
    }
    return prompt;
}

function indexExistingStoryMemory(options = {}) {
    const cfg = getStoryConfig();
    if (!cfg.enabled) return 0;
    const story = ensureStoryMemory();
    const existing = new Map((story.entries || []).map(item => [item.id, item]));
    const rows = (chat || [])
        .map((message, index) => ({ message, index, text: stripGeneratedPromptText(getMessageText(message)) }))
        .filter(item => item.text && !item.message?.is_system && isStoryIndexableText(item.text));
    for (const item of rows) {
        const entry = createStoryEntry(item.text, 'backfill', item.index);
        existing.set(entry.id, { ...(existing.get(entry.id) || {}), ...entry });
    }
    story.entries = [...existing.values()]
        .sort((a, b) => Number(b.index ?? -1) - Number(a.index ?? -1) || Number(b.at || 0) - Number(a.at || 0))
        .slice(0, Math.max(50, Number(cfg.maxEntries) || 500));
    if (!story.summary && story.entries.length) {
        story.summary = compactPreview(story.entries.slice(0, 12).reverse().map(item => item.summary).join('；'), 620);
    }
    rebuildStorySummaryTree(story);
    updateStoryMemoryInjection();
    renderStoryMemoryFields();
    saveAll();
    if (!options.silent) setStatus('已回溯索引当前聊天 ' + rows.length + ' 条剧情记忆');
    return rows.length;
}

function readStorySettingsFromForm(root) {
    if (!root) return;
    const cfg = getStoryConfig();
    const bool = (name, fallback) => root.querySelector('[name="' + name + '"]')?.checked ?? fallback;
    const num = (name, fallback, min = 0) => Math.max(min, Number(root.querySelector('[name="' + name + '"]')?.value || fallback));
    cfg.enabled = bool('storyMemory.enabled', cfg.enabled);
    cfg.autoIndex = bool('storyMemory.autoIndex', cfg.autoIndex);
    cfg.injectToPrompt = bool('storyMemory.injectToPrompt', cfg.injectToPrompt);
    cfg.includeOriginal = bool('storyMemory.includeOriginal', cfg.includeOriginal);
    cfg.useApiSummary = bool('storyMemory.useApiSummary', cfg.useApiSummary);
    cfg.injectDepth = num('storyMemory.injectDepth', cfg.injectDepth, 0);
    cfg.maxRetrieved = num('storyMemory.maxRetrieved', cfg.maxRetrieved, 1);
    cfg.maxInjectChars = num('storyMemory.maxInjectChars', cfg.maxInjectChars, 400);
    cfg.maxEntries = num('storyMemory.maxEntries', cfg.maxEntries, 50);
}

function readStoryMemoryFromForm(root) {
    if (!root) return;
    const story = ensureStoryMemory();
    const summary = root.querySelector('[name="story.summary"]');
    if (!summary) return;
    story.summary = summary.value.trim();
    story.facts = textArray(root.querySelector('[name="story.facts"]')?.value || '').slice(0, 160);
    story.openThreads = textArray(root.querySelector('[name="story.openThreads"]')?.value || '').slice(0, 120);
    story.relationships = parseNamedMemoryLines(root.querySelector('[name="story.relationships"]')?.value || '');
    story.characterStates = parseNamedMemoryLines(root.querySelector('[name="story.characterStates"]')?.value || '');
    updateStoryMemoryInjection();
}

function renderStoryMemoryFields() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    if (!root) return;
    const cfg = getStoryConfig();
    const story = ensureStoryMemory();
    const setChecked = (name, value) => {
        const el = root.querySelector('[name="' + name + '"]');
        if (el) el.checked = Boolean(value);
    };
    setChecked('storyMemory.enabled', cfg.enabled);
    setChecked('storyMemory.autoIndex', cfg.autoIndex);
    setChecked('storyMemory.injectToPrompt', cfg.injectToPrompt);
    setChecked('storyMemory.includeOriginal', cfg.includeOriginal);
    setChecked('storyMemory.useApiSummary', cfg.useApiSummary);
    setValue(root, 'storyMemory.injectDepth', cfg.injectDepth);
    setValue(root, 'storyMemory.maxRetrieved', cfg.maxRetrieved);
    setValue(root, 'storyMemory.maxInjectChars', cfg.maxInjectChars);
    setValue(root, 'storyMemory.maxEntries', cfg.maxEntries);
    setValue(root, 'story.summary', story.summary || '');
    setValue(root, 'story.facts', Array.isArray(story.facts) ? story.facts.join('\n') : '');
    setValue(root, 'story.openThreads', Array.isArray(story.openThreads) ? story.openThreads.join('\n') : '');
    setValue(root, 'story.relationships', formatNamedMemoryMap(story.relationships));
    setValue(root, 'story.characterStates', formatNamedMemoryMap(story.characterStates));
    const stats = root.querySelector('[data-role="story-stats"]');
    if (stats) {
        const tree = story.summaryTree || {};
        const injectedLength = (story.lastInjectedPrompt || buildStoryMemoryPrompt(getLatestStoryQuery()) || '').length;
        stats.textContent = '已索引 ' + (story.entries || []).length + ' 条；L1 ' + (tree.l1 || []).length + ' / L2 ' + (tree.l2 || []).length + ' / L3 ' + (tree.l3 || []).length + '；注入 ' + injectedLength + ' 字';
    }
    const retrieval = root.querySelector('[data-role="story-retrieval"]');
    if (retrieval) {
        const items = story.lastRetrieval?.length ? story.lastRetrieval : retrieveStoryMemories(getLatestStoryQuery(), cfg.maxRetrieved);
        retrieval.value = items.map(item => (item.index !== null && item.index !== undefined ? '#' + item.index + ' ' : '') + '[' + item.kind + '] ' + item.summary).join('\n');
    }
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

function hasCjk(text) {
    return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function englishTagsFromText(text) {
    const tags = [];
    for (const [pattern, tag] of CN_TO_TAG) {
        if (pattern.test(text)) tags.push(tag);
        pattern.lastIndex = 0;
    }
    return uniqueParts(tags).join(', ');
}

function englishSceneTags(scene) {
    return joinPrompt([
        englishTagsFromText([scene.location, scene.time, scene.weather, scene.lighting, scene.outfit, scene.expression, scene.action, scene.props].join(' ')),
        scene.camera,
        scene.mood,
    ]);
}

function promptPart(value, englishOnly = false) {
    const clean = normalizeLine(value);
    if (!clean) return '';
    if (!englishOnly) return clean;
    const tags = englishTagsFromText(clean);
    if (tags) return tags;
    return hasCjk(clean) ? '' : clean;
}

function cleanEnglishPrompt(text) {
    return joinPrompt(normalizePromptText(text).split(',').filter(part => !hasCjk(part)));
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

    const weatherMatch = clean.match(/(下雨|雨中|雨夜|暴雨|小雨|下雪|雪中|雪夜|大雪|雾|薄雾|晴朗|阴天|雷雨|风很大)/);
    if (weatherMatch) result.weather = normalizeWeatherFromText(weatherMatch[1]);

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
    const longTerm = chatMemory.longTerm || {};
    const visualNotes = Array.isArray(longTerm.visualNotes) ? longTerm.visualNotes.slice(0, 6).join(', ') : '';
    const englishOnly = settings.behavior.promptLanguage === 'en';
    const translatedInput = settings.behavior.promptLanguage === 'zh'
        ? inputText
        : englishOnly
            ? englishSceneTags(localScene)
            : translateKnownTags(inputText);
    const promptName = englishOnly && hasCjk(name) ? '' : name;

    const positive = joinPrompt([
        settings.prompt.positivePrefix,
        settings.prompt.quality,
        style,
        settings.memory.world.visualStyle,
        settings.memory.world.genre,
        settings.memory.world.rules,
        promptName,
        promptPart(charMemory.appearance, englishOnly),
        promptPart(charMemory.accessories, englishOnly),
        promptPart(outfit, englishOnly),
        promptPart(charMemory.state, englishOnly),
        promptPart(visualNotes, englishOnly),
        promptPart(sceneLocation, englishOnly),
        promptPart(sceneTime, englishOnly),
        promptPart(sceneWeather, englishOnly),
        promptPart(sceneLighting, englishOnly),
        promptPart(sceneMood, englishOnly),
        promptPart(localScene.props, englishOnly),
        promptPart(expression, englishOnly),
        promptPart(pose, englishOnly),
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
    const currentMemory = buildVisualMemoryContext(text);
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
                    '同时维护长期记忆：summary 用一句话概括当前长期剧情状态；facts 保存不会轻易改变的事实；relationships 保存人物关系；visualNotes 保存会影响画面的稳定视觉线索。',
                    '把当前片段可用于未来出图稳定性的内容写进 visualNotes 或 characters/scene；后端会把它压入视觉事件记忆树。',
                    'JSON 格式: {"confidence":0-1,"scene":{},"characters":{"角色名":{}},"world":{},"longTerm":{"summary":"","facts":[],"relationships":{},"visualNotes":[]},"notes":[]}',
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

function normalizeModelsUrl(url) {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    if (/\/models$/.test(clean)) return clean;
    if (/\/chat\/completions$/.test(clean)) return clean.replace(/\/chat\/completions$/, '/models');
    if (/\/v1$/.test(clean)) return clean + '/models';
    return clean + '/v1/models';
}

async function refreshApiModels() {
    readFormToSettings();
    const settings = ensureSettings();
    if (!settings.api.url) {
        setStatus('请先填写 API 地址');
        return [];
    }
    setStatus('正在读取 API 模型列表');
    const response = await fetch(normalizeModelsUrl(settings.api.url), {
        headers: {
            ...(settings.api.key ? { Authorization: 'Bearer ' + settings.api.key } : {}),
        },
    });
    if (!response.ok) throw new Error('models API ' + response.status);
    const data = await response.json();
    const models = Array.isArray(data?.data)
        ? data.data.map(item => item?.id || item?.name).filter(Boolean)
        : Array.isArray(data)
            ? data.map(item => item?.id || item?.name || item).filter(Boolean)
            : [];
    settings.api.models = uniqueParts(models.map(String)).sort();
    if (!settings.api.model && settings.api.models.length) settings.api.model = settings.api.models[0];
    renderModelOptions();
    fillFormFromSettings();
    saveAll();
    setStatus(settings.api.models.length ? '已读取 ' + settings.api.models.length + ' 个模型' : '没有读取到模型');
    return settings.api.models;
}

async function analyzeScenePrompt(text) {
    const settings = ensureSettings();
    if (!settings.api.enabled || !settings.api.url) throw new Error('API not enabled');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(3000, settings.api.timeoutMs || 12000));
    const localScene = extractSceneLocal(text);
    const currentMemory = buildVisualMemoryContext(text);
    const body = {
        model: settings.api.model || undefined,
        temperature: Number(settings.api.temperature ?? 0.1),
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: [
                    '你是 SillyTavern 的智能文生图导演。',
                    '任务：根据用户选中的剧情段落、现有视觉记忆和本地抽取结果，生成可直接给 ComfyUI/Stable Diffusion 使用的英文提示词，并返回可合并的视觉记忆补丁。',
                    '只返回严格 JSON，不要解释，不要 Markdown。',
                    'positive_prompt 必须是英文逗号分隔标签，不要中文，不要方括号。',
                    'negative_prompt 必须是英文逗号分隔标签。',
                    '角色外观、衣服、地点、时间、光线、动作、表情、镜头必须尽量从剧情和记忆中保留一致。',
                    '只能画 selectedText 当前可见的这一幕；不要把系统提示、剧情规划、思考路线、写作要求、后续安排画进提示词。',
                    '如果 selectedText 很短，只用记忆补足角色外观、当前服装和地点时间，不要擅自改剧情动作。',
                    '如果剧情出现换衣服、换地点、时间/天气/光线改变，写入 memory_patch。',
                    '不要覆盖永久外观，除非文本明确给出稳定设定。',
                    'currentMemory.retrieved 是从视觉事件记忆树检索出的相关 L3/L2/L1/原文事件摘要，优先用于保持角色、地点、服装和世界观一致。',
                    'memory_patch 可包含 longTerm: {summary, facts, relationships, visualNotes}，用于下次稳定角色、地点、关系和世界观。',
                    'JSON 格式：{"positive_prompt":"...","negative_prompt":"...","shot_card":"...","memory_patch":{"confidence":0-1,"scene":{},"characters":{},"world":{},"longTerm":{"summary":"","facts":[],"relationships":{},"visualNotes":[]},"notes":[]}}',
                ].join('\n'),
            },
            {
                role: 'user',
                content: JSON.stringify({ selectedText: text, currentCharacter: getCurrentCharacterName(), localScene, currentMemory, stylePreset: settings.prompt.stylePreset, quality: settings.prompt.quality, camera: settings.prompt.camera, positivePrefix: settings.prompt.positivePrefix, baseNegative: settings.prompt.negative }),
            },
        ],
    };
    try {
        const response = await fetch(normalizeApiUrl(settings.api.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(settings.api.key ? { Authorization: 'Bearer ' + settings.api.key } : {}) },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error('API ' + response.status);
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? data;
        const parsed = parsePatchContent(content);
        return {
            positive: normalizePromptText(parsed.positive_prompt || parsed.positive || ''),
            negative: normalizePromptText(parsed.negative_prompt || parsed.negative || ''),
            shotCard: String(parsed.shot_card || parsed.shotCard || '').trim(),
            localScene,
            memoryPatch: parsed.memory_patch || parsed.memoryPatch || parsed.patch || null,
            source: 'api',
        };
    } finally {
        clearTimeout(timeout);
    }
}

function normalizePromptText(text) {
    return String(text || '')
        .replace(/[\[\]]/g, '')
        .replace(/\s*[,，]\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .replace(/^,+|,+$/g, '')
        .trim();
}

function normalizeWeatherFromText(value) {
    const text = String(value || '');
    if (/雨夜|雨中|下雨|暴雨|小雨|雷雨/.test(text)) return '下雨';
    if (/雪夜|雪中|下雪|大雪/.test(text)) return '下雪';
    return normalizeLine(text);
}

function patchSceneWithSourceFacts(scene, sourceText) {
    const next = { ...(scene || {}) };
    const text = String(sourceText || '');
    if (/雨夜|雨中|下雨|暴雨|小雨|雷雨/.test(text)) next.weather = '下雨';
    if (/雪夜|雪中|下雪|大雪/.test(text)) next.weather = '下雪';
    return next;
}

function buildChatu8Trigger(positive) {
    const settings = ensureSettings();
    const clean = (settings.behavior.promptLanguage === 'en' ? cleanEnglishPrompt(positive) : normalizePromptText(positive)).trim();
    if (!settings.chatu8?.enabled) return clean;
    const start = String(settings.chatu8?.startTag || '[').trim() || '[';
    const end = String(settings.chatu8?.endTag || ']').trim() || ']';
    return (start + clean + end).trim();
}

async function buildSmartPrompt(text) {
    const local = compilePrompt(text);
    const settings = ensureSettings();
    if (settings.api.enabled && settings.api.url) {
        try {
            const smart = await analyzeScenePrompt(text);
            return { positive: smart.positive || local.positive, negative: smart.negative || local.negative, shotCard: smart.shotCard || local.shotCard, localScene: smart.localScene || local.localScene, memoryPatch: smart.memoryPatch, source: smart.source };
        } catch (error) {
            console.warn('[' + EXT_NAME + '] smart prompt API failed, falling back', error);
            setStatus('API 失败，已使用本地规则: ' + error.message);
        }
    }
    return { ...local, source: 'local' };
}

function applyMemoryPatch(patch, sourceText = '', source = 'api') {
    if (!patch || typeof patch !== 'object') return;
    const confidence = Number(patch.confidence ?? 0.5);
    if (confidence < 0.35) return;
    const settings = ensureSettings();
    const memory = ensureChatMemory();
    const scene = patchSceneWithSourceFacts(patch.scene || {}, sourceText);
    for (const key of ['location', 'time', 'weather', 'lighting', 'mood', 'worldState']) {
        if (isUsefulText(scene[key])) memory.scene[key] = normalizeLine(scene[key]);
    }
    mergeLongTermMemory(patch, sourceText);
    addVisualMemoryEvent(sourceText, patch, source);
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
    const modelSelect = root.querySelector('[name="api.modelSelect"]');
    const modelInput = root.querySelector('[name="api.model"]');
    const selectedModel = modelSelect?.value || '';
    settings.api.model = selectedModel && selectedModel !== '__manual__'
        ? selectedModel
        : (modelInput?.value || '').trim();
    settings.api.timeoutMs = Number(root.querySelector('[name="api.timeoutMs"]').value || 12000);
    settings.api.temperature = Number(root.querySelector('[name="api.temperature"]').value || 0.1);
    settings.behavior.autoMemory = root.querySelector('[name="behavior.autoMemory"]').checked;
    settings.behavior.syncTavernHelper = root.querySelector('[name="behavior.syncTavernHelper"]').checked;
    settings.behavior.allowPermanentOverwrite = root.querySelector('[name="behavior.allowPermanentOverwrite"]').checked;
    settings.behavior.promptLanguage = root.querySelector('[name="behavior.promptLanguage"]').value;
    settings.behavior.preferClipboard = root.querySelector('[name="behavior.preferClipboard"]')?.checked ?? true;
    settings.chatu8.enabled = root.querySelector('[name="chatu8.enabled"]')?.checked ?? true;
    settings.chatu8.insertToChatInput = root.querySelector('[name="chatu8.insertToChatInput"]')?.checked ?? true;
    settings.chatu8.startTag = root.querySelector('[name="chatu8.startTag"]')?.value || '[';
    settings.chatu8.endTag = root.querySelector('[name="chatu8.endTag"]')?.value || ']';
    readStorySettingsFromForm(root);
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
    chatMemory.longTerm = ensureLongTermMemory();
    chatMemory.longTerm.summary = root.querySelector('[name="memory.summary"]')?.value.trim() || '';
    chatMemory.longTerm.facts = textArray(root.querySelector('[name="memory.facts"]')?.value || '').slice(0, 80);
    chatMemory.longTerm.visualNotes = textArray(root.querySelector('[name="memory.visualNotes"]')?.value || '').slice(0, 60);
    readStoryMemoryFromForm(root);
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
    const longTerm = ensureLongTermMemory();
    setValue(root, 'memory.summary', longTerm.summary || '');
    setValue(root, 'memory.facts', Array.isArray(longTerm.facts) ? longTerm.facts.join('\n') : '');
    setValue(root, 'memory.visualNotes', Array.isArray(longTerm.visualNotes) ? longTerm.visualNotes.join('\n') : '');
    for (const key of ['name', 'genre', 'rules', 'visualStyle', 'negativeRules']) {
        setValue(root, `world.${key}`, settings.memory.world[key] || '');
    }
    renderRecentMessages();
    renderHistory();
    renderStoryMemoryFields();
}

function setValue(root, name, value) {
    const el = root.querySelector(`[name="${name}"]`);
    if (el) el.value = value ?? '';
}

function renderModelOptions() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    if (!root) return;
    const settings = ensureSettings();
    const select = root.querySelector('[name="api.modelSelect"]');
    if (!select) return;
    const models = settings.api.models || [];
    const current = settings.api.model || '';
    const hasCurrent = current && models.includes(current);
    const options = [
        '<option value="__manual__">手动填写模型</option>',
        ...models.map(model => '<option value="' + escapeHtml(model) + '">' + escapeHtml(model) + '</option>'),
    ];
    if (current && !hasCurrent) {
        options.splice(1, 0, '<option value="' + escapeHtml(current) + '">' + escapeHtml(current) + '（当前）</option>');
    }
    select.innerHTML = options.join('');
    select.value = hasCurrent || current ? current : '__manual__';
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
    renderModelOptions();
    const root = document.querySelector(SETTINGS_SELECTOR);
    if (!root) return;
    const settings = ensureSettings();
    root.querySelector('[name="api.enabled"]').checked = settings.api.enabled;
    root.querySelector('[name="api.url"]').value = settings.api.url;
    root.querySelector('[name="api.key"]').value = settings.api.key;
    root.querySelector('[name="api.model"]').value = settings.api.model;
    const modelSelect = root.querySelector('[name="api.modelSelect"]');
    if (modelSelect) {
        const models = settings.api.models || [];
        modelSelect.value = settings.api.model && models.includes(settings.api.model) ? settings.api.model : '__manual__';
    }
    root.querySelector('[name="api.timeoutMs"]').value = settings.api.timeoutMs;
    root.querySelector('[name="api.temperature"]').value = settings.api.temperature;
    root.querySelector('[name="behavior.autoMemory"]').checked = settings.behavior.autoMemory;
    root.querySelector('[name="behavior.syncTavernHelper"]').checked = settings.behavior.syncTavernHelper;
    root.querySelector('[name="behavior.allowPermanentOverwrite"]').checked = settings.behavior.allowPermanentOverwrite;
    root.querySelector('[name="behavior.promptLanguage"]').value = settings.behavior.promptLanguage;
    const preferClipboard = root.querySelector('[name="behavior.preferClipboard"]');
    if (preferClipboard) preferClipboard.checked = settings.behavior.preferClipboard;
    const chatu8Enabled = root.querySelector('[name="chatu8.enabled"]');
    if (chatu8Enabled) chatu8Enabled.checked = settings.chatu8.enabled;
    const chatu8Insert = root.querySelector('[name="chatu8.insertToChatInput"]');
    if (chatu8Insert) chatu8Insert.checked = settings.chatu8.insertToChatInput;
    setValue(root, 'chatu8.startTag', settings.chatu8.startTag);
    setValue(root, 'chatu8.endTag', settings.chatu8.endTag);
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
                        <button class="menu_button csid-tab" data-tab="memory">视觉记忆</button>
                        <button class="menu_button csid-tab" data-tab="story">剧情记忆</button>
                        <button class="menu_button csid-tab" data-tab="settings">设置</button>
                    </div>

                    <section class="csid-panel is-active" data-panel="compose">
                        <div class="csid-workflow">
                            <div><b>取材</b><span>剪贴板 / 选中 / 勾选 / 最新回复</span></div>
                            <div><b>导演</b><span>英文提示词 + 镜头卡</span></div>
                            <div><b>出图</b><span>写回原文 + 智绘姬识别</span></div>
                            <div><b>记忆</b><span>地点服装自动更新</span></div>
                        </div>
                        <textarea class="text_pole csid-textarea" data-role="scene-input" placeholder="复制想出图的剧情段落后点一键出图；也可以先在聊天里选中文字，或用最新回复/勾选消息。"></textarea>
                        <div class="csid-actions csid-primary-actions">
                            <button class="menu_button result-control" data-action="auto-image">写入最新回复下方</button>
                            <button class="menu_button" data-action="compose">只生成提示词</button>
                            <button class="menu_button" data-action="read-selection">读取选中</button>
                            <button class="menu_button" data-action="read-clipboard">读取剪贴板</button>
                            <button class="menu_button" data-action="use-latest">最新回复</button>
                            <button class="menu_button" data-action="use-recent">使用勾选</button>
                        </div>
                        <div class="csid-recent" data-role="recent-messages"></div>
                        <div class="csid-result-grid">
                            <div class="csid-result-block is-trigger">
                                <label class="csid-label">智绘姬触发文本</label>
                                <textarea class="text_pole csid-output" data-role="chatu8-trigger" readonly></textarea>
                            </div>
                            <div class="csid-result-block">
                                <label class="csid-label">镜头卡</label>
                                <textarea class="text_pole csid-output" data-role="shot-card" readonly></textarea>
                            </div>
                            <div class="csid-result-block">
                                <label class="csid-label">正向提示词</label>
                                <textarea class="text_pole csid-output" data-role="positive" readonly></textarea>
                            </div>
                            <div class="csid-result-block">
                                <label class="csid-label">反向提示词</label>
                                <textarea class="text_pole csid-output small" data-role="negative" readonly></textarea>
                            </div>
                        </div>
                        <div class="csid-actions">
                            <button class="menu_button" data-action="copy-trigger">复制触发文本</button>
                            <button class="menu_button" data-action="insert-trigger">填入聊天框</button>
                            <button class="menu_button" data-action="send-trigger">发送触发</button>
                            <button class="menu_button" data-action="copy-positive">复制正向</button>
                            <button class="menu_button" data-action="copy-negative">复制反向</button>
                            <button class="menu_button" data-action="analyze-input">后台记忆</button>
                        </div>
                    </section>

                    <section class="csid-panel" data-panel="memory">
                        <div class="csid-memory-note">自动记忆会在新回复结束和一键出图时更新；这里用于检查或手动修正固定外观、服装、地点。</div>
                        <div class="csid-grid two">
                            <label>当前角色<input class="text_pole" name="char.name" readonly></label>
                            <label>当前地点<input class="text_pole" name="scene.location"></label>
                            <label>时间<input class="text_pole" name="scene.time"></label>
                            <label>天气<input class="text_pole" name="scene.weather"></label>
                            <label>光线<input class="text_pole" name="scene.lighting"></label>
                            <label>氛围<input class="text_pole" name="scene.mood"></label>
                        </div>
                        <label class="csid-label">长期摘要</label>
                        <textarea class="text_pole csid-memory-area small" name="memory.summary"></textarea>
                        <label class="csid-label">关键事实</label>
                        <textarea class="text_pole csid-memory-area small" name="memory.facts" placeholder="每行一条，角色身份/世界规则/重要事件"></textarea>
                        <label class="csid-label">视觉备注</label>
                        <textarea class="text_pole csid-memory-area small" name="memory.visualNotes" placeholder="每行一条，固定服饰/标志物/场景视觉锚点"></textarea>
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


                    <section class="csid-panel" data-panel="story">
                        <div class="csid-memory-note">剧情长期记忆只注入正文生成上下文，用来保持设定、前因后果、关系和伏笔一致；不会写入聊天正文，也不会进入智绘姬方括号。</div>
                        <div class="csid-toggles">
                            <label><input type="checkbox" name="storyMemory.enabled"> 启用剧情长期记忆</label>
                            <label><input type="checkbox" name="storyMemory.autoIndex"> 自动索引新聊天</label>
                            <label><input type="checkbox" name="storyMemory.injectToPrompt"> 生成正文时注入</label>
                            <label><input type="checkbox" name="storyMemory.includeOriginal"> 注入相关原文片段</label>
                            <label><input type="checkbox" name="storyMemory.useApiSummary"> 用额外 API 后台整理</label>
                        </div>
                        <div class="csid-grid two">
                            <label>注入深度<input class="text_pole" type="number" name="storyMemory.injectDepth" min="0" max="20" step="1"></label>
                            <label>检索条数<input class="text_pole" type="number" name="storyMemory.maxRetrieved" min="1" max="20" step="1"></label>
                            <label>注入字数上限<input class="text_pole" type="number" name="storyMemory.maxInjectChars" min="400" max="6000" step="100"></label>
                            <label>最多记忆条数<input class="text_pole" type="number" name="storyMemory.maxEntries" min="50" max="2000" step="50"></label>
                        </div>
                        <label class="csid-label">长期剧情摘要</label>
                        <textarea class="text_pole csid-memory-area" name="story.summary" placeholder="由插件自动整理，也可以手动修正。"></textarea>
                        <label class="csid-label">关键设定 / 已发生事实</label>
                        <textarea class="text_pole csid-memory-area" name="story.facts" placeholder="每行一条：身份、规则、重要事件、承诺、秘密等。"></textarea>
                        <label class="csid-label">未解决伏笔 / 目标</label>
                        <textarea class="text_pole csid-memory-area small" name="story.openThreads" placeholder="每行一条：尚未解决的疑问、目标、约定、危险。"></textarea>
                        <label class="csid-label">人物关系</label>
                        <textarea class="text_pole csid-memory-area small" name="story.relationships" placeholder="格式：角色A：与角色B的关系变化"></textarea>
                        <label class="csid-label">持续状态</label>
                        <textarea class="text_pole csid-memory-area small" name="story.characterStates" placeholder="格式：角色名：持续心理、立场、伤势、能力状态"></textarea>
                        <div class="csid-actions">
                            <button class="menu_button result-control" data-action="save-story-memory">保存剧情记忆</button>
                            <button class="menu_button" data-action="backfill-story">回溯索引当前聊天</button>
                            <button class="menu_button" data-action="refresh-story-injection">刷新注入</button>
                        </div>
                        <div class="csid-memory-note" data-role="story-stats">剧情记忆未索引</div>
                        <label class="csid-label">本次检索预览</label>
                        <textarea class="text_pole csid-output" data-role="story-retrieval" readonly></textarea>
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
                                    <option value="en">英文</option>
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
                            <label><input type="checkbox" name="behavior.preferClipboard"> 优先读取剪贴板</label>
                            <label><input type="checkbox" name="behavior.syncTavernHelper"> 同步酒馆助手变量</label>
                            <label><input type="checkbox" name="behavior.allowPermanentOverwrite"> 允许覆盖永久设定</label>
                            <label><input type="checkbox" name="api.enabled"> 启用额外 API</label>
                            <label><input type="checkbox" name="chatu8.enabled"> 输出智绘姬触发文本</label>
                            <label><input type="checkbox" name="chatu8.insertToChatInput"> 生成后填入聊天框</label>
                        </div>
                        <div class="csid-grid two">
                            <label>API 地址<input class="text_pole" name="api.url" placeholder="http://127.0.0.1:8000/v1"></label>
                            <label>模型选择<select class="text_pole" name="api.modelSelect"></select></label>
                            <label>手动模型<input class="text_pole" name="api.model" placeholder="刷新失败时手填，例如 gpt-4.1-mini"></label>
                            <label>开始标记<input class="text_pole" name="chatu8.startTag" placeholder="["></label>
                            <label>结束标记<input class="text_pole" name="chatu8.endTag" placeholder="]"></label>
                            <label>超时 ms<input class="text_pole" type="number" name="api.timeoutMs" min="3000" step="500"></label>
                            <label>温度<input class="text_pole" type="number" name="api.temperature" min="0" max="2" step="0.1"></label>
                        </div>
                        <label class="csid-label">API Key</label>
                        <input class="text_pole" type="password" name="api.key" autocomplete="off">
                        <div class="csid-actions">
                            <button class="menu_button result-control" data-action="save-settings">保存设置</button>
                            <button class="menu_button" data-action="refresh-models">刷新模型</button>
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
        if (action === 'read-clipboard') readClipboardIntoInput();
        if (action === 'use-recent') useRecentIntoInput();
        if (action === 'use-latest') useLatestIntoInput();
        if (action === 'compose') composeFromInput();
        if (action === 'auto-image') writePromptUnderLatestFromInput();
        if (action === 'copy-trigger') copyText(state.lastTrigger, '已复制智绘姬触发文本');
        if (action === 'insert-trigger') insertTriggerIntoChat();
        if (action === 'send-trigger') sendTriggerToChat();
        if (action === 'copy-positive') copyText(state.lastPositive, '已复制正向提示词');
        if (action === 'copy-negative') copyText(state.lastNegative, '已复制反向提示词');
        if (action === 'analyze-input') analyzeInputNow();
        if (action === 'backfill-story') indexExistingStoryMemory();
        if (action === 'refresh-story-injection') {
            readFormToSettings();
            readFormToMemory();
            updateStoryMemoryInjection();
            renderStoryMemoryFields();
            setStatus('剧情记忆注入已刷新');
        }
        if (action === 'save-story-memory') {
            readFormToSettings();
            readFormToMemory();
            updateStoryMemoryInjection();
            renderStoryMemoryFields();
            setStatus('剧情记忆已保存');
        }
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
        if (action === 'refresh-models') refreshApiModels().catch(error => setStatus('模型读取失败: ' + error.message));
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
        if (event.target.matches('[name="api.modelSelect"]')) {
            const selected = event.target.value;
            const input = root.querySelector('[name="api.model"]');
            if (selected && selected !== '__manual__' && input) input.value = selected;
            readFormToSettings();
            setStatus(selected && selected !== '__manual__' ? '已选择模型: ' + selected : '使用手动模型');
        }
        if (event.target.matches('[name="api.url"], [name="api.key"]')) {
            refreshApiModels().catch(error => setStatus('模型自动读取失败: ' + error.message));
        }
    });
    root.addEventListener('input', event => {
        if (event.target.closest('[name]')) {
            if (event.target.matches('[name="api.model"]')) {
                const select = root.querySelector('[name="api.modelSelect"]');
                if (select) select.value = '__manual__';
            }
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

async function readClipboardText() {
    try {
        if (navigator.clipboard?.readText) return normalizeMultiline(await navigator.clipboard.readText());
    } catch (error) {
        console.warn('[' + EXT_NAME + '] clipboard read failed', error);
    }
    return '';
}

async function readClipboardIntoInput() {
    const text = await readClipboardText();
    if (!text) {
        setStatus('没有读取到剪贴板文本');
        return;
    }
    document.querySelector(SETTINGS_SELECTOR + ' [data-role="scene-input"]').value = text;
    setStatus('已读取剪贴板');
}

async function resolveSourceText(currentInput = '') {
    const settings = ensureSettings();
    const candidates = [];
    if (settings.behavior.preferClipboard) candidates.push(await readClipboardText());
    candidates.push(getSelectedText());
    candidates.push(currentInput);
    candidates.push(buildSelectedRecentText());
    candidates.push(getLatestAssistantMessage()?.text || '');
    return candidates.map(normalizeMultiline).find(Boolean) || '';
}

function getChatInputElement() {
    return document.querySelector('#send_textarea')
        || document.querySelector('textarea[name="send_textarea"]')
        || document.querySelector('#send_textarea textarea')
        || document.querySelector('textarea[placeholder]');
}

function insertTriggerIntoChat() {
    if (!state.lastTrigger) {
        setStatus('没有可填入的智绘姬触发文本');
        return false;
    }
    const input = getChatInputElement();
    if (!input) {
        setStatus('没有找到酒馆聊天输入框');
        return false;
    }
    input.value = state.lastTrigger;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: state.lastTrigger }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    setStatus('已填入聊天输入框');
    return true;
}

function sendTriggerToChat() {
    if (!insertTriggerIntoChat()) return;
    const sendButton = document.querySelector('#send_but') || document.querySelector('[id="send_but"]');
    if (!sendButton) {
        setStatus('已填入输入框，但没有找到发送按钮');
        return;
    }
    sendButton.click();
}



function getMessageElementById(messageId) {
    return document.querySelector('.mes[mesid="' + messageId + '"]')
        || document.querySelector('[data-mes-id="' + messageId + '"]')
        || document.querySelector('[data-message-id="' + messageId + '"]')
        || [...document.querySelectorAll('.mes')][Number(messageId)];
}

function getMessageIdFromElement(element) {
    const mes = element?.closest?.('.mes');
    if (!mes) return -1;
    const raw = mes.getAttribute('mesid') || mes.dataset.mesId || mes.dataset.messageId;
    if (raw !== undefined && raw !== null && raw !== '') return Number(raw);
    return [...document.querySelectorAll('.mes')].indexOf(mes);
}

function closeMessageMenu() {
    document.querySelectorAll('.csid-message-menu').forEach(menu => menu.remove());
}

function nodeToElement(node) {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

function getSelectionContext(event) {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount < 1 || selection.isCollapsed) return null;
    const selectedText = normalizeMultiline(selection.toString()).trim();
    if (!selectedText) return null;
    const range = selection.getRangeAt(0);
    const common = nodeToElement(range.commonAncestorContainer)
        || nodeToElement(selection.anchorNode)
        || nodeToElement(selection.focusNode);
    const mes = common?.closest?.('.mes');
    if (!mes) return null;
    if (event?.target && !mes.contains(event.target.closest?.('.mes') || event.target)) return null;
    const messageId = getMessageIdFromElement(mes);
    if (!Number.isInteger(messageId) || messageId < 0 || !chat?.[messageId]) return null;
    const rect = range.getBoundingClientRect();
    const x = rect.left || rect.right ? rect.left + rect.width / 2 : event?.clientX || window.innerWidth / 2;
    const y = rect.bottom || event?.clientY || window.innerHeight / 2;
    return { messageId, text: selectedText, x, y, range: range.cloneRange() };
}

function showMessageMenu(eventOrPoint, messageId, selectedText = '', selectionRange = null) {
    closeMessageMenu();
    state.activeMessageId = messageId;
    state.activeSelectionText = normalizeMultiline(selectedText || '').trim();
    state.activeSelectionRange = selectionRange;
    state.messageMenuOpenedAt = Date.now();
    const menu = document.createElement('div');
    menu.className = 'csid-message-menu';
    if (state.activeSelectionText) {
        const hint = document.createElement('div');
        hint.className = 'csid-message-menu-hint';
        hint.textContent = '已选中 ' + state.activeSelectionText.length + ' 字';
        menu.appendChild(hint);
    }
    const imageButton = document.createElement('button');
    imageButton.type = 'button';
    imageButton.dataset.csidMessageAction = 'image';
    imageButton.innerHTML = '<span class="fa-solid fa-image"></span><span>图片生成</span>';
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.dataset.csidMessageAction = 'copy';
    copyButton.innerHTML = '<span class="fa-solid fa-copy"></span><span>复制触发文本</span>';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.dataset.csidMessageAction = 'close';
    closeButton.innerHTML = '<span class="fa-solid fa-xmark"></span><span>取消</span>';
    menu.append(imageButton, copyButton, closeButton);
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const clientX = eventOrPoint?.clientX ?? eventOrPoint?.x ?? window.innerWidth / 2;
    const clientY = eventOrPoint?.clientY ?? eventOrPoint?.y ?? window.innerHeight / 2;
    const left = Math.min(Math.max(8, clientX - rect.width / 2), window.innerWidth - rect.width - 8);
    const top = Math.min(Math.max(8, clientY + 8), window.innerHeight - rect.height - 8);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
}

function openMenuFromSelection(event, delay = 0) {
    if (event.target.closest?.(SETTINGS_SELECTOR)) return;
    if (event.target.closest?.('textarea,input,button,select,a,.csid-message-menu')) return;
    setTimeout(() => {
        const context = getSelectionContext(event);
        if (!context) return;
        showMessageMenu({ clientX: context.x, clientY: context.y }, context.messageId, context.text, context.range);
    }, delay);
}

function bindMessageMenu() {
    if (state.messageMenuBound) return;
    state.messageMenuBound = true;
    document.addEventListener('mouseup', event => openMenuFromSelection(event, 0), true);
    document.addEventListener('touchend', event => openMenuFromSelection(event, 120), true);
    document.addEventListener('click', event => {
        const actionButton = event.target.closest('[data-csid-message-action]');
        if (actionButton) {
            const action = actionButton.dataset.csidMessageAction;
            const messageId = Number(state.activeMessageId);
            const selectedText = state.activeSelectionText || '';
            const selectionRange = state.activeSelectionRange || null;
            closeMessageMenu();
            if (action === 'image') generatePromptUnderMessage(messageId, selectedText, selectionRange);
            if (action === 'copy') copyMessageTrigger(messageId, selectedText);
            return;
        }
        if (Date.now() - (state.messageMenuOpenedAt || 0) < 250) return;
        if (!event.target.closest('.csid-message-menu')) closeMessageMenu();
    }, true);
}

function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
}

function stripLastInlinePrompt(text, message) {
    let output = normalizeMultiline(text || '').trimEnd();
    const lastTrigger = message?.extra?.[EXT_ID]?.lastTrigger;
    if (lastTrigger) {
        const trigger = normalizeMultiline(lastTrigger).trim();
        output = output.replace(new RegExp('\\n{0,2}' + escapeRegExp(trigger) + '(?=\\n|$)', 'g'), '').trimEnd();
    }
    return output;
}

function buildCollapsedSearchIndex(text) {
    const source = normalizeMultiline(text || '');
    let value = '';
    const map = [];
    let inWhitespace = false;
    for (let i = 0; i < source.length; i++) {
        const char = source[i];
        if (/\s/.test(char)) {
            if (!inWhitespace) {
                value += ' ';
                map.push(i);
                inWhitespace = true;
            }
        } else {
            value += char;
            map.push(i);
            inWhitespace = false;
        }
    }
    return { value, map, source };
}

function findSelectedTextRange(sourceText, selectedText) {
    const source = normalizeMultiline(sourceText || '');
    const selected = normalizeMultiline(selectedText || '').trim();
    if (!source || !selected) return null;
    const exactStart = source.indexOf(selected);
    if (exactStart >= 0) return { start: exactStart, end: exactStart + selected.length, exact: true };
    const sourceIndex = buildCollapsedSearchIndex(source);
    const selectedIndex = buildCollapsedSearchIndex(selected);
    const collapsedStart = sourceIndex.value.indexOf(selectedIndex.value);
    if (collapsedStart < 0) return null;
    const collapsedEnd = collapsedStart + selectedIndex.value.length - 1;
    const start = sourceIndex.map[collapsedStart];
    const end = sourceIndex.map[collapsedEnd] + 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
    return { start, end, exact: false };
}

function insertTriggerAfterSelectedText(fullText, selectedText, trigger) {
    const base = normalizeMultiline(fullText || '').trimEnd();
    const selected = normalizeMultiline(selectedText || '').trim();
    const range = selected ? findSelectedTextRange(base, selected) : null;
    if (!range) return base + '\n\n' + trigger;
    const head = base.slice(0, range.end).trimEnd();
    const tail = base.slice(range.end).trimStart();
    return head + '\n\n' + trigger + (tail ? '\n\n' + tail : '');
}

function setMessageRawText(messageId, text, trigger) {
    const message = chat?.[Number(messageId)];
    if (!message) throw new Error('没有找到这条消息');
    message.extra ||= {};
    message.extra[EXT_ID] ||= {};
    message.extra[EXT_ID].lastTrigger = trigger;
    message.mes = text;
    if (Array.isArray(message.swipes) && message.swipes.length) {
        const swipeId = Number.isInteger(Number(message.swipe_id)) ? Number(message.swipe_id) : message.swipes.length - 1;
        message.swipes[Math.max(0, Math.min(swipeId, message.swipes.length - 1))] = text;
    }
}

function rangeBelongsToElement(range, element) {
    if (!range || !element) return false;
    const start = nodeToElement(range.startContainer);
    const end = nodeToElement(range.endContainer);
    return Boolean(start && end && element.contains(start) && element.contains(end));
}

function insertTriggerIntoVisibleMessage(messageId, trigger, selectionRange = null) {
    const mes = getMessageElementById(messageId);
    const textNode = mes?.querySelector('.mes_text');
    if (!textNode || !trigger) return null;
    const holder = document.createElement('span');
    holder.className = 'csid-visible-trigger-wrap';
    holder.dataset.csidOwned = 'true';
    holder.dataset.csidMessageId = String(messageId);
    holder.dataset.csidTrigger = trigger;
    const promptNode = document.createElement('span');
    promptNode.className = 'csid-visible-trigger';
    promptNode.textContent = trigger;
    holder.appendChild(promptNode);
    if (rangeBelongsToElement(selectionRange, textNode)) {
        try {
            const range = selectionRange.cloneRange();
            range.collapse(false);
            range.insertNode(holder);
            return holder;
        } catch (error) {
            console.warn('[' + EXT_NAME + '] insert selected trigger failed', error);
        }
    }
    textNode.appendChild(holder);
    return holder;
}

function renderInlinePrompt(messageId, trigger) {
    return insertTriggerIntoVisibleMessage(messageId, trigger, state.activeSelectionRange || null);
}

async function emitMessagePromptEvents(messageId) {
    try { await saveChatConditional?.(); } catch (error) { console.warn('[' + EXT_NAME + '] save chat failed', error); }
}

async function writePromptToMessage(messageId, sourceText, options = {}) {
    const message = chat?.[Number(messageId)];
    if (!message) throw new Error('没有找到这条消息');
    const fullText = stripLastInlinePrompt(getMessageText(message), message);
    const selectedText = normalizeMultiline(options.selectedText || sourceText || '').trim();
    const sceneText = selectedText || fullText;
    if (!sceneText) throw new Error('这条消息没有可用于生图的正文');
    setStatus(selectedText ? '正在为选中剧情生成智绘姬提示词' : '正在为原文生成智绘姬提示词');
    const result = await buildSmartPrompt(sceneText);
    state.lastPositive = normalizePromptText(result.positive);
    state.lastNegative = normalizePromptText(result.negative);
    state.lastShotCard = result.shotCard;
    state.lastTrigger = buildChatu8Trigger(state.lastPositive);
    const positiveArea = document.querySelector(SETTINGS_SELECTOR + ' [data-role="positive"]');
    const negativeArea = document.querySelector(SETTINGS_SELECTOR + ' [data-role="negative"]');
    const shotArea = document.querySelector(SETTINGS_SELECTOR + ' [data-role="shot-card"]');
    const triggerArea = document.querySelector(SETTINGS_SELECTOR + ' [data-role="chatu8-trigger"]');
    if (positiveArea) positiveArea.value = state.lastPositive;
    if (negativeArea) negativeArea.value = state.lastNegative;
    if (shotArea) shotArea.value = state.lastShotCard;
    if (triggerArea) triggerArea.value = state.lastTrigger;
    if (result.memoryPatch) applyMemoryPatch(result.memoryPatch, sceneText, result.source || 'api');
    else updateMemoryFromSelectedScene(sceneText, result.localScene);
    chat_metadata.variables ||= {};
    chat_metadata.variables.zhihuiji = true;
    syncTavernHelperMemory();
    renderMemoryFields();
    saveAll();
    const nextText = insertTriggerAfterSelectedText(fullText, selectedText, state.lastTrigger);
    setMessageRawText(messageId, nextText, state.lastTrigger);
    const promptAnchor = insertTriggerIntoVisibleMessage(messageId, state.lastTrigger, options.selectionRange || null);
    await emitMessagePromptEvents(messageId);
    setStatus('已写到选中剧情下方；请点击出现的智绘姬图片按钮生成');
    return { ...result, trigger: state.lastTrigger, insertedAtSelection: Boolean(selectedText && findSelectedTextRange(fullText, selectedText)), clicked: false };
}

async function generatePromptUnderMessage(messageId, selectedText = '', selectionRange = null) {
    try {
        await writePromptToMessage(messageId, selectedText, { selectedText, selectionRange });
    } catch (error) {
        console.error('[' + EXT_NAME + '] write prompt under message failed', error);
        setStatus('图片生成入口失败: ' + error.message);
    }
}

async function copyMessageTrigger(messageId, selectedText = '') {
    try {
        const message = chat?.[Number(messageId)];
        const fullText = stripLastInlinePrompt(getMessageText(message), message);
        const text = normalizeMultiline(selectedText || '').trim() || fullText;
        if (!text) throw new Error('没有可复制的剧情正文');
        setStatus(selectedText ? '正在生成选中剧情的触发文本' : '正在生成这条消息的触发文本');
        const result = await buildSmartPrompt(text);
        state.lastPositive = normalizePromptText(result.positive);
        state.lastNegative = normalizePromptText(result.negative);
        state.lastShotCard = result.shotCard;
        state.lastTrigger = buildChatu8Trigger(state.lastPositive);
        await copyText(state.lastTrigger, '已复制选中剧情的智绘姬触发文本');
    } catch (error) {
        setStatus('复制失败: ' + error.message);
    }
}

async function writePromptUnderLatestFromInput() {
    const inputArea = document.querySelector(SETTINGS_SELECTOR + ' [data-role="scene-input"]');
    const input = await resolveSourceText(inputArea?.value || '');
    const latest = getLatestAssistantMessage();
    if (!latest || latest.index === undefined || latest.index === null || latest.index < 0) {
        setStatus('没有找到可写入的最新回复，请在原文中选中一段剧情');
        return;
    }
    if (inputArea) inputArea.value = input || latest.text;
    try {
        await writePromptToMessage(latest.index, input || latest.text, { selectedText: input || '' });
    } catch (error) {
        setStatus('写入最新回复失败: ' + error.message);
    }
}

async function composeFromInput(options = {}) {
    readFormToSettings();
    readFormToMemory();
    const inputArea = document.querySelector(SETTINGS_SELECTOR + ' [data-role="scene-input"]');
    const input = await resolveSourceText(inputArea?.value || '');
    if (!input) {
        setStatus('没有读到剧情段落：请复制、选中或点最新回复');
        return;
    }
    if (inputArea) inputArea.value = input;
    setStatus('正在分析剧情并生成英文提示词');
    const result = await buildSmartPrompt(input);
    state.lastPositive = normalizePromptText(result.positive);
    state.lastNegative = normalizePromptText(result.negative);
    state.lastShotCard = result.shotCard;
    state.lastTrigger = buildChatu8Trigger(state.lastPositive);
    document.querySelector(SETTINGS_SELECTOR + ' [data-role="positive"]').value = state.lastPositive;
    document.querySelector(SETTINGS_SELECTOR + ' [data-role="negative"]').value = state.lastNegative;
    document.querySelector(SETTINGS_SELECTOR + ' [data-role="shot-card"]').value = state.lastShotCard;
    const triggerArea = document.querySelector(SETTINGS_SELECTOR + ' [data-role="chatu8-trigger"]');
    if (triggerArea) triggerArea.value = state.lastTrigger;
    if (result.memoryPatch) applyMemoryPatch(result.memoryPatch, input, result.source || 'api');
    else updateMemoryFromSelectedScene(input, result.localScene);
    syncTavernHelperMemory();
    renderMemoryFields();
    if (!options.skipInsert && (ensureSettings().chatu8.insertToChatInput || options.sendToChat)) insertTriggerIntoChat();
    if (!options.skipInsert && options.sendToChat) sendTriggerToChat();
    setStatus(options.sendToChat ? '已生成并发送智绘姬触发文本' : '提示词已生成');
    return { positive: state.lastPositive, negative: state.lastNegative, trigger: state.lastTrigger, shotCard: state.lastShotCard };
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
        const result = await buildSmartPrompt('她在深夜的旅馆房间里换上白色睡裙，靠在窗边微笑，月光很柔和。');
        state.lastPositive = normalizePromptText(result.positive);
        state.lastNegative = normalizePromptText(result.negative);
        state.lastShotCard = result.shotCard;
        state.lastTrigger = buildChatu8Trigger(state.lastPositive);
        const triggerArea = document.querySelector(SETTINGS_SELECTOR + ' [data-role="chatu8-trigger"]');
        if (triggerArea) triggerArea.value = state.lastTrigger;
        document.querySelector(SETTINGS_SELECTOR + ' [data-role="positive"]').value = state.lastPositive;
        document.querySelector(SETTINGS_SELECTOR + ' [data-role="negative"]').value = state.lastNegative;
        document.querySelector(SETTINGS_SELECTOR + ' [data-role="shot-card"]').value = state.lastShotCard;
        setStatus('API/提示词正常: ' + state.lastTrigger.slice(0, 90));
    } catch (error) {
        setStatus('API 测试失败: ' + error.message);
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
        ensureStoryMemory();
        state.selectedMessages.clear();
        setTimeout(() => {
            indexExistingStoryMemory({ silent: true });
            updateStoryMemoryInjection();
            fillFormFromSettings();
            renderMemoryFields();
        }, 150);
    });
    onStEvent(event_types.MESSAGE_SENT, messageId => {
        const text = getMessageText(chat?.[Number(messageId)]);
        if (text) enqueueStoryIndex(text, 'message_sent', Number(messageId));
        updateStoryMemoryInjection(text || getLatestStoryQuery());
        setTimeout(renderRecentMessages, 150);
    });
    onStEvent(event_types.MESSAGE_RECEIVED, messageId => {
        const text = getMessageText(chat?.[Number(messageId)]);
        if (text) {
            enqueueMemoryAnalysis(text, 'message_received');
            enqueueStoryIndex(text, 'message_received', Number(messageId));
        }
        setTimeout(renderRecentMessages, 150);
    });
    onStEvent(event_types.MESSAGE_UPDATED, messageId => {
        const text = getMessageText(chat?.[Number(messageId)]);
        if (text) {
            enqueueMemoryAnalysis(text, 'message_updated');
            enqueueStoryIndex(text, 'message_updated', Number(messageId));
        }
        setTimeout(renderRecentMessages, 150);
    });
    onStEvent(event_types.GENERATION_STARTED, () => {
        updateStoryMemoryInjection(getLatestStoryQuery());
    });
    onStEvent(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, () => {
        updateStoryMemoryInjection(getLatestStoryQuery());
    });
    onStEvent(event_types.GENERATION_ENDED, () => {
        const latest = getLatestAssistantMessage();
        if (latest?.text) {
            enqueueMemoryAnalysis(latest.text, 'generation_ended');
            enqueueStoryIndex(latest.text, 'generation_ended', latest.index);
        }
        updateStoryMemoryInjection();
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
    bindMessageMenu();
    fillFormFromSettings();
    setTimeout(() => {
        indexExistingStoryMemory({ silent: true });
        updateStoryMemoryInjection();
        renderStoryMemoryFields();
    }, 300);
    const tab = ensureSettings().ui.tab || 'compose';
    switchTab(tab);
    exposeDebugApi();
    setStatus(getTavernHelper() ? '就绪，已检测到酒馆助手' : '就绪，独立记忆模式');
}

function exposeDebugApi() {
    globalThis.codexSceneImageDirector = {
        version: '0.2.0',
        extractSceneLocal,
        compilePrompt,
        async composeText(text, { updateMemory = false, smart = true } = {}) {
            const result = smart ? await buildSmartPrompt(String(text || '')) : compilePrompt(String(text || ''));
            if (updateMemory) {
                updateMemoryFromSelectedScene(String(text || ''), result.localScene);
                syncTavernHelperMemory();
            }
            return { ...result, trigger: buildChatu8Trigger(result.positive) };
        },
        getSettings: () => structuredClone(ensureSettings()),
        getMemory: () => structuredClone(ensureChatMemory()),
        getStoryPrompt: () => buildStoryMemoryPrompt(getLatestStoryQuery()),
        refreshStoryMemory: () => updateStoryMemoryInjection(getLatestStoryQuery()),
        indexStoryMemory: () => indexExistingStoryMemory(),
        writePromptToMessage,
    };
}
$(() => init());






