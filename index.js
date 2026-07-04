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
const EXT_VERSION = '0.5.0';
const SETTINGS_SELECTOR = '#codex_scene_image_director';
const TH_MEMORY_KEY = 'codexSceneImageDirector';
const STORY_MEMORY_PROMPT_KEY = EXT_ID + '_story_memory';
const STORY_DB_NAME = EXT_ID + '_prism_memory_v1';
const STORY_DB_VERSION = 1;

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
        useIndexedDb: true,
        prismMode: true,
        injectDepth: 2,
        maxEntries: 800,
        maxRetrieved: 8,
        maxInjectChars: 1600,
        maxEntryChars: 520,
        maxOriginalSnippets: 3,
        maxOriginalSnippetChars: 220,
        rootSummaryChars: 560,
        pathSummaryChars: 900,
        l1ChunkSize: 8,
        l2ChunkSize: 6,
        l3ChunkSize: 6,
        maxDbMessages: 4000,
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
        rootSummary: '',
        facts: [],
        relationships: {},
        openThreads: [],
        characterStates: {},
        entries: [],
        summaryTree: { l1: [], l2: [], l3: [] },
        lastRetrieval: [],
        lastPrismPath: null,
        lastInjectedPrompt: '',
        dbStats: { enabled: false, messages: 0, nodes: 0, lastSyncAt: 0, dbName: STORY_DB_NAME },
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

const ANIMA_QUALITY_PREFIX = 'masterpiece, best quality, score_7, safe, highres';
const ANIMA_BASE_NEGATIVE = 'worst quality, low quality, score_1, score_2, score_3, blurry, lowres, bad anatomy, bad hands, malformed hands, extra fingers, missing fingers, watermark, signature, text, logo, cropped, out of frame, photorealistic, 3d render';
const ANIMA_DEFAULT_CAMERA = 'cinematic composition, dynamic angle';

const ANIMA_STYLE_PROFILES = [
    {
        id: 'cyberpunk',
        pattern: /赛博朋克|霓虹|义体|黑客|都市夜景|夜晚|雨夜|街道|巷子|灯牌|反光|玻璃幕墙/i,
        tags: 'anime cyberpunk illustration, neon rim lighting, rainy reflections, detailed urban background, cinematic color grading, crisp lineart',
    },
    {
        id: 'fantasy',
        pattern: /魔法|魔女|精灵|龙|骑士|王国|城堡|异世界|神殿|森林|冒险|法术|咒文/i,
        tags: 'fantasy anime illustration, luminous magic, ornate costume details, painterly background, dramatic atmosphere, elegant composition',
    },
    {
        id: 'dark',
        pattern: /恶魔|天使|诅咒|血|阴影|地下|禁忌|恐怖|怪物|深渊|审判|囚禁|锁链|黑暗/i,
        tags: 'dark fantasy anime illustration, moody lighting, high contrast shadows, gothic atmosphere, sharp highlights, cinematic composition',
    },
    {
        id: 'action',
        pattern: /战斗|冲刺|追逐|奔跑|挥刀|刀|剑|枪|爆炸|破碎|闪避|攻击|格斗|魔法阵/i,
        tags: 'dynamic anime action illustration, dramatic perspective, motion blur, impact lighting, energetic composition, sharp lineart',
    },
    {
        id: 'romance',
        pattern: /脸红|心跳|告白|靠近|牵手|拥抱|亲吻|暧昧|温柔|约会|恋爱|羞涩/i,
        tags: 'romantic anime key visual, soft bloom, delicate eyelashes, luminous eyes, warm gentle lighting, subtle color harmony',
    },
    {
        id: 'school',
        pattern: /学校|学院|教室|走廊|校门|制服|校服|书包|社团|学生|风纪委员|图书馆/i,
        tags: 'polished school anime key visual, clean cel shading, crisp lineart, expressive eyes, soft daylight, tidy background detail',
    },
    {
        id: 'slice',
        pattern: /日常|房间|客厅|餐桌|甜品|咖啡|清晨|午后|阳光|散步|家里|便利店/i,
        tags: 'slice of life anime illustration, soft natural lighting, clean lineart, cozy atmosphere, gentle color palette, detailed everyday background',
    },
    {
        id: 'mystery',
        pattern: /秘密|谜|调查|侦探|线索|禁书|档案|监视|阴谋|真相|风纪|检查/i,
        tags: 'mystery anime illustration, suspenseful lighting, cinematic framing, focused composition, subtle shadows, refined details',
    },
];

const ANIMA_CHARACTER_STYLE_PROFILES = [
    {
        id: 'cute-girl',
        pattern: /少女|女孩|女学生|公主|女仆|粉色|长发|猫耳|狐耳|可爱|害羞|脸红/i,
        tags: 'cute anime character design, luminous eyes, delicate facial features, soft hair highlights',
    },
    {
        id: 'elegant',
        pattern: /优雅|大小姐|贵族|女王|礼服|长裙|银发|金发|冷淡|端庄/i,
        tags: 'elegant anime character art, refined silhouette, graceful pose, ornate details, controlled expression',
    },
    {
        id: 'cool-boy',
        pattern: /少年|男孩|男人|青年|骑士|执事|冷峻|沉默|黑发|西装/i,
        tags: 'otome visual novel character art, sharp eyes, elegant lineart, cool lighting, handsome character design',
    },
];

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
    [/走廊|回廊|廊道/g, 'corridor'],
    [/教室/g, 'classroom'],
    [/风纪委员室|委员会办公室/g, 'disciplinary committee room'],
    [/图书馆|阅览室/g, 'library'],
    [/教学楼/g, 'school building'],
    [/办公室/g, 'office'],
    [/大厅|殿堂|宫殿/g, 'grand hall'],
    [/屋顶|天台/g, 'rooftop'],
    [/餐桌|饭桌/g, 'dining table'],
    [/甜品店|甜点店|蛋糕店/g, 'dessert shop'],
    [/橱窗/g, 'shop window'],
    [/校门口|学校门口|校门/g, 'school gate'],
    [/背着书包/g, 'carrying a school bag on back'],
    [/书包侧袋|侧袋/g, 'school bag side pocket'],
    [/书包/g, 'school bag'],
    [/书封|封面/g, 'book cover'],
    [/漫画/g, 'manga book'],
    [/书本|书籍|一本书|那本书|这本书/g, 'book'],
    [/信封/g, 'envelope'],
    [/信件|一封信|那封信|这封信|把信|信藏|信递|纸条/g, 'letter'],
    [/雨伞|伞/g, 'umbrella'],
    [/自行车|单车/g, 'bicycle'],
    [/手机/g, 'phone'],
    [/旧钥匙/g, 'old key'],
    [/钥匙/g, 'key'],
    [/水蜜桃|蜜桃/g, 'honey peach'],
    [/勺子|汤匙/g, 'spoon'],
    [/草莓牛奶/g, 'strawberry milk'],
    [/草莓大福/g, 'strawberry daifuku'],
    [/礼物|送给|给樱/g, 'gift for Sakura'],
    [/沙发/g, 'sofa'],
    [/看书|读书/g, 'reading book'],
    [/护在怀里|抱在怀里/g, 'holding protectively against chest'],
    [/袖口/g, 'sleeve cuff'],
    [/同伴|伙伴/g, 'companion'],
    [/雨/g, 'rain'],
    [/雪/g, 'snow'],
    [/夜晚|深夜|晚上/g, 'night'],
    [/黄昏|傍晚/g, 'dusk'],
    [/夕阳|夕光|夕照|落日/g, 'sunset light'],
    [/清晨|早晨/g, 'morning'],
    [/阳光/g, 'sunlight'],
    [/月光/g, 'moonlight'],
    [/白色/g, 'white'],
    [/黑色/g, 'black'],
    [/红色/g, 'red'],
    [/蓝色/g, 'blue'],
    [/金色/g, 'golden'],
    [/银色/g, 'silver'],
    [/银发|银色头发/g, 'silver hair'],
    [/樱粉色|浅粉色头发|粉色头发|粉发/g, 'pink hair'],
    [/黑发|黑色头发/g, 'black hair'],
    [/白发|白色头发/g, 'white hair'],
    [/少女|女孩/g, 'young woman'],
    [/少年|男孩/g, 'young man'],
    [/连衣裙/g, 'dress'],
    [/睡裙/g, 'nightgown'],
    [/连帽衫|帽衫/g, 'hoodie'],
    [/白色连帽衫|白色帽衫/g, 'loose white hoodie'],
    [/斗篷/g, 'cloak'],
    [/披肩/g, 'shawl'],
    [/校服/g, 'school uniform'],
    [/制服/g, 'uniform'],
    [/衬衫/g, 'shirt'],
    [/外套/g, 'coat'],
    [/领带/g, 'tie'],
    [/丝带|缎带/g, 'ribbon'],
    [/眼镜/g, 'glasses'],
    [/小皮鞋|皮鞋/g, 'leather shoes'],
    [/长发/g, 'long hair'],
    [/短发/g, 'short hair'],
    [/微笑/g, 'smile'],
    [/害羞/g, 'shy'],
    [/脸红|红着脸|脸红得厉害/g, 'blushing'],
    [/眼眶发红|泪眼|含泪/g, 'teary eyes'],
    [/咬唇|咬着嘴唇/g, 'biting lip'],
    [/皱眉/g, 'frowning'],
    [/惊讶|愣住/g, 'surprised expression'],
    [/紧张|慌张|不安/g, 'nervous expression'],
    [/哭|泪/g, 'tears'],
    [/拥抱/g, 'hugging'],
    [/握着|握住|拿着/g, 'holding'],
    [/伸手/g, 'reaching hand'],
    [/拉住|抓住/g, 'grabbing'],
    [/袖口/g, 'sleeve cuff'],
    [/递给|交给|送给/g, 'offering'],
    [/接过去|接过|收下/g, 'accepting'],
    [/藏到身后|藏在身后/g, 'hiding behind back'],
    [/翻找|搜查|检查/g, 'searching'],
    [/露出|露出来/g, 'peeking out'],
    [/掉在地上|落在地上/g, 'falling to the floor'],
    [/回头|回过头|回眸/g, 'looking back'],
    [/头也不回/g, 'not looking back'],
    [/走在前面|走在前方|往前走|向前走/g, 'walking ahead'],
    [/跺脚|跺地板|踩得啪啪响/g, 'stomping footsteps'],
    [/一甩一甩|甩动|甩着/g, 'swaying hair'],
    [/追来|追赶|追逐/g, 'chasing scene'],
    [/跑|奔跑/g, 'running'],
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
    lastDebug: null,
    lastSelectionContext: null,
    activeSelectionSourceRange: null,
    sceneCaptureStart: null,
    sceneCaptureEnd: null,
    pendingPreview: null,
    generationStatus: 'idle',
    analyzerRunning: false,
    analyzerQueue: [],
    storyAnalyzerRunning: false,
    storyAnalyzerQueue: [],
    saveTimer: null,
    selectionCacheTimer: null,
    lastDiagnostics: [],
};

let metadataVariableGuardTimer = null;

function ensureChatMetadataVariables() {
    chat_metadata.variables ||= {};
    try {
        const contextMetadata = getContext?.()?.chatMetadata;
        if (contextMetadata) {
            contextMetadata.variables ||= chat_metadata.variables;
            chat_metadata.variables ||= contextMetadata.variables;
        }
    } catch (error) {
        // getContext may not be ready during very early extension loading.
    }
    return chat_metadata.variables;
}

function startMetadataVariableGuard() {
    if (metadataVariableGuardTimer) return;
    let fastRuns = 0;
    ensureChatMetadataVariables();
    metadataVariableGuardTimer = setInterval(() => {
        ensureChatMetadataVariables();
        fastRuns += 1;
        if (fastRuns >= 240) {
            clearInterval(metadataVariableGuardTimer);
            metadataVariableGuardTimer = setInterval(ensureChatMetadataVariables, 500);
        }
    }, 25);
}

startMetadataVariableGuard();

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
    ensureChatMetadataVariables();
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
    getCharacterMemory(name);
    const settings = ensureSettings();
    const chatMemory = ensureChatMemory();
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
    memory.story.rootSummary ||= '';
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
    memory.story.lastPrismPath ||= null;
    memory.story.lastInjectedPrompt ||= '';
    memory.story.dbStats ||= { enabled: false, messages: 0, nodes: 0, lastSyncAt: 0, dbName: STORY_DB_NAME };
    memory.story.dbStats.dbName ||= STORY_DB_NAME;
    return memory.story;
}

function getStoryConfig() {
    const settings = ensureSettings();
    settings.storyMemory = deepMerge(DEFAULT_SETTINGS.storyMemory, settings.storyMemory || {});
    return settings.storyMemory;
}


let storyDbPromise = null;

function getLegacyStoryChatKey() {
    const id = normalizeLine(getCurrentChatId?.() || '');
    const name = normalizeLine(getCurrentCharacterName?.() || '');
    return hashText([id, name, location?.pathname || 'st'].join('|'));
}

function getStoryChatKey() {
    const id = normalizeLine(getCurrentChatId?.() || '');
    if (id) return hashText(id);
    const name = normalizeLine(getCurrentCharacterName?.() || '');
    return hashText([name, location?.pathname || 'st'].join('|'));
}

function canUseStoryIndexedDb() {
    return typeof indexedDB !== 'undefined' && Boolean(getStoryConfig().useIndexedDb);
}

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
}

function transactionDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
}

function openStoryDb() {
    if (!canUseStoryIndexedDb()) return Promise.resolve(null);
    if (storyDbPromise) return storyDbPromise;
    storyDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(STORY_DB_NAME, STORY_DB_VERSION);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('messages')) {
                const store = db.createObjectStore('messages', { keyPath: 'id' });
                store.createIndex('chatId', 'chatId', { unique: false });
                store.createIndex('chatIndex', ['chatId', 'index'], { unique: false });
            }
            if (!db.objectStoreNames.contains('nodes')) {
                const store = db.createObjectStore('nodes', { keyPath: 'id' });
                store.createIndex('chatId', 'chatId', { unique: false });
                store.createIndex('chatLevel', ['chatId', 'level'], { unique: false });
            }
            if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            storyDbPromise = null;
            reject(request.error || new Error('IndexedDB open failed'));
        };
    });
    return storyDbPromise;
}

async function putStoryDbRecords(storeName, records = []) {
    const cfg = getStoryConfig();
    if (!records.length || !cfg.useIndexedDb) return 0;
    try {
        const db = await openStoryDb();
        if (!db) return 0;
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        for (const record of records) store.put(record);
        await transactionDone(tx);
        return records.length;
    } catch (error) {
        console.warn('[' + EXT_NAME + '] IndexedDB write failed', error);
        ensureStoryMemory().dbStats.enabled = false;
        return 0;
    }
}

async function putStoryDbMeta(key, value) {
    if (!getStoryConfig().useIndexedDb) return;
    try {
        const db = await openStoryDb();
        if (!db) return;
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ key, value, updatedAt: Date.now() });
        await transactionDone(tx);
    } catch (error) {
        console.warn('[' + EXT_NAME + '] IndexedDB meta write failed', error);
    }
}

async function readStoryDbByChat(storeName, chatId = getStoryChatKey()) {
    if (!getStoryConfig().useIndexedDb) return [];
    try {
        const db = await openStoryDb();
        if (!db) return [];
        const tx = db.transaction(storeName, 'readonly');
        const index = tx.objectStore(storeName).index('chatId');
        const records = await requestToPromise(index.getAll(chatId));
        await transactionDone(tx).catch(() => undefined);
        return Array.isArray(records) ? records : [];
    } catch (error) {
        console.warn('[' + EXT_NAME + '] IndexedDB read failed', error);
        return [];
    }
}

async function readStoryDbForCurrentChat(storeName) {
    const primaryKey = getStoryChatKey();
    const records = await readStoryDbByChat(storeName, primaryKey);
    if (records.length) return records;
    const legacyKey = getLegacyStoryChatKey();
    if (!legacyKey || legacyKey === primaryKey) return records;
    const legacyRecords = await readStoryDbByChat(storeName, legacyKey);
    if (legacyRecords.length && storeName === 'messages') {
        const migrated = legacyRecords.map(record => ({ ...record, chatId: primaryKey, migratedFromChatId: legacyKey, updatedAt: Date.now() }));
        putStoryDbRecords('messages', migrated).then(count => {
            if (count) updateStoryDbStats(count, null);
        });
    }
    return legacyRecords;
}

function makeStoryDbMessageRecord(entry, fullText = '') {
    const chatId = getStoryChatKey();
    return {
        ...entry,
        id: entry.id,
        chatId,
        fullText: clampText(fullText || entry.text || '', 20000),
        text: clampText(entry.text || fullText || '', getStoryConfig().maxEntryChars),
        updatedAt: Date.now(),
    };
}

function updateStoryDbStats(messageCount = null, nodeCount = null) {
    const story = ensureStoryMemory();
    story.dbStats ||= { enabled: false, messages: 0, nodes: 0, lastSyncAt: 0, dbName: STORY_DB_NAME };
    story.dbStats.enabled = canUseStoryIndexedDb();
    story.dbStats.dbName = STORY_DB_NAME;
    if (messageCount !== null && messageCount !== undefined && Number.isFinite(Number(messageCount))) story.dbStats.messages = Number(messageCount);
    if (nodeCount !== null && nodeCount !== undefined && Number.isFinite(Number(nodeCount))) story.dbStats.nodes = Number(nodeCount);
    story.dbStats.lastSyncAt = Date.now();
}

function persistStoryEntry(entry, fullText = '') {
    if (!entry || !getStoryConfig().useIndexedDb) return;
    putStoryDbRecords('messages', [makeStoryDbMessageRecord(entry, fullText)]).then(count => {
        if (count) updateStoryDbStats(Math.max(ensureStoryMemory().dbStats?.messages || 0, ensureStoryMemory().entries?.length || 0), null);
    });
}

function persistStoryRows(rows = [], entriesById = new Map()) {
    if (!rows.length || !getStoryConfig().useIndexedDb) return;
    const records = [];
    for (const row of rows) {
        const entry = entriesById.get(row.entryId) || row.entry || createStoryEntry(row.text, 'backfill', row.index);
        records.push(makeStoryDbMessageRecord(entry, row.text));
    }
    putStoryDbRecords('messages', records).then(count => {
        if (count) updateStoryDbStats(count, null);
    });
}

function flattenStoryTreeRecords(story = ensureStoryMemory()) {
    const chatId = getStoryChatKey();
    const records = [];
    for (const level of ['l1', 'l2', 'l3']) {
        for (const node of story.summaryTree?.[level] || []) {
            records.push({ ...node, id: chatId + ':' + node.id, nodeId: node.id, chatId, level: node.level || level.toUpperCase(), updatedAt: Date.now() });
        }
    }
    if (story.rootSummary) records.push({ id: chatId + ':root', nodeId: 'root', chatId, level: 'ROOT', summary: story.rootSummary, at: Date.now(), children: (story.summaryTree?.l3 || []).map(node => node.id), keywords: [...memoryTokens(story.rootSummary)].slice(0, 90), updatedAt: Date.now() });
    return records;
}

function persistStoryTreeSnapshot() {
    const cfg = getStoryConfig();
    if (!cfg.useIndexedDb) return;
    const story = ensureStoryMemory();
    const records = flattenStoryTreeRecords(story);
    putStoryDbRecords('nodes', records).then(count => {
        updateStoryDbStats(story.entries?.length || null, count || records.length);
        putStoryDbMeta(getStoryChatKey() + ':snapshot', {
            chatId: getStoryChatKey(),
            summary: story.summary,
            rootSummary: story.rootSummary,
            facts: story.facts,
            relationships: story.relationships,
            openThreads: story.openThreads,
            characterStates: story.characterStates,
            dbStats: story.dbStats,
        });
    });
}

async function hydrateStoryFromDbIfUseful() {
    const cfg = getStoryConfig();
    const story = ensureStoryMemory();
    if (!cfg.useIndexedDb || (story.entries || []).length) return 0;
    const records = await readStoryDbForCurrentChat('messages');
    if (!records.length) return 0;
    story.entries = records
        .map(record => sanitizeStoryEntry({ ...record, text: record.text || record.fullText }))
        .sort((a, b) => Number(b.index ?? -1) - Number(a.index ?? -1) || Number(b.at || 0) - Number(a.at || 0))
        .slice(0, Math.max(50, Number(cfg.maxEntries) || 800));
    rebuildStorySummaryTree(story);
    updateStoryMemoryInjection();
    renderStoryMemoryFields();
    updateStoryDbStats(records.length, flattenStoryTreeRecords(story).length);
    return records.length;
}

function compactJoin(parts = [], maxChars = 800, separator = '；') {
    const output = [];
    let used = 0;
    for (const part of parts.map(normalizeLine).filter(Boolean)) {
        const next = output.length ? separator + part : part;
        if (used + next.length > maxChars) break;
        output.push(part);
        used += next.length;
    }
    return output.join(separator);
}

function rankTextItems(values = [], tokens = new Set(), limit = 8) {
    return values
        .map(value => ({ value, score: scoreMemoryItem({ summary: value }, tokens, 0) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => item.value);
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

const STORY_SCAFFOLD_TERMS = [
    '剧情要求', '详略安排', '文笔要求', '补充要求', '增项检查', '创作预备',
    '生图处理', '正文模型禁止输出', 'JSON 格式', 'positive_prompt', 'negative_prompt',
    'scene_position', '不要输出任何图片标签', '基于历史对话', '变量更新',
];

function looksLikePromptScaffold(text) {
    const clean = normalizeMultiline(text);
    if (!clean) return false;
    if (/^\s*(?:prompt|negative_prompt|positive_prompt|scene_position)\s*[:：]/mi.test(clean)) return true;
    const lines = clean.split(/\n+/).map(normalizeLine).filter(Boolean);
    const scaffoldLines = lines.filter(line => isInstructionScaffoldLine(line)).length;
    if (scaffoldLines >= 1 && (lines.length <= 3 || scaffoldLines / lines.length >= 0.35)) return true;
    if (/^\s*(?:#{1,6}\s*)?(?:\d+(?:\.\d+)?(?:[.、)]|\s+))?(?:剧情要求|详略安排|文笔要求|补充要求|增项检查|生图处理|创作预备|变量更新|讨论内容|正文|格式|要求)\s*[:：]?/mi.test(clean)) return true;
    const hits = STORY_SCAFFOLD_TERMS.filter(term => clean.includes(term)).length;
    if (hits >= 2) return true;
    const instructionHits = (clean.match(/(?:必须|禁止|要求|输出|JSON|prompt|模型|格式|变量|检查|详略|文笔|补充|基于历史对话|完整描写|图片标签)/gi) || []).length;
    const narrativeMarks = (clean.match(/[。！？!?，“”"「」]/g) || []).length;
    return instructionHits >= 3 && narrativeMarks <= 1;
}

function isInstructionScaffoldLine(line) {
    const clean = normalizeLine(line);
    if (!clean) return true;
    if (/^\s*(?:#{1,6}\s*)?(?:\d+(?:\.\d+)?(?:[.、)]|\s+))?(?:剧情要求|详略安排|文笔要求|补充要求|增项检查|生图处理|创作预备|变量更新|讨论内容|正文|格式|要求)\s*[:：]?\s*$/i.test(clean)) return true;
    if (/^\s*(?:[-*•]|\d+[.、)]|[一二三四五六七八九十]+[、.])\s*(?:讨论内容|正文|变量更新|根据|分析|要求|禁止|输出|检查|基于历史对话)/i.test(clean)) return true;
    if (/^\s*(?:Time passed|Dramatic updates|Faction standing|Relationship updates|Memory updates|Scene position|generation_ended|message_received)\s*[:：]/i.test(clean)) return true;
    if (/^\s*(?:prompt|negative_prompt|positive_prompt|scene_position)\s*[:：]/i.test(clean)) return true;
    if (/(?:基于历史对话|正文模型|禁止输出|图片标签|英文绘图提示词|内嵌配图请求|严格 JSON|JSON 格式|变量更新|完整描写|当前未触发|所有角色使用)/i.test(clean)) return true;
    const hits = STORY_SCAFFOLD_TERMS.filter(term => clean.includes(term)).length;
    return hits >= 2;
}

function looksLikeNarrativeLine(line) {
    const clean = normalizeLine(line);
    if (clean.length < 8 || isInstructionScaffoldLine(clean)) return false;
    if (/^\s*(?:[-*•]|\d+[.、)]|[一二三四五六七八九十]+[、.])/.test(clean)) return false;
    if (!/[\u4e00-\u9fff]/.test(clean)) return false;
    if (/(?:必须|禁止|要求|输出|JSON|prompt|模型|格式|变量|检查|详略|文笔|补充|基于历史对话|完整描写)/i.test(clean) && clean.length < 140) return false;
    return /[。！？!?，,“”"「」]/.test(clean);
}

function stripPromptScaffoldSections(text) {
    const clean = stripGeneratedPromptText(text);
    if (!looksLikePromptScaffold(clean)) return clean;
    const lines = clean.split(/\n+/);
    const start = lines.findIndex(looksLikeNarrativeLine);
    if (start < 0) return '';
    const output = [];
    for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        const normalized = normalizeLine(line);
        if (!normalized) {
            output.push('');
            continue;
        }
        if (/^\s*(?:[-*•]\s*)?(?:Time passed|Dramatic updates|Faction standing|Relationship updates|Memory updates|Scene position|generation_ended|message_received)\s*[:：]/i.test(normalized)) break;
        if (isInstructionScaffoldLine(normalized)) continue;
        output.push(line);
    }
    return normalizeMultiline(output.join('\n')).trim();
}

function cleanStoryText(text) {
    return stripPromptScaffoldSections(text);
}

function prepareSceneText(text) {
    const stripped = stripGeneratedPromptText(text);
    const clean = stripPromptScaffoldSections(stripped);
    if (clean) return clean;
    return looksLikePromptScaffold(stripped) ? '' : stripped;
}

function isStoryIndexableText(text) {
    const clean = cleanStoryText(text);
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
    const clean = cleanStoryText(text);
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
    const clean = cleanStoryText(text);
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

    const clean = cleanStoryText(sourceText);
    if (clean || patch.entry) {
        const entry = sanitizeStoryEntry({ ...createStoryEntry(clean, source, index, patch.entry || {}), ...(patch.entry || {}) });
        story.entries = (story.entries || []).filter(item => item.id !== entry.id);
        story.entries.unshift(entry);
        story.entries = story.entries.slice(0, Math.max(50, Number(cfg.maxEntries) || 800));
        persistStoryEntry(entry, clean);
    }

    rebuildStorySummaryTree(story);
    updateStoryMemoryInjection();
    if (!options.deferRender) renderStoryMemoryFields();
    if (!options.deferSave) saveAll();
}


function getStoryItemIndexRange(item) {
    const points = [item?.index, item?.fromIndex, item?.toIndex]
        .map(value => Number(value))
        .filter(value => Number.isFinite(value) && value >= 0);
    if (!points.length) return null;
    return { from: Math.min(...points), to: Math.max(...points) };
}

function makeStorySummaryNode(level, items, index) {
    const cfg = getStoryConfig();
    const summaries = items.map(item => item.summary || item.preview || item.text).filter(Boolean);
    const max = level === 'L1' ? 260 : level === 'L2' ? 360 : 480;
    const ranges = items.map(getStoryItemIndexRange).filter(Boolean);
    const range = ranges.flatMap(item => [item.from, item.to]);
    const summary = compactJoin(summaries, Math.min(max, cfg.pathSummaryChars || max));
    return {
        id: level + '-' + index + '-' + hashText(summaries.join('\n')).slice(0, 8),
        level,
        at: Math.max(...items.map(item => Number(item.at || 0)), 0),
        summary: summary || compactPreview(summaries.join('；'), max),
        keywords: [...memoryTokens(...summaries, ...items.flatMap(item => item.keywords || []))].slice(0, 100),
        children: items.map(item => item.id).filter(Boolean).slice(0, 80),
        fromIndex: range.length ? Math.min(...range) : undefined,
        toIndex: range.length ? Math.max(...range) : undefined,
    };
}

function rebuildStorySummaryTree(story = ensureStoryMemory()) {
    const cfg = getStoryConfig();
    const entries = [...(story.entries || [])]
        .filter(item => item?.id && (item.summary || item.text))
        .sort((a, b) => Number(a.index ?? 1e9) - Number(b.index ?? 1e9) || Number(a.at || 0) - Number(b.at || 0));
    const l1 = chunkItems(entries, Math.max(3, Number(cfg.l1ChunkSize) || 8)).map((items, index) => makeStorySummaryNode('L1', items, index));
    const l2 = chunkItems(l1, Math.max(3, Number(cfg.l2ChunkSize) || 6)).map((items, index) => makeStorySummaryNode('L2', items, index));
    const l3 = chunkItems(l2, Math.max(3, Number(cfg.l3ChunkSize) || 6)).map((items, index) => makeStorySummaryNode('L3', items, index));
    story.summaryTree = { l1: l1.slice(-80), l2: l2.slice(-32), l3: l3.slice(-12) };
    const rootSource = story.summary || compactJoin(l3.map(node => node.summary), Number(cfg.rootSummaryChars) || 560);
    story.rootSummary = compactPreview(rootSource, Number(cfg.rootSummaryChars) || 560);
    persistStoryTreeSnapshot();
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
    const clean = cleanStoryText(text);
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
    const clean = cleanStoryText(text);
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


function getStoryTreeMaps(story = ensureStoryMemory()) {
    const tree = story.summaryTree || {};
    const maps = { l1: new Map(), l2: new Map(), l3: new Map(), entries: new Map() };
    for (const item of tree.l1 || []) maps.l1.set(item.id, item);
    for (const item of tree.l2 || []) maps.l2.set(item.id, item);
    for (const item of tree.l3 || []) maps.l3.set(item.id, item);
    for (const item of story.entries || []) maps.entries.set(item.id, item);
    return maps;
}

function rankStoryItems(items, tokens, limit = 4, recencyWeight = 0.06) {
    return (items || [])
        .map(item => ({ item, score: scoreMemoryItem(item, tokens, recencyWeight) }))
        .filter(entry => entry.score > 0 || !tokens.size)
        .sort((a, b) => b.score - a.score || Number(b.item.at || 0) - Number(a.item.at || 0))
        .slice(0, Math.max(1, Number(limit) || 4))
        .map(entry => ({ ...entry.item, score: Number(entry.score.toFixed(2)) }));
}

function dedupeStoryItems(items = []) {
    const seenId = new Set();
    const seenText = new Set();
    const output = [];
    for (const item of items) {
        const id = item.id || (item.kind + ':' + item.index);
        const key = normalizeLine(item.summary || item.text).slice(0, 120);
        if ((id && seenId.has(id)) || (key && seenText.has(key))) continue;
        if (id) seenId.add(id);
        if (key) seenText.add(key);
        output.push(item);
    }
    return output;
}

function retrieveStoryPrismPath(query = '', limit = getStoryConfig().maxRetrieved || 8) {
    const cfg = getStoryConfig();
    const story = ensureStoryMemory();
    const tree = story.summaryTree || {};
    const maps = getStoryTreeMaps(story);
    const tokens = memoryTokens(query, getCurrentCharacterName(), story.rootSummary, story.summary, (story.facts || []).slice(0, 12).join(' '));
    const latestIndex = Math.max(0, (chat || []).length - 1);
    const topL3 = rankStoryItems(tree.l3 || [], tokens, 2);
    let l2Pool = topL3.flatMap(node => (node.children || []).map(id => maps.l2.get(id)).filter(Boolean));
    if (!l2Pool.length) l2Pool = tree.l2 || [];
    const topL2 = rankStoryItems(l2Pool, tokens, 2);
    let l1Pool = topL2.flatMap(node => (node.children || []).map(id => maps.l1.get(id)).filter(Boolean));
    if (!l1Pool.length) l1Pool = tree.l1 || [];
    const topL1 = rankStoryItems(l1Pool, tokens, 3);
    let entryPool = topL1.flatMap(node => (node.children || []).map(id => maps.entries.get(id)).filter(Boolean));
    const direct = rankStoryItems((story.entries || []).filter(item => Number(item.index) !== latestIndex), tokens, Math.max(3, Number(limit) || 8), 0.04);
    entryPool = dedupeStoryItems([...entryPool, ...direct]).filter(item => Number(item.index) !== latestIndex);
    const topEntries = rankStoryItems(entryPool, tokens, Math.max(1, Number(cfg.maxOriginalSnippets) || 3), 0.04);
    const path = {
        root: story.rootSummary || compactPreview(story.summary, cfg.rootSummaryChars || 560),
        l3: dedupeStoryItems(topL3).slice(0, 1),
        l2: dedupeStoryItems(topL2).slice(0, 2),
        l1: dedupeStoryItems(topL1).slice(0, 3),
        entries: dedupeStoryItems(topEntries).slice(0, Math.max(1, Number(cfg.maxOriginalSnippets) || 3)),
        tokenHints: { queryTokens: tokens.size, maxInjectChars: cfg.maxInjectChars, maxOriginalSnippets: cfg.maxOriginalSnippets },
    };
    story.lastPrismPath = path;
    return path;
}

function retrieveStoryFlatPath(query = '', limit = getStoryConfig().maxRetrieved || 8) {
    const cfg = getStoryConfig();
    const story = ensureStoryMemory();
    const tree = story.summaryTree || {};
    const tokens = memoryTokens(query, getCurrentCharacterName(), story.rootSummary, story.summary, (story.facts || []).slice(0, 12).join(' '));
    const latestIndex = Math.max(0, (chat || []).length - 1);
    const nodes = rankStoryItems([...(tree.l3 || []), ...(tree.l2 || []), ...(tree.l1 || [])], tokens, Math.max(3, Number(limit) || 8));
    const entries = rankStoryItems((story.entries || []).filter(item => Number(item.index) !== latestIndex), tokens, Math.max(1, Number(cfg.maxOriginalSnippets) || 3), 0.04);
    const path = {
        root: story.rootSummary || compactPreview(story.summary, cfg.rootSummaryChars || 560),
        l3: dedupeStoryItems(nodes.filter(item => item.level === 'L3')).slice(0, 1),
        l2: dedupeStoryItems(nodes.filter(item => item.level === 'L2')).slice(0, 2),
        l1: dedupeStoryItems(nodes.filter(item => item.level === 'L1')).slice(0, 3),
        entries: dedupeStoryItems(entries).slice(0, Math.max(1, Number(cfg.maxOriginalSnippets) || 3)),
        flat: true,
        tokenHints: { queryTokens: tokens.size, maxInjectChars: cfg.maxInjectChars, maxOriginalSnippets: cfg.maxOriginalSnippets },
    };
    story.lastPrismPath = path;
    return path;
}

function retrieveStoryPath(query = '', limit = getStoryConfig().maxRetrieved || 8) {
    return getStoryConfig().prismMode
        ? retrieveStoryPrismPath(query, limit)
        : retrieveStoryFlatPath(query, limit);
}

function retrieveStoryMemories(query = '', limit = getStoryConfig().maxRetrieved || 8) {
    const path = retrieveStoryPath(query, limit);
    const items = dedupeStoryItems([
        ...path.l3.map(item => ({ ...item, kind: 'L3' })),
        ...path.l2.map(item => ({ ...item, kind: 'L2' })),
        ...path.l1.map(item => ({ ...item, kind: 'L1' })),
        ...path.entries.map(item => ({ ...item, kind: '原文' })),
    ]).map(item => ({
        kind: item.kind || item.level || '记忆',
        score: item.score || 0,
        summary: item.summary || item.preview || '',
        text: item.text || item.preview || '',
        name: item.name || '',
        role: item.role || '',
        index: item.index ?? null,
    }));
    ensureStoryMemory().lastRetrieval = items;
    return items;
}

function getLatestStoryQuery() {
    const recent = (chat || [])
        .slice(-6)
        .map(message => cleanStoryText(getMessageText(message)))
        .filter(Boolean)
        .join('\n\n');
    return recent || getCurrentCharacterName();
}


function buildStoryMemoryPrompt(query = '') {
    const cfg = getStoryConfig();
    if (!cfg.enabled || !cfg.injectToPrompt) return '';
    const story = ensureStoryMemory();
    const hasMemory = story.rootSummary || story.summary || (story.facts || []).length || (story.entries || []).length || Object.keys(story.relationships || {}).length;
    if (!hasMemory) return '';
    const path = retrieveStoryPath(query || getLatestStoryQuery(), cfg.maxRetrieved);
    const tokens = memoryTokens(query || getLatestStoryQuery(), getCurrentCharacterName());
    const lines = [
        '[剧情长期记忆]',
        '用途：保持角色设定、世界规则、前文因果、关系变化和未解决伏笔一致；只在相关时自然使用，不要声明你读取了记忆。',
    ];
    if (path.root) lines.push('根摘要：' + compactPreview(path.root, cfg.rootSummaryChars || 560));
    const factLines = rankTextItems(story.facts || [], tokens, 8);
    if (factLines.length) lines.push('关键设定：\n- ' + factLines.join('\n- '));
    const relationshipLines = rankTextItems(formatNamedMemoryMap(story.relationships, 18).split('\n'), tokens, 6).filter(Boolean);
    if (relationshipLines.length) lines.push('关系：\n- ' + relationshipLines.join('\n- '));
    const stateLines = rankTextItems(formatNamedMemoryMap(story.characterStates, 18).split('\n'), tokens, 5).filter(Boolean);
    if (stateLines.length) lines.push('持续状态：\n- ' + stateLines.join('\n- '));
    const threadLines = rankTextItems(story.openThreads || [], tokens, 6);
    if (threadLines.length) lines.push('未解决线索：\n- ' + threadLines.join('\n- '));
    const pathLines = [];
    for (const item of [...path.l3, ...path.l2, ...path.l1]) {
        const range = item.fromIndex !== undefined ? '#' + item.fromIndex + (item.toIndex !== undefined && item.toIndex !== item.fromIndex ? '-' + item.toIndex : '') + ' ' : '';
        pathLines.push((item.level || 'L') + ' ' + range + compactPreview(item.summary, 220));
    }
    if (pathLines.length) lines.push((path.flat ? '命中记忆摘要' : '命中摘要路径') + '：\n- ' + dedupeStoryItems(pathLines.map(summary => ({ summary }))).map(item => item.summary).join('\n- '));
    if (cfg.includeOriginal && path.entries.length) {
        const snippets = path.entries.slice(0, Math.max(1, Number(cfg.maxOriginalSnippets) || 3)).map(item => {
            const prefix = item.index !== null && item.index !== undefined ? '#' + item.index + ' ' : '';
            return prefix + compactPreview(item.text || item.summary, Number(cfg.maxOriginalSnippetChars) || 220);
        });
        if (snippets.length) lines.push('相关原文片段：\n- ' + snippets.join('\n- '));
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
        .map((message, index) => ({ message, index, text: cleanStoryText(getMessageText(message)) }))
        .filter(item => item.text && !item.message?.is_system && isStoryIndexableText(item.text));
    for (const item of rows) {
        const entry = createStoryEntry(item.text, 'backfill', item.index);
        item.entryId = entry.id;
        item.entry = entry;
        existing.set(entry.id, { ...(existing.get(entry.id) || {}), ...entry });
    }
    story.entries = [...existing.values()]
        .sort((a, b) => Number(b.index ?? -1) - Number(a.index ?? -1) || Number(b.at || 0) - Number(a.at || 0))
        .slice(0, Math.max(50, Number(cfg.maxEntries) || 800));
    if (!story.summary && story.entries.length) {
        story.summary = compactPreview(story.entries.slice(0, 16).reverse().map(item => item.summary).join('；'), Math.max(520, Number(cfg.rootSummaryChars) || 560));
    }
    rebuildStorySummaryTree(story);
    persistStoryRows(rows, new Map(story.entries.map(entry => [entry.id, entry])));
    updateStoryMemoryInjection();
    renderStoryMemoryFields();
    saveAll();
    if (!options.silent) setStatus('已回溯索引当前聊天 ' + rows.length + ' 条；PRISM 路径已重建');
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
    cfg.useIndexedDb = bool('storyMemory.useIndexedDb', cfg.useIndexedDb);
    cfg.prismMode = bool('storyMemory.prismMode', cfg.prismMode);
    cfg.injectDepth = num('storyMemory.injectDepth', cfg.injectDepth, 0);
    cfg.maxRetrieved = num('storyMemory.maxRetrieved', cfg.maxRetrieved, 1);
    cfg.maxInjectChars = num('storyMemory.maxInjectChars', cfg.maxInjectChars, 400);
    cfg.maxEntries = num('storyMemory.maxEntries', cfg.maxEntries, 50);
    cfg.maxOriginalSnippets = num('storyMemory.maxOriginalSnippets', cfg.maxOriginalSnippets, 1);
    cfg.maxOriginalSnippetChars = num('storyMemory.maxOriginalSnippetChars', cfg.maxOriginalSnippetChars, 80);
    cfg.rootSummaryChars = num('storyMemory.rootSummaryChars', cfg.rootSummaryChars, 200);
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
    setChecked('storyMemory.useIndexedDb', cfg.useIndexedDb);
    setChecked('storyMemory.prismMode', cfg.prismMode);
    setValue(root, 'storyMemory.injectDepth', cfg.injectDepth);
    setValue(root, 'storyMemory.maxRetrieved', cfg.maxRetrieved);
    setValue(root, 'storyMemory.maxInjectChars', cfg.maxInjectChars);
    setValue(root, 'storyMemory.maxEntries', cfg.maxEntries);
    setValue(root, 'storyMemory.maxOriginalSnippets', cfg.maxOriginalSnippets);
    setValue(root, 'storyMemory.maxOriginalSnippetChars', cfg.maxOriginalSnippetChars);
    setValue(root, 'storyMemory.rootSummaryChars', cfg.rootSummaryChars);
    setValue(root, 'story.summary', story.summary || '');
    setValue(root, 'story.facts', Array.isArray(story.facts) ? story.facts.join('\n') : '');
    setValue(root, 'story.openThreads', Array.isArray(story.openThreads) ? story.openThreads.join('\n') : '');
    setValue(root, 'story.relationships', formatNamedMemoryMap(story.relationships));
    setValue(root, 'story.characterStates', formatNamedMemoryMap(story.characterStates));
    const stats = root.querySelector('[data-role="story-stats"]');
    if (stats) {
        const tree = story.summaryTree || {};
        const injectedLength = (story.lastInjectedPrompt || buildStoryMemoryPrompt(getLatestStoryQuery()) || '').length;
        const db = story.dbStats || {};
        const dbEnabled = Boolean(cfg.useIndexedDb && typeof indexedDB !== 'undefined');
        const dbMessages = Math.max(Number(db.messages || 0), dbEnabled ? (story.entries || []).length : 0);
        stats.textContent = '已索引 ' + (story.entries || []).length + ' 条；L1 ' + (tree.l1 || []).length + ' / L2 ' + (tree.l2 || []).length + ' / L3 ' + (tree.l3 || []).length + '；注入 ' + injectedLength + ' 字；DB ' + (dbEnabled ? '开' : '关') + ' ' + dbMessages + ' 条';
    }
    const retrieval = root.querySelector('[data-role="story-retrieval"]');
    if (retrieval) {
        const items = story.lastRetrieval?.length ? story.lastRetrieval : retrieveStoryMemories(getLatestStoryQuery(), cfg.maxRetrieved);
        retrieval.value = items.map(item => (item.index !== null && item.index !== undefined ? '#' + item.index + ' ' : '') + '[' + item.kind + '] ' + item.summary).join('\n');
    }
    refreshDashboard();
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
    const expanded = [];
    for (const part of parts) {
        const clean = String(part || '').trim();
        if (!clean) continue;
        expanded.push(...clean.split(/\s*,\s*/).filter(Boolean));
    }
    return uniqueParts(expanded).join(', ');
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

function englishSceneTags(scene, sourceText = '') {
    return joinPrompt([
        englishTagsFromText(sourceText),
        englishTagsFromText([scene.location, scene.time, scene.weather, scene.lighting, scene.outfit, scene.expression, scene.action, scene.props].join(' ')),
        scene.camera,
        scene.mood,
    ]);
}

const CHARACTER_ENGLISH_ALIASES = {
    神原樱: 'Kanbara Sakura',
    凛: 'Rin',
    琳: 'Rin',
    樱: 'Sakura',
    櫻: 'Sakura',
    蓝: 'Lan',
    藍: 'Lan',
    诗织: 'Shiori',
    詩織: 'Shiori',
    alens: 'alens',
    Alens: 'alens',
};

function englishCharacterName(name) {
    const clean = normalizeLine(name);
    if (!clean) return '';
    if (CHARACTER_ENGLISH_ALIASES[clean]) return CHARACTER_ENGLISH_ALIASES[clean];
    if (!hasCjk(clean)) return clean;
    return '';
}

function characterIdentityName(focus = {}) {
    const name = normalizeLine(focus.name || '');
    const english = normalizeLine(focus.englishName || englishCharacterName(name));
    if (english) return english;
    if (!name) return '';
    if (!hasCjk(name)) return name;
    return 'original character csid ' + hashText(name).slice(0, 6);
}

function characterIdentityTags(focus, charMemory = {}) {
    const identityName = characterIdentityName(focus);
    if (!identityName) return '';
    const hasAppearance = Boolean(promptPart(charMemory.appearance, true));
    return joinPrompt([
        identityName,
        hasAppearance ? `(consistent ${identityName} identity:1.2)` : '',
        hasAppearance ? 'same face, consistent face' : '',
        'original character design',
    ]);
}

function getKnownCharacterNames() {
    const settings = ensureSettings();
    const chatMemory = ensureChatMemory();
    return uniqueParts([
        getCurrentCharacterName(),
        ...Object.keys(settings.memory.characters || {}),
        ...Object.keys(chatMemory.characters || {}),
        ...Object.keys(CHARACTER_ENGLISH_ALIASES),
    ]).filter(Boolean);
}

function detectFocusCharacters(text) {
    const clean = normalizeMultiline(text);
    const found = [];
    for (const name of getKnownCharacterNames()) {
        if (!name || name === '角色') continue;
        const pattern = hasCjk(name)
            ? new RegExp(escapeRegExp(name), 'i')
            : new RegExp('(^|[^A-Za-z0-9_])' + escapeRegExp(name) + '([^A-Za-z0-9_]|$)', 'i');
        const match = clean.match(pattern);
        if (match) found.push({ name, index: match.index ?? 0 });
    }
    const filtered = [];
    for (const item of found.sort((a, b) => a.index - b.index || b.name.length - a.name.length)) {
        const start = item.index;
        const end = item.index + item.name.length;
        const insideExisting = filtered.some(prev => start >= prev.index && end <= prev.index + prev.name.length);
        if (!insideExisting) filtered.push(item);
    }
    return uniqueParts(filtered.map(item => item.name));
}

function resolveFocusCharacter(text, requestedFocus = '') {
    const candidates = detectFocusCharacters(text);
    const requested = normalizeLine(requestedFocus);
    const current = getCurrentCharacterName();
    const name = requested || candidates[0] || current;
    return {
        name,
        englishName: englishCharacterName(name),
        candidates,
        ambiguous: candidates.length > 1 && !requested,
    };
}

const VISUAL_SUBJECT_RULES = [
    {
        pattern: /书包[^。！？\n]{0,32}(?:书封|封面|漫画|书)|(?:书封|封面|漫画|书)[^。！？\n]{0,32}(?:书包|侧袋)/,
        tags: ['(book cover peeking out of school bag side pocket:1.45)', '(school bag side pocket close-up:1.25)'],
        support: ['forbidden item reveal'],
        camera: 'close-up of the school bag and book cover',
    },
    {
        pattern: /(?:水蜜桃|蜜桃)[^，。！？\n]{0,18}(?:餐桌|勺子)|(?:餐桌|勺子)[^，。！？\n]{0,18}(?:水蜜桃|蜜桃)/,
        tags: ['(honey peach as the main foreground subject:1.45)', '(spoon paused beside the peach:1.25)'],
        support: ['still-life tension on dining table'],
        camera: 'object-focused medium close-up',
    },
    {
        pattern: /草莓牛奶/,
        tags: ['(strawberry milk being handed over:1.35)'],
        support: ['hands exchanging a drink'],
    },
    {
        pattern: /草莓大福/,
        tags: ['(strawberry daifuku in hand:1.35)'],
        support: ['small dessert as visual subject'],
    },
    {
        pattern: /信封|信件|一封信|那封信|这封信|把信|纸条|藏到身后|藏在身后/,
        tags: ['(letter hidden behind the back:1.35)'],
        support: ['secretive hand pose'],
        camera: 'waist-up composition showing the hidden letter',
    },
    {
        pattern: /雨伞|伞/,
        tags: ['(umbrella as visible prop:1.25)'],
        support: ['rainy scene prop'],
    },
    {
        pattern: /自行车|单车|骑车/,
        tags: ['(bicycle scene:1.3)'],
        support: ['character with bicycle'],
        camera: 'full body shot with bicycle',
    },
    {
        pattern: /钥匙/,
        tags: ['(key held in hand:1.25)'],
        support: ['small key prop close to hand'],
    },
    {
        pattern: /手机/,
        tags: ['(phone in hand:1.2)'],
        support: ['phone screen prop'],
    },
    {
        pattern: /背着书包|书包/,
        tags: ['(school bag worn on back:1.25)'],
        support: ['visible school bag straps'],
    },
    {
        pattern: /小皮鞋|皮鞋/,
        tags: ['(leather shoes visible:1.2)'],
        support: ['footsteps emphasized'],
    },
];

const VISUAL_ACTION_RULES = [
    { pattern: /走在前面|走在前方|往前走|向前走|走在前/, tags: ['(walking ahead:1.35)', '(walking away from viewer:1.25)'] },
    { pattern: /头也不回|没有回头|不回头/, tags: ['(not looking back:1.35)', 'back view', 'face turned away'] },
    { pattern: /跺脚|跺地板|踩得啪啪响|脚步很重|用力踩/, tags: ['(stomping footsteps:1.35)', '(leather shoes stomping on the floor:1.25)'] },
    { pattern: /一甩一甩|甩动|甩着|随着步伐/, tags: ['(swaying hair in motion:1.25)'] },
    { pattern: /停在半空|僵在半空|顿在半空/, tags: ['(hand paused in midair:1.3)'] },
    { pattern: /盯着|凝视|注视|看着|望着/, tags: ['(staring at the visual subject:1.25)'] },
    { pattern: /伸手/, tags: ['(reaching hand:1.25)'] },
    { pattern: /拉住|抓住|攥住/, tags: ['(grabbing gesture:1.25)'] },
    { pattern: /袖口/, tags: ['(grabbing sleeve cuff:1.3)'] },
    { pattern: /递给|交给|送给/, tags: ['(offering an item:1.25)'] },
    { pattern: /接过|接过去|收下/, tags: ['(accepting an item:1.25)'] },
    { pattern: /护在怀里|抱在怀里/, tags: ['(holding protectively against chest:1.35)'] },
    { pattern: /抱住|拥抱/, tags: ['(hugging:1.25)'] },
    { pattern: /牵手|牵着/, tags: ['(holding hands:1.25)'] },
    { pattern: /推开/, tags: ['(pushing away:1.25)'] },
    { pattern: /藏到身后|藏在身后/, tags: ['(hiding something behind back:1.35)'] },
    { pattern: /翻找|搜查|检查/, tags: ['(searching through belongings:1.3)'] },
    { pattern: /露出|露出来|探出/, tags: ['(partly peeking out:1.25)'] },
    { pattern: /掉在地上|落在地上|跌落/, tags: ['(object falling to the floor:1.25)'] },
    { pattern: /回头|回过头|回眸|转头/, tags: ['(looking back:1.25)'] },
    { pattern: /转身/, tags: ['(turning away:1.2)'] },
    { pattern: /低头/, tags: ['looking down'] },
    { pattern: /抬头/, tags: ['looking up'] },
    { pattern: /跑|奔跑|冲向/, tags: ['running'] },
    { pattern: /坐|坐在/, tags: ['sitting'] },
    { pattern: /站|站在/, tags: ['standing'] },
    { pattern: /跪|跪下/, tags: ['kneeling'] },
    { pattern: /躺|躺下/, tags: ['lying down'] },
];

const VISUAL_EXPRESSION_RULES = [
    { pattern: /眼眶发红|泪眼|含泪|流泪|哭/, tags: ['(teary eyes:1.25)'] },
    { pattern: /咬唇|咬着嘴唇/, tags: ['(biting lip:1.25)'] },
    { pattern: /脸红|红着脸|羞红/, tags: ['(blushing:1.2)'] },
    { pattern: /皱眉/, tags: ['frowning'] },
    { pattern: /惊讶|愣住|怔住/, tags: ['surprised expression'] },
    { pattern: /紧张|慌张|不安|局促/, tags: ['nervous expression'] },
    { pattern: /冷淡|冷冷|冰冷/, tags: ['cold expression'] },
    { pattern: /认真|专注/, tags: ['serious expression'] },
    { pattern: /微笑|笑了|笑着/, tags: ['smile'] },
    { pattern: /跺脚|跺地板|头也不回|气冲冲|生气|不满/, tags: ['annoyed expression'] },
];

const FIXED_APPEARANCE_RULES = [
    { pattern: /樱粉色[^，。！？\n]{0,8}(?:长发|头发)|粉色[^，。！？\n]{0,8}(?:长发|头发)|粉发/, tags: ['pink hair'] },
    { pattern: /银色[^，。！？\n]{0,8}(?:长发|短发|头发)|银发/, tags: ['silver hair'] },
    { pattern: /白色[^，。！？\n]{0,8}(?:长发|短发|头发)|白发/, tags: ['white hair'] },
    { pattern: /黑色[^，。！？\n]{0,8}(?:长发|短发|头发)|黑发/, tags: ['black hair'] },
    { pattern: /蓝色[^，。！？\n]{0,8}(?:长发|短发|头发)|蓝发/, tags: ['blue hair'] },
    { pattern: /金色[^，。！？\n]{0,8}(?:长发|短发|头发)|金发/, tags: ['blonde hair'] },
    { pattern: /红色[^，。！？\n]{0,8}(?:长发|短发|头发)|红发/, tags: ['red hair'] },
    { pattern: /长发/, tags: ['long hair'] },
    { pattern: /短发/, tags: ['short hair'] },
    { pattern: /蓝色眼睛|蓝眼睛|蓝瞳/, tags: ['blue eyes'] },
    { pattern: /绿色眼睛|绿眼睛|绿瞳/, tags: ['green eyes'] },
    { pattern: /金色眼睛|金眼睛|金瞳/, tags: ['golden eyes'] },
    { pattern: /红色眼睛|红眼睛|红瞳/, tags: ['red eyes'] },
    { pattern: /紫色眼睛|紫眼睛|紫瞳/, tags: ['purple eyes'] },
    { pattern: /黑色眼睛|黑眼睛|黑瞳/, tags: ['black eyes'] },
    { pattern: /兽耳|猫耳|狐耳/, tags: ['animal ears'] },
    { pattern: /翅膀/, tags: ['wings'] },
    { pattern: /龙角|恶魔角|头上有角|长着角/, tags: ['horns'] },
];

function regexHit(pattern, text) {
    const hit = pattern.test(text);
    pattern.lastIndex = 0;
    return hit;
}

function collectSceneRuleValues(rules, text, key = 'tags') {
    const output = [];
    for (const rule of rules) {
        if (!regexHit(rule.pattern, text)) continue;
        const values = Array.isArray(rule[key]) ? rule[key] : [rule[key]];
        output.push(...values.filter(Boolean));
    }
    return uniqueParts(output);
}

function extractFixedAppearanceTags(text) {
    return collectSceneRuleValues(FIXED_APPEARANCE_RULES, normalizeMultiline(text), 'tags');
}

function rememberFixedAppearanceFromScene(name, text) {
    const cleanName = normalizeLine(name);
    if (!cleanName) return '';
    const tags = extractFixedAppearanceTags(text);
    if (!tags.length) return '';
    getCharacterMemory(cleanName);
    const settings = ensureSettings();
    const target = settings.memory.characters[cleanName];
    const existing = cleanEnglishPrompt(target.appearance || '');
    const next = joinPrompt([existing, tags.join(', ')]);
    if (next && next !== existing) {
        target.appearance = next;
    }
    return target.appearance || '';
}

function detectScenePersonCount(text, candidates = []) {
    const clean = normalizeMultiline(text);
    let count = uniqueParts(candidates || []).length;
    if (/三人|三个人|三位|众人|大家|一群|几个人|几名|多人/.test(clean)) count = Math.max(count, 3);
    if (/两人|两个人|二人|双方|彼此|互相|对方/.test(clean)) count = Math.max(count, 2);
    if (/(递给|交给|送给|从[^，。！？\n]{1,24}手里|牵着|对视|看向|望向|推开|靠近|贴近)/.test(clean)) {
        count = Math.max(count, 2);
    }
    if (/(?:拉住|抓住|攥住)[^，。！？\n]{0,12}(?:袖口|衣角|手|手腕|胳膊|肩膀|他|她|你|我)/.test(clean)) {
        count = Math.max(count, 2);
    }
    if (/抱住(?:他|她|你|我|[^，。！？\n]{1,8}(?:肩|腰|身体))/.test(clean)) {
        count = Math.max(count, 2);
    }
    if (!count && /(她|他|你|我|少女|少年|女人|男人|女孩|男孩)/.test(clean)) count = 1;
    return Math.min(Math.max(count, 0), 4);
}

function buildPeopleCompositionTags(count, focus) {
    if (count >= 3) return ['group scene', 'multiple characters visible', 'clear separation between characters'];
    if (count >= 2) {
        return uniqueParts([
            'duo',
            'two character composition',
            'character interaction',
            focus?.englishName ? 'visual focus on ' + focus.englishName : '',
            'clear separation between characters',
        ]);
    }
    if (count === 1) return ['solo', 'single character composition'];
    return [];
}

function buildSceneAnchor(inputText, localScene, focus) {
    const clean = normalizeMultiline(inputText);
    const subjectTags = collectSceneRuleValues(VISUAL_SUBJECT_RULES, clean, 'tags');
    const actionTags = collectSceneRuleValues(VISUAL_ACTION_RULES, clean, 'tags');
    const expressionTags = collectSceneRuleValues(VISUAL_EXPRESSION_RULES, clean, 'tags');
    const supportTags = collectSceneRuleValues(VISUAL_SUBJECT_RULES, clean, 'support');
    const cameraTags = collectSceneRuleValues(VISUAL_SUBJECT_RULES, clean, 'camera');
    const peopleCount = detectScenePersonCount(clean, focus?.candidates || []);
    const peopleTags = buildPeopleCompositionTags(peopleCount, focus);
    const hasStrongAnchor = Boolean(subjectTags.length || actionTags.length || expressionTags.length);
    const camera = cameraTags[0] || localScene.camera || inferCamera(clean);
    const negativeTags = uniqueParts([
        hasStrongAnchor ? 'unrelated portrait' : '',
        hasStrongAnchor ? 'generic standing pose' : '',
        hasStrongAnchor ? 'wrong scene' : '',
        /头也不回|没有回头|不回头/.test(clean) ? 'looking back' : '',
        /头也不回|没有回头|不回头/.test(clean) ? 'looking at viewer' : '',
        /走在前面|走在前方|往前走|向前走|跺脚|跺地板|踩得啪啪响/.test(clean) ? 'sitting' : '',
        peopleCount >= 2 ? 'solo portrait' : '',
        peopleCount >= 2 ? 'merged faces' : '',
        peopleCount >= 2 ? 'mixed outfits' : '',
    ]);
    return {
        positive: joinPrompt([
            subjectTags.join(', '),
            actionTags.join(', '),
            expressionTags.join(', '),
            peopleTags.join(', '),
            supportTags.join(', '),
            camera,
        ]),
        negative: joinPrompt(negativeTags),
        peopleCount,
        hasStrongAnchor,
        subjectTags,
        actionTags,
        expressionTags,
        supportTags,
        camera,
    };
}

function selectedTextCoreTags(inputText, localScene, focus, sceneAnchor = null) {
    const clean = normalizeMultiline(inputText);
    const anchor = sceneAnchor || buildSceneAnchor(clean, localScene, focus);
    return joinPrompt([
        anchor.positive,
        focus?.englishName,
        englishSceneTags(localScene, clean),
        /接过|接过去|收下/.test(clean) && /草莓牛奶/.test(clean) ? 'accepting strawberry milk' : '',
        /餐桌/.test(clean) && /水蜜桃|蜜桃/.test(clean) ? 'honey peach on dining table' : '',
        /勺子/.test(clean) ? 'spoon in hand' : '',
        /樱粉色[^，。！？\n]{0,12}长发|粉色[^，。！？\n]{0,12}长发|粉发[^，。！？\n]{0,12}长发/.test(clean) ? '(pink long hair:1.2)' : '',
        /准备给樱|给樱|送给樱/.test(clean) ? 'meant for Sakura, gift for Sakura' : '',
        /草莓大福/.test(clean) ? 'strawberry daifuku' : '',
        /护在怀里|抱在怀里/.test(clean) ? 'holding protectively against chest' : '',
        /另一边|另一侧/.test(clean) ? 'separate positions in the room' : '',
    ]);
}

function buildAnimaStyleTags(inputText, focus = {}, charMemory = {}) {
    const story = ensureStoryMemory();
    const hintText = normalizeMultiline([
        inputText,
        focus?.name || '',
        charMemory.appearance || '',
        charMemory.currentOutfit || '',
        story.summary || '',
        Array.isArray(story.facts) ? story.facts.slice(0, 12).join(' ') : '',
    ].join('\n'));
    const worldTags = ANIMA_STYLE_PROFILES
        .filter(profile => regexHit(profile.pattern, hintText))
        .slice(0, 2)
        .map(profile => profile.tags);
    const characterTags = ANIMA_CHARACTER_STYLE_PROFILES
        .filter(profile => regexHit(profile.pattern, hintText))
        .slice(0, 1)
        .map(profile => profile.tags);
    return joinPrompt([
        worldTags.length ? worldTags.join(', ') : 'polished anime key visual, clean lineart, expressive eyes, refined color design',
        characterTags.join(', '),
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

    const locationMatch = clean.match(/(?:在|来到|走进|进入|回到|躲进|站在|坐在)([^，。！？\n]{1,24}(?:房间|卧室|客厅|浴室|厨房|街道|巷子|教室|办公室|风纪委员室|委员会办公室|图书馆|阅览室|教学楼|森林|旅馆|酒店|床边|窗边|门口|走廊|屋顶|车里|沙发|浴缸|庭院|阳台))/);
    if (locationMatch) result.location = locationMatch[1];

    const outfitMatch = clean.match(/(?:穿着|换上|披着|脱下|套着|裹着|身上是|衣服是)([^，。！？\n]{1,32})/);
    if (outfitMatch) result.outfit = outfitMatch[1];

    const expressionMatch = clean.match(/(微笑|笑了|脸红|害羞|哭|流泪|眼眶发红|含泪|咬唇|咬着嘴唇|皱眉|惊讶|愣住|怔住|愤怒|温柔|冷淡|紧张|慌张|不安|迷茫|疲惫|兴奋|委屈|认真|羞涩)/);
    if (expressionMatch) result.expression = expressionMatch[1];

    const timeMatch = clean.match(/(清晨|早晨|上午|中午|下午|黄昏|傍晚|夜晚|深夜|凌晨|雨夜|雪夜)/);
    if (timeMatch) result.time = timeMatch[1];

    const weatherMatch = clean.match(/(下雨|雨中|雨夜|暴雨|小雨|下雪|雪中|雪夜|大雪|雾|薄雾|晴朗|阴天|雷雨|风很大)/);
    if (weatherMatch) result.weather = normalizeWeatherFromText(weatherMatch[1]);

    const lightingMatch = clean.match(/(阳光|月光|灯光|烛光|霓虹|昏暗|逆光|暖光|冷光|阴影|晨光|夕阳|夕光|夕照|落日)/);
    if (lightingMatch) result.lighting = lightingMatch[1];

    const actionMatches = clean.match(/(?:她|他|你|我|少女|男人|女人|女孩|少年|[^，。！？\n]{1,10})(?:轻轻|慢慢|突然|正|正在)?(?:抱住|靠近|坐下|站起|躺下|跪下|回头|回过头|头也不回|低头|抬头|伸手|握住|抓住|亲吻|凝视|注视|盯着|看着|推开|拉住|转身|蜷缩|倚着|贴近|递给|接过|收下|藏到|藏在|翻找|搜查|检查|露出|甩开|甩动|骑着|奔跑|走在前面|走在前方|往前走|向前走|跺脚|跺地板|踩得啪啪响|停在半空|顿在半空|掉在地上|落在地上)[^，。！？\n]{0,28}/g);
    if (actionMatches?.length) result.action = actionMatches.slice(-2).join(', ');

    const propMatch = clean.match(/(?:拿着|握着|抱着|捧着|戴着|递给|接过|收下|藏着|藏到身后|藏在身后|露出|翻找)([^，。！？\n]{1,24})/);
    if (propMatch) result.props = propMatch[1];

    result.camera = inferCamera(clean);
    result.mood = inferMood(clean);
    return result;
}

function inferCamera(text) {
    if (/头也不回|走在前面|走在前方|往前走|向前走/.test(text)) return 'full body back view, walking composition';
    if (/全身|站在|走在|奔跑|街道|森林|大厅/.test(text)) return 'full body, environmental shot';
    if (/脸|眼睛|泪|亲吻|靠近|凝视|低声/.test(text)) return 'close-up, intimate framing';
    if (/坐|沙发|床边|桌前|拥抱/.test(text)) return 'medium shot';
    return '';
}

function inferMood(text) {
    if (/头也不回|跺脚|跺地板|踩得啪啪响|气冲冲|生气|不满/.test(text)) return 'annoyed atmosphere';
    if (/紧张|害怕|颤抖|危险|压抑/.test(text)) return 'tense atmosphere';
    if (/温柔|安心|轻轻|微笑|拥抱/.test(text)) return 'tender atmosphere';
    if (/暧昧|脸红|贴近|亲吻/.test(text)) return 'romantic tension';
    if (/战斗|怒|冲|血|破碎/.test(text)) return 'dramatic tension';
    return '';
}

function buildShotCard(inputText, localScene, focus = resolveFocusCharacter(inputText)) {
    const chatMemory = ensureChatMemory();
    const name = focus.name || getCurrentCharacterName();
    const charMemory = getCharacterMemory(name);
    const sceneAnchor = buildSceneAnchor(inputText, localScene, focus);
    const lines = [
        `人物: ${name}`,
        `焦点候选: ${focus.candidates?.length ? focus.candidates.join(' / ') : '未检测到'}`,
        `视觉主体: ${sceneAnchor.subjectTags?.length ? sceneAnchor.subjectTags.join(', ') : '按剧情动作/人物构图'}`,
        `固定外观: ${charMemory.appearance || '未填写'}`,
        `当前服装: ${localScene.outfit || charMemory.currentOutfit || '未填写'}`,
        `地点: ${localScene.location || chatMemory.scene.location || '未填写'}`,
        `时间/光线: ${localScene.time || chatMemory.scene.time || ''} ${localScene.lighting || chatMemory.scene.lighting || ''}`.trim(),
        `动作: ${localScene.action || charMemory.pose || '未填写'}`,
        `表情/氛围: ${localScene.expression || charMemory.expression || ''} ${localScene.mood || chatMemory.scene.mood || ''}`.trim(),
        `镜头: ${localScene.camera || ANIMA_DEFAULT_CAMERA}`,
        `剧情段落: ${compactPreview(inputText, 220)}`,
    ];
    return lines.join('\n');
}

function compilePrompt(inputText, options = {}) {
    const settings = ensureSettings();
    const chatMemory = ensureChatMemory();
    const focus = resolveFocusCharacter(inputText, options.focusCharacter);
    const name = focus.name || getCurrentCharacterName();
    const charMemory = getCharacterMemory(name);
    const localScene = extractSceneLocal(inputText);
    const sceneAnchor = buildSceneAnchor(inputText, localScene, focus);
    const selectedHasDynamicAnchor = Boolean(sceneAnchor.hasStrongAnchor || localScene.action || localScene.props);
    const sceneLocation = localScene.location || (selectedHasDynamicAnchor ? '' : chatMemory.scene.location);
    const sceneTime = localScene.time || (selectedHasDynamicAnchor ? '' : chatMemory.scene.time);
    const sceneWeather = localScene.weather || (selectedHasDynamicAnchor ? '' : chatMemory.scene.weather);
    const sceneLighting = localScene.lighting || (selectedHasDynamicAnchor ? '' : chatMemory.scene.lighting);
    const sceneMood = localScene.mood || (selectedHasDynamicAnchor ? '' : chatMemory.scene.mood);
    const outfit = localScene.outfit || charMemory.currentOutfit;
    const expression = localScene.expression || (selectedHasDynamicAnchor ? '' : charMemory.expression);
    const pose = localScene.action || (selectedHasDynamicAnchor ? '' : charMemory.pose);
    const longTerm = chatMemory.longTerm || {};
    const visualNotes = Array.isArray(longTerm.visualNotes) ? longTerm.visualNotes.slice(0, 6).join(', ') : '';
    const englishOnly = true;
    const visualNotesForPrompt = selectedHasDynamicAnchor ? '' : visualNotes;
    const translatedInput = englishSceneTags(localScene, inputText);
    const promptName = characterIdentityName(focus);
    const identityTags = characterIdentityTags(focus, charMemory);
    const styleTags = buildAnimaStyleTags(inputText, focus, charMemory);
    const coreSceneTags = selectedTextCoreTags(inputText, localScene, focus, sceneAnchor);

    const positive = cleanEnglishPrompt(joinPrompt([
        ANIMA_QUALITY_PREFIX,
        styleTags,
        coreSceneTags,
        promptName,
        identityTags,
        promptPart(charMemory.appearance, englishOnly),
        promptPart(charMemory.accessories, englishOnly),
        promptPart(outfit, englishOnly),
        promptPart(charMemory.state, englishOnly),
        promptPart(visualNotesForPrompt, englishOnly),
        promptPart(sceneLocation, englishOnly),
        promptPart(sceneTime, englishOnly),
        promptPart(sceneWeather, englishOnly),
        promptPart(sceneLighting, englishOnly),
        promptPart(sceneMood, englishOnly),
        promptPart(localScene.props, englishOnly),
        promptPart(expression, englishOnly),
        promptPart(pose, englishOnly),
        localScene.camera || ANIMA_DEFAULT_CAMERA,
        translatedInput,
    ]));

    const negative = cleanEnglishPrompt(joinPrompt([
        ANIMA_BASE_NEGATIVE,
        sceneAnchor.negative,
        charMemory.negative,
    ]));

    const shotCard = buildShotCard(inputText, localScene, focus);
    return { positive, negative, shotCard, localScene, focus, sceneAnchor };
}

function updateMemoryFromSelectedScene(inputText, localScene, focusName = getCurrentCharacterName()) {
    const chatMemory = ensureChatMemory();
    const name = normalizeLine(focusName) || getCurrentCharacterName();
    if (localScene.location) chatMemory.scene.location = localScene.location;
    if (localScene.time) chatMemory.scene.time = localScene.time;
    if (localScene.weather) chatMemory.scene.weather = localScene.weather;
    if (localScene.lighting) chatMemory.scene.lighting = localScene.lighting;
    if (localScene.mood) chatMemory.scene.mood = localScene.mood;
    rememberFixedAppearanceFromScene(name, inputText);
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
                content: JSON.stringify({
                    selectedText: text,
                    currentCharacter: getCurrentCharacterName(),
                    localScene,
                    currentMemory,
                    animaQualityPrefix: ANIMA_QUALITY_PREFIX,
                    animaStyleTags: buildAnimaStyleTags(text, resolveFocusCharacter(text), getCharacterMemory(resolveFocusCharacter(text).name)),
                    camera: localScene.camera || ANIMA_DEFAULT_CAMERA,
                    baseNegative: ANIMA_BASE_NEGATIVE,
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
        if (!response.ok) throw new Error('API ' + response.status);
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? data;
        const parsed = parsePatchContent(content);
        return {
            positive: cleanEnglishPrompt(parsed.positive_prompt || parsed.positive || ''),
            negative: cleanEnglishPrompt(parsed.negative_prompt || parsed.negative || ''),
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
    const clean = cleanEnglishPrompt(positive).trim();
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
    settings.behavior.promptLanguage = 'en';
    settings.behavior.preferClipboard = root.querySelector('[name="behavior.preferClipboard"]')?.checked ?? true;
    settings.chatu8.enabled = root.querySelector('[name="chatu8.enabled"]')?.checked ?? true;
    settings.chatu8.insertToChatInput = root.querySelector('[name="chatu8.insertToChatInput"]')?.checked ?? true;
    settings.chatu8.startTag = root.querySelector('[name="chatu8.startTag"]')?.value || '[';
    settings.chatu8.endTag = root.querySelector('[name="chatu8.endTag"]')?.value || ']';
    readStorySettingsFromForm(root);
    settings.prompt.stylePreset = 'anime';
    settings.prompt.quality = ANIMA_QUALITY_PREFIX;
    settings.prompt.positivePrefix = '';
    settings.prompt.negative = ANIMA_BASE_NEGATIVE;
    settings.prompt.camera = ANIMA_DEFAULT_CAMERA;
    saveAll();
}

function readFormToMemory() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    if (!root) return;
    const name = getCurrentCharacterName();
    let settings = ensureSettings();
    const chatMemory = ensureChatMemory();
    getCharacterMemory(name);
    settings = ensureSettings();
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
    refreshDashboard();
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

function setTextByRole(root, role, value) {
    root?.querySelectorAll?.('[data-role="' + role + '"]').forEach(el => {
        el.textContent = value ?? '';
    });
}

function summarizeValue(value, fallback = '未记录', length = 28) {
    const clean = normalizeLine(value);
    return clean ? compactPreview(clean, length) : fallback;
}

function refreshDashboard() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    if (!root) return;
    const settings = ensureSettings();
    const chatMemory = ensureChatMemory();
    const story = ensureStoryMemory();
    const name = getCurrentCharacterName();
    const charMemory = getCharacterMemory(name);
    const db = story.dbStats || {};
    setTextByRole(root, 'dash-character', summarizeValue(name, '未选择角色', 18));
    setTextByRole(root, 'dash-location', summarizeValue(chatMemory.scene?.location, '地点待识别', 22));
    setTextByRole(root, 'dash-outfit', summarizeValue(charMemory.currentOutfit, '服装待识别', 22));
    setTextByRole(root, 'dash-api', settings.api.enabled ? summarizeValue(settings.api.model, 'API 已启用', 24) : '本地快速模式');
    setTextByRole(root, 'dash-story', (story.entries || []).length + ' 条剧情记忆');
    setTextByRole(root, 'dash-db', settings.storyMemory?.useIndexedDb ? 'DB ' + (db.enabled ? '已连接' : '待连接') : 'DB 关闭');
    setTextByRole(root, 'dash-chatu8', settings.chatu8?.enabled ? '智绘姬标签开启' : '仅生成提示词');
    setTextByRole(root, 'dash-visual', summarizeValue([chatMemory.scene?.time, chatMemory.scene?.lighting].filter(Boolean).join(' / '), '时间光线待识别', 24));
    renderDiagnostics(buildDiagnostics());
}

function isChatu8Detected() {
    return Boolean(
        extension_settings?.['st-chatu8']
        || document.querySelector('#st-chatu8-settings')
        || [...document.scripts].some(script => String(script.src || '').includes('/st-chatu8/')),
    );
}

function diagnosticItem(state, icon, title, detail, action = '') {
    return { state, icon, title, detail, action };
}

function buildDiagnostics() {
    const settings = ensureSettings();
    const story = ensureStoryMemory();
    const db = story.dbStats || {};
    const chatu8Detected = isChatu8Detected();
    const apiReady = settings.api.enabled && settings.api.url && settings.api.model;
    const storyReady = settings.storyMemory?.enabled && settings.storyMemory?.autoIndex && settings.storyMemory?.injectToPrompt;
    const tagReady = Boolean(settings.chatu8?.enabled && settings.chatu8?.startTag && settings.chatu8?.endTag);
    return [
        diagnosticItem(
            chatu8Detected && settings.chatu8?.enabled ? 'ok' : settings.chatu8?.enabled ? 'warn' : 'bad',
            'fa-wand-magic-sparkles',
            '智绘姬识别',
            chatu8Detected ? '已检测到智绘姬，方括号标签可被接管。' : '未检测到智绘姬，仍可复制提示词。',
            chatu8Detected ? '' : '确认已安装 st-chatu8',
        ),
        diagnosticItem(
            tagReady ? 'ok' : 'bad',
            'fa-code',
            '触发标签',
            tagReady ? `${settings.chatu8.startTag} prompt ${settings.chatu8.endTag}` : '开始/结束标记缺失。',
            tagReady ? '' : '使用推荐配置',
        ),
        diagnosticItem(
            storyReady ? 'ok' : 'warn',
            'fa-book-open',
            '剧情记忆',
            storyReady ? `${(story.entries || []).length} 条已索引，生成正文会注入相关记忆。` : '长期剧情记忆未完全开启。',
            storyReady ? '' : '开启记忆/自动索引/正文注入',
        ),
        diagnosticItem(
            settings.storyMemory?.useIndexedDb && typeof indexedDB !== 'undefined' ? 'ok' : 'warn',
            'fa-database',
            '本地数据库',
            settings.storyMemory?.useIndexedDb ? (db.enabled ? `IndexedDB 已连接，${db.messages || 0} 条原文。` : 'IndexedDB 将在索引后连接。') : '本地数据库关闭，长篇记忆会变弱。',
            settings.storyMemory?.useIndexedDb ? '' : '开启本地 DB',
        ),
        diagnosticItem(
            apiReady ? 'ok' : settings.api.enabled ? 'warn' : 'ok',
            'fa-plug-circle-bolt',
            '额外 API',
            apiReady ? `模型：${settings.api.model}` : settings.api.enabled ? 'API 已启用但地址或模型不完整。' : '当前使用本地快速抽取，不阻塞正文。',
            apiReady || !settings.api.enabled ? '' : '填写地址并刷新模型',
        ),
        diagnosticItem(
            state.messageMenuBound ? 'ok' : 'warn',
            'fa-hand-pointer',
            '选段入口',
            state.messageMenuBound ? '正文选段菜单已绑定，可直接选一段生成。' : '选段菜单尚未绑定。',
            state.messageMenuBound ? '' : '刷新页面',
        ),
        diagnosticItem(
            settings.behavior?.preferClipboard ? 'ok' : 'warn',
            'fa-clipboard',
            '剪贴板取材',
            settings.behavior?.preferClipboard ? '优先读取剪贴板，适合手机复制段落。' : '剪贴板优先关闭。',
            settings.behavior?.preferClipboard ? '' : '使用推荐配置',
        ),
    ];
}

function renderDiagnostics(items = state.lastDiagnostics.length ? state.lastDiagnostics : buildDiagnostics()) {
    state.lastDiagnostics = items;
    const root = document.querySelector(SETTINGS_SELECTOR);
    if (!root) return items;
    const list = root.querySelector('[data-role="diagnostics-list"]');
    const summary = root.querySelector('[data-role="diagnostics-summary"]');
    const okCount = items.filter(item => item.state === 'ok').length;
    const badCount = items.filter(item => item.state === 'bad').length;
    const warnCount = items.filter(item => item.state === 'warn').length;
    if (summary) {
        summary.textContent = badCount ? `${okCount}/${items.length} 就绪，${badCount} 项需处理` : warnCount ? `${okCount}/${items.length} 就绪，${warnCount} 项可优化` : '全部就绪';
        summary.dataset.state = badCount ? 'bad' : warnCount ? 'warn' : 'ok';
    }
    if (list) {
        list.innerHTML = items.map(item => `
            <div class="csid-diagnostic is-${item.state}">
                <i class="fa-solid ${item.icon}"></i>
                <div>
                    <b>${escapeHtml(item.title)}</b>
                    <span>${escapeHtml(item.detail)}</span>
                    ${item.action ? `<em>${escapeHtml(item.action)}</em>` : ''}
                </div>
            </div>
        `).join('');
    }
    return items;
}

function runDiagnostics() {
    updateStoryMemoryInjection(getLatestStoryQuery());
    refreshDashboard();
    const items = renderDiagnostics(buildDiagnostics());
    const badCount = items.filter(item => item.state === 'bad').length;
    const warnCount = items.filter(item => item.state === 'warn').length;
    setStatus(badCount ? `体检完成：${badCount} 项需要处理` : warnCount ? `体检完成：${warnCount} 项可以优化` : '体检完成：全部就绪');
    return items;
}

function applyRecommendedSettings() {
    const settings = ensureSettings();
    settings.behavior.autoMemory = true;
    settings.behavior.preferClipboard = true;
    settings.behavior.syncTavernHelper = Boolean(getTavernHelper());
    settings.behavior.allowPermanentOverwrite = false;
    settings.behavior.promptLanguage = 'en';
    settings.chatu8.enabled = true;
    settings.chatu8.insertToChatInput = false;
    settings.chatu8.startTag = '[';
    settings.chatu8.endTag = ']';
    settings.storyMemory.enabled = true;
    settings.storyMemory.autoIndex = true;
    settings.storyMemory.injectToPrompt = true;
    settings.storyMemory.includeOriginal = true;
    settings.storyMemory.useIndexedDb = true;
    settings.storyMemory.prismMode = true;
    settings.storyMemory.useApiSummary = Boolean(settings.api.enabled && settings.api.url);
    settings.storyMemory.maxRetrieved = Math.max(8, Number(settings.storyMemory.maxRetrieved) || 8);
    settings.storyMemory.maxInjectChars = Math.max(1600, Number(settings.storyMemory.maxInjectChars) || 1600);
    settings.storyMemory.maxOriginalSnippets = Math.max(3, Number(settings.storyMemory.maxOriginalSnippets) || 3);
    fillFormFromSettings();
    renderMemoryFields();
    renderDiagnostics(buildDiagnostics());
    saveAll();
    setStatus('已应用推荐配置：手选生图 + 智绘姬接管 + 长期剧情记忆');
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
    const preferClipboard = root.querySelector('[name="behavior.preferClipboard"]');
    if (preferClipboard) preferClipboard.checked = settings.behavior.preferClipboard;
    const chatu8Enabled = root.querySelector('[name="chatu8.enabled"]');
    if (chatu8Enabled) chatu8Enabled.checked = settings.chatu8.enabled;
    const chatu8Insert = root.querySelector('[name="chatu8.insertToChatInput"]');
    if (chatu8Insert) chatu8Insert.checked = settings.chatu8.insertToChatInput;
    setValue(root, 'chatu8.startTag', settings.chatu8.startTag);
    setValue(root, 'chatu8.endTag', settings.chatu8.endTag);
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
                    <div class="csid-dashboard">
                        <div class="csid-brand-row">
                            <div class="csid-brand-mark"><i class="fa-solid fa-clapperboard"></i></div>
                            <div class="csid-brand-copy">
                                <b>${EXT_NAME}</b>
                                <span>选段生图 · 视觉一致 · 剧情长期记忆</span>
                            </div>
                        </div>
                        <div class="csid-status">
                            <i class="fa-solid fa-circle-info"></i>
                            <span data-role="status">就绪</span>
                        </div>
                        <div class="csid-kpi-grid">
                            <div class="csid-kpi"><i class="fa-solid fa-user"></i><span>角色</span><b data-role="dash-character">未选择角色</b></div>
                            <div class="csid-kpi"><i class="fa-solid fa-location-dot"></i><span>地点</span><b data-role="dash-location">地点待识别</b></div>
                            <div class="csid-kpi"><i class="fa-solid fa-shirt"></i><span>服装</span><b data-role="dash-outfit">服装待识别</b></div>
                            <div class="csid-kpi"><i class="fa-solid fa-layer-group"></i><span>剧情</span><b data-role="dash-story">0 条剧情记忆</b></div>
                        </div>
                        <div class="csid-pill-row">
                            <span class="csid-pill"><i class="fa-solid fa-wand-magic-sparkles"></i><span data-role="dash-chatu8">智绘姬标签开启</span></span>
                            <span class="csid-pill"><i class="fa-solid fa-database"></i><span data-role="dash-db">DB 待连接</span></span>
                            <span class="csid-pill"><i class="fa-solid fa-plug"></i><span data-role="dash-api">本地快速模式</span></span>
                            <span class="csid-pill"><i class="fa-solid fa-sun"></i><span data-role="dash-visual">时间光线待识别</span></span>
                        </div>
                        <div class="csid-quick-actions">
                            <button class="menu_button result-control" data-action="run-diagnostics"><i class="fa-solid fa-stethoscope"></i><span>一键体检</span></button>
                            <button class="menu_button" data-action="apply-recommended"><i class="fa-solid fa-bolt"></i><span>推荐配置</span></button>
                            <span class="csid-diagnostic-summary" data-role="diagnostics-summary" data-state="warn">等待体检</span>
                        </div>
                        <details class="csid-diagnostics">
                            <summary><i class="fa-solid fa-list-check"></i> 就绪清单</summary>
                            <div class="csid-diagnostics-list" data-role="diagnostics-list"></div>
                        </details>
                    </div>

                    <div class="csid-tabs">
                        <button class="menu_button csid-tab is-active" data-tab="compose"><i class="fa-solid fa-image"></i><span>生图工作台</span></button>
                        <button class="menu_button csid-tab" data-tab="memory"><i class="fa-solid fa-palette"></i><span>视觉记忆</span></button>
                        <button class="menu_button csid-tab" data-tab="story"><i class="fa-solid fa-book-open"></i><span>剧情记忆</span></button>
                        <button class="menu_button csid-tab" data-tab="settings"><i class="fa-solid fa-sliders"></i><span>设置</span></button>
                    </div>

                    <section class="csid-panel is-active" data-panel="compose">
                        <div class="csid-section-head">
                            <div>
                                <b><i class="fa-solid fa-route"></i> 主流程</b>
                                <span>取材 → 导演 → 写回原文 → 智绘姬出图</span>
                            </div>
                        </div>
                        <div class="csid-workflow">
                            <div><i class="fa-solid fa-highlighter"></i><b>选剧情</b><span>正文选段或剪贴板</span></div>
                            <div><i class="fa-solid fa-wand-sparkles"></i><b>出 Prompt</b><span>英文标签 + 镜头卡</span></div>
                            <div><i class="fa-solid fa-pen-to-square"></i><b>写回</b><span>插入原文下方</span></div>
                            <div><i class="fa-solid fa-image"></i><b>生图</b><span>智绘姬按钮接管</span></div>
                        </div>
                        <textarea class="text_pole csid-textarea" data-role="scene-input" placeholder="粘贴或读取一段剧情，例如：走廊尽头的夕光照在银发少女的制服袖口上……"></textarea>
                        <div class="csid-actions csid-primary-actions">
                            <button class="menu_button result-control csid-hero-action" data-action="auto-image"><i class="fa-solid fa-wand-magic-sparkles"></i><span>写入原文下方</span></button>
                            <button class="menu_button csid-main-action" data-action="compose"><i class="fa-solid fa-eye"></i><span>预览 Prompt</span></button>
                        </div>
                        <div class="csid-action-strip">
                            <button class="menu_button" data-action="read-selection"><i class="fa-solid fa-i-cursor"></i><span>读取选中</span></button>
                            <button class="menu_button" data-action="read-clipboard"><i class="fa-solid fa-clipboard"></i><span>剪贴板</span></button>
                            <button class="menu_button" data-action="use-latest"><i class="fa-solid fa-clock-rotate-left"></i><span>最新回复</span></button>
                            <button class="menu_button" data-action="use-recent"><i class="fa-solid fa-list-check"></i><span>勾选消息</span></button>
                        </div>
                        <div class="csid-capture-strip">
                            <button class="menu_button" data-action="capture-start"><i class="fa-solid fa-location-crosshairs"></i><span>开始取景</span></button>
                            <button class="menu_button" data-action="capture-end"><i class="fa-solid fa-flag-checkered"></i><span>结束取景</span></button>
                            <button class="menu_button result-control" data-action="capture-preview"><i class="fa-solid fa-clapperboard"></i><span>生成这一幕</span></button>
                            <div class="csid-capture-status" data-role="capture-status">取景点未设置</div>
                        </div>
                        <div class="csid-module">
                            <div class="csid-module-head">
                                <b><i class="fa-solid fa-comments"></i> 最近消息</b>
                                <span>勾选多条可拼成一段剧情</span>
                            </div>
                            <div class="csid-recent" data-role="recent-messages"></div>
                        </div>
                        <div class="csid-result-grid csid-result-focus">
                            <div class="csid-result-block is-trigger">
                                <label class="csid-label"><i class="fa-solid fa-bolt"></i> 智绘姬触发文本</label>
                                <textarea class="text_pole csid-output" data-role="chatu8-trigger" readonly></textarea>
                            </div>
                        </div>
                        <div class="csid-actions csid-secondary-actions">
                            <button class="menu_button" data-action="copy-trigger"><i class="fa-solid fa-copy"></i><span>备用复制</span></button>
                            <button class="menu_button" data-action="insert-trigger"><i class="fa-solid fa-keyboard"></i><span>填入输入框</span></button>
                            <button class="menu_button" data-action="analyze-input"><i class="fa-solid fa-brain"></i><span>更新视觉记忆</span></button>
                        </div>
                        <details class="csid-advanced">
                            <summary><i class="fa-solid fa-sliders"></i> 提示词明细</summary>
                            <div class="csid-result-grid">
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
                            <div class="csid-actions csid-secondary-actions">
                                <button class="menu_button" data-action="copy-positive"><i class="fa-solid fa-plus"></i><span>复制正向</span></button>
                                <button class="menu_button" data-action="copy-negative"><i class="fa-solid fa-minus"></i><span>复制反向</span></button>
                            </div>
                        </details>
                        <details class="csid-advanced csid-debug-panel" open>
                            <summary><i class="fa-solid fa-bug"></i> Debug 信息</summary>
                            <div class="csid-debug-head">
                                <span>generationStatus: <b data-role="generation-status" data-state="idle">idle</b></span>
                                <button class="menu_button" data-action="copy-debug"><i class="fa-solid fa-copy"></i><span>复制 debug 信息</span></button>
                            </div>
                            <textarea class="text_pole csid-output csid-debug-output" data-role="debug-info" readonly></textarea>
                        </details>
                    </section>

                    <section class="csid-panel" data-panel="memory">
                        <div class="csid-section-head">
                            <div>
                                <b><i class="fa-solid fa-palette"></i> 视觉记忆</b>
                                <span>角色外观、服装、地点和画面风格</span>
                            </div>
                        </div>
                        <div class="csid-kpi-grid csid-memory-kpis">
                            <div class="csid-kpi"><i class="fa-solid fa-user"></i><span>角色</span><b data-role="dash-character">未选择角色</b></div>
                            <div class="csid-kpi"><i class="fa-solid fa-location-dot"></i><span>地点</span><b data-role="dash-location">地点待识别</b></div>
                            <div class="csid-kpi"><i class="fa-solid fa-shirt"></i><span>服装</span><b data-role="dash-outfit">服装待识别</b></div>
                            <div class="csid-kpi"><i class="fa-solid fa-sun"></i><span>光线</span><b data-role="dash-visual">时间光线待识别</b></div>
                        </div>
                        <div class="csid-module">
                            <div class="csid-module-head"><b><i class="fa-solid fa-map"></i> 场景状态</b></div>
                            <div class="csid-grid two">
                                <label>当前角色<input class="text_pole" name="char.name" readonly></label>
                                <label>当前地点<input class="text_pole" name="scene.location"></label>
                                <label>时间<input class="text_pole" name="scene.time"></label>
                                <label>天气<input class="text_pole" name="scene.weather"></label>
                                <label>光线<input class="text_pole" name="scene.lighting"></label>
                                <label>氛围<input class="text_pole" name="scene.mood"></label>
                            </div>
                        </div>
                        <div class="csid-module">
                            <div class="csid-module-head"><b><i class="fa-solid fa-user-pen"></i> 角色画面</b></div>
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
                        </div>
                        <details class="csid-advanced">
                            <summary><i class="fa-solid fa-box-archive"></i> 视觉长期项</summary>
                            <label class="csid-label">长期摘要</label>
                            <textarea class="text_pole csid-memory-area small" name="memory.summary"></textarea>
                            <label class="csid-label">关键事实</label>
                            <textarea class="text_pole csid-memory-area small" name="memory.facts" placeholder="每行一条，角色身份/世界规则/重要事件"></textarea>
                            <label class="csid-label">视觉备注</label>
                            <textarea class="text_pole csid-memory-area small" name="memory.visualNotes" placeholder="每行一条，固定服饰/标志物/场景视觉锚点"></textarea>
                        </details>
                        <div class="csid-actions">
                            <button class="menu_button result-control" data-action="save-memory"><i class="fa-solid fa-save"></i><span>保存记忆</span></button>
                            <button class="menu_button" data-action="import-th"><i class="fa-solid fa-right-to-bracket"></i><span>导入酒馆助手</span></button>
                            <button class="menu_button" data-action="export-memory"><i class="fa-solid fa-file-export"></i><span>导出记忆</span></button>
                            <label class="menu_button csid-file-button"><i class="fa-solid fa-file-import"></i><span>导入文件</span><input type="file" data-action="import-file" accept="application/json"></label>
                        </div>
                        <div class="csid-history" data-role="history"></div>
                    </section>


                    <section class="csid-panel" data-panel="story">
                        <div class="csid-section-head">
                            <div>
                                <b><i class="fa-solid fa-book-open-reader"></i> 剧情长期记忆</b>
                                <span>摘要树、原文索引、正文注入</span>
                            </div>
                        </div>
                        <div class="csid-kpi-grid">
                            <div class="csid-kpi"><i class="fa-solid fa-layer-group"></i><span>条目</span><b data-role="dash-story">0 条剧情记忆</b></div>
                            <div class="csid-kpi"><i class="fa-solid fa-database"></i><span>数据库</span><b data-role="dash-db">DB 待连接</b></div>
                            <div class="csid-kpi csid-wide-kpi"><i class="fa-solid fa-chart-simple"></i><span>索引状态</span><b data-role="story-stats">剧情记忆未索引</b></div>
                        </div>
                        <div class="csid-switch-grid">
                            <label class="csid-switch-card"><input type="checkbox" name="storyMemory.enabled"><span><b>启用记忆</b><em>长期剧情一致性</em></span></label>
                            <label class="csid-switch-card"><input type="checkbox" name="storyMemory.autoIndex"><span><b>自动索引</b><em>新消息后台入库</em></span></label>
                            <label class="csid-switch-card"><input type="checkbox" name="storyMemory.injectToPrompt"><span><b>正文注入</b><em>生成前带相关记忆</em></span></label>
                            <label class="csid-switch-card"><input type="checkbox" name="storyMemory.prismMode"><span><b>PRISM 路径</b><em>摘要树检索</em></span></label>
                            <label class="csid-switch-card"><input type="checkbox" name="storyMemory.includeOriginal"><span><b>原文片段</b><em>少量证据回填</em></span></label>
                            <label class="csid-switch-card"><input type="checkbox" name="storyMemory.useIndexedDb"><span><b>本地 DB</b><em>保存完整原文</em></span></label>
                            <label class="csid-switch-card"><input type="checkbox" name="storyMemory.useApiSummary"><span><b>API 整理</b><em>后台结构化摘要</em></span></label>
                        </div>
                        <details class="csid-advanced" open>
                            <summary><i class="fa-solid fa-scroll"></i> 记忆内容</summary>
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
                        </details>
                        <details class="csid-advanced">
                            <summary><i class="fa-solid fa-gauge-high"></i> 注入预算</summary>
                            <div class="csid-grid two">
                                <label>注入深度<input class="text_pole" type="number" name="storyMemory.injectDepth" min="0" max="20" step="1"></label>
                                <label>检索条数<input class="text_pole" type="number" name="storyMemory.maxRetrieved" min="1" max="20" step="1"></label>
                                <label>注入字数上限<input class="text_pole" type="number" name="storyMemory.maxInjectChars" min="400" max="6000" step="100"></label>
                                <label>最多记忆条数<input class="text_pole" type="number" name="storyMemory.maxEntries" min="50" max="4000" step="50"></label>
                                <label>原文片段数<input class="text_pole" type="number" name="storyMemory.maxOriginalSnippets" min="1" max="8" step="1"></label>
                                <label>单段原文字数<input class="text_pole" type="number" name="storyMemory.maxOriginalSnippetChars" min="80" max="800" step="20"></label>
                                <label>根摘要字数<input class="text_pole" type="number" name="storyMemory.rootSummaryChars" min="200" max="1600" step="50"></label>
                            </div>
                        </details>
                        <div class="csid-actions">
                            <button class="menu_button result-control" data-action="save-story-memory"><i class="fa-solid fa-save"></i><span>保存剧情记忆</span></button>
                            <button class="menu_button" data-action="backfill-story"><i class="fa-solid fa-clock-rotate-left"></i><span>回溯索引</span></button>
                            <button class="menu_button" data-action="refresh-story-injection"><i class="fa-solid fa-arrows-rotate"></i><span>刷新注入</span></button>
                        </div>
                        <details class="csid-advanced">
                            <summary><i class="fa-solid fa-magnifying-glass"></i> 本次检索预览</summary>
                            <textarea class="text_pole csid-output" data-role="story-retrieval" readonly></textarea>
                        </details>
                    </section>

                    <section class="csid-panel" data-panel="settings">
                        <div class="csid-section-head">
                            <div>
                                <b><i class="fa-solid fa-sliders"></i> 全局设置</b>
                                <span>API、智绘姬兼容、后台记忆</span>
                            </div>
                        </div>
                        <div class="csid-module">
                            <div class="csid-module-head"><b><i class="fa-solid fa-plug-circle-bolt"></i> API 与模型</b><span data-role="dash-api">本地快速模式</span></div>
                            <label class="csid-switch-card csid-inline-switch"><input type="checkbox" name="api.enabled"><span><b>启用额外 API</b><em>用于智能 prompt 与后台记忆整理</em></span></label>
                            <div class="csid-grid two">
                                <label>API 地址<input class="text_pole" name="api.url" placeholder="http://127.0.0.1:8000/v1"></label>
                                <label>模型选择<select class="text_pole" name="api.modelSelect"></select></label>
                                <label>手动模型<input class="text_pole" name="api.model" placeholder="刷新失败时手填，例如 gpt-4.1-mini"></label>
                                <label>超时 ms<input class="text_pole" type="number" name="api.timeoutMs" min="3000" step="500"></label>
                                <label>温度<input class="text_pole" type="number" name="api.temperature" min="0" max="2" step="0.1"></label>
                            </div>
                            <label class="csid-label">API Key</label>
                            <input class="text_pole" type="password" name="api.key" autocomplete="off">
                            <div class="csid-actions csid-secondary-actions">
                                <button class="menu_button" data-action="refresh-models"><i class="fa-solid fa-cloud-arrow-down"></i><span>刷新模型</span></button>
                                <button class="menu_button" data-action="test-api"><i class="fa-solid fa-vial"></i><span>测试 API</span></button>
                            </div>
                        </div>
                        <div class="csid-module">
                            <div class="csid-module-head"><b><i class="fa-solid fa-wand-magic-sparkles"></i> 智绘姬兼容</b><span data-role="dash-chatu8">智绘姬标签开启</span></div>
                            <div class="csid-switch-grid">
                                <label class="csid-switch-card"><input type="checkbox" name="chatu8.enabled"><span><b>输出方括号标签</b><em>供智绘姬识别</em></span></label>
                                <label class="csid-switch-card"><input type="checkbox" name="chatu8.insertToChatInput"><span><b>填入输入框</b><em>预览后可手动发送</em></span></label>
                                <label class="csid-switch-card"><input type="checkbox" name="behavior.autoMemory"><span><b>自动视觉记忆</b><em>新回复后台更新</em></span></label>
                                <label class="csid-switch-card"><input type="checkbox" name="behavior.preferClipboard"><span><b>优先剪贴板</b><em>粘贴片段优先</em></span></label>
                                <label class="csid-switch-card"><input type="checkbox" name="behavior.syncTavernHelper"><span><b>同步酒馆助手</b><em>变量兼容</em></span></label>
                                <label class="csid-switch-card"><input type="checkbox" name="behavior.allowPermanentOverwrite"><span><b>覆盖永久设定</b><em>谨慎启用</em></span></label>
                            </div>
                            <div class="csid-grid two">
                                <label>开始标记<input class="text_pole" name="chatu8.startTag" placeholder="["></label>
                                <label>结束标记<input class="text_pole" name="chatu8.endTag" placeholder="]"></label>
                            </div>
                        </div>
                        <div class="csid-actions">
                            <button class="menu_button result-control" data-action="save-settings"><i class="fa-solid fa-save"></i><span>保存全部设置</span></button>
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
        if (action === 'capture-start') captureScenePoint('start');
        if (action === 'capture-end') captureScenePoint('end');
        if (action === 'capture-preview') openScenePreviewFromCapture();
        if (action === 'read-clipboard') readClipboardIntoInput();
        if (action === 'use-recent') useRecentIntoInput();
        if (action === 'use-latest') useLatestIntoInput();
        if (action === 'compose') composeFromInput();
        if (action === 'auto-image') writePromptUnderLatestFromInput();
        if (action === 'copy-trigger') copyText(state.lastTrigger, '已复制智绘姬触发文本');
        if (action === 'copy-debug') copyText(getDebugText(), '已复制 debug 信息');
        if (action === 'insert-trigger') insertTriggerIntoChat();
        if (action === 'send-trigger') sendTriggerToChat();
        if (action === 'copy-positive') copyText(state.lastPositive, '已复制正向提示词');
        if (action === 'copy-negative') copyText(state.lastNegative, '已复制反向提示词');
        if (action === 'analyze-input') analyzeInputNow();
        if (action === 'run-diagnostics') runDiagnostics();
        if (action === 'apply-recommended') applyRecommendedSettings();
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

function countCollapsedOccurrences(sourceText, selectedText) {
    const source = buildCollapsedSearchIndex(sourceText).value;
    const selected = buildCollapsedSearchIndex(selectedText).value.trim();
    if (!source || !selected) return 0;
    let count = 0;
    let from = 0;
    while (true) {
        const index = source.indexOf(selected, from);
        if (index < 0) break;
        count += 1;
        from = index + Math.max(1, selected.length);
    }
    return count;
}

function getSelectionOccurrenceIndex(range, root, selectedText) {
    if (!range || !root || !selectedText || !rangeBelongsToElement(range, root)) return 0;
    try {
        const beforeRange = document.createRange();
        beforeRange.selectNodeContents(root);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        const beforeText = beforeRange.toString();
        beforeRange.detach?.();
        return countCollapsedOccurrences(beforeText, selectedText);
    } catch {
        return 0;
    }
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
    const fullText = stripLastInlinePrompt(getMessageText(chat?.[messageId]), chat?.[messageId]);
    const textRoot = mes.querySelector?.('.mes_text') || mes;
    const occurrenceIndex = getSelectionOccurrenceIndex(range, textRoot, selectedText);
    const sourceRange = findSelectedTextRange(fullText, selectedText, occurrenceIndex);
    const context = {
        messageId,
        text: selectedText,
        x,
        y,
        range: range.cloneRange(),
        sourceRange,
        occurrenceIndex,
        paragraphIndex: sourceRange ? selectedParagraphIndex(fullText, selectedText, sourceRange) : null,
        capturedAt: Date.now(),
    };
    state.lastSelectionContext = context;
    return context;
}

function getCurrentOrCachedSelectionContext(maxAgeMs = 10 * 60 * 1000) {
    const live = getSelectionContext();
    if (live) return live;
    const cached = state.lastSelectionContext;
    if (!cached?.text) return null;
    if (Date.now() - Number(cached.capturedAt || 0) > maxAgeMs) return null;
    return cached;
}

function capturePointLabel(point) {
    if (!point) return '未设置';
    const line = compactPreview(point.text, 42);
    return '#' + point.messageId + ' 第' + ((point.paragraphIndex ?? 0) + 1) + '段 ' + line;
}

function renderCaptureStatus() {
    const area = document.querySelector(SETTINGS_SELECTOR + ' [data-role="capture-status"]');
    if (!area) return;
    area.textContent = '开始: ' + capturePointLabel(state.sceneCaptureStart) + ' | 结束: ' + capturePointLabel(state.sceneCaptureEnd);
}

function captureScenePoint(kind) {
    const context = getCurrentOrCachedSelectionContext();
    if (!context?.text) {
        setStatus('没有可记录的选中剧情，请先在正文里选中一小段');
        renderCaptureStatus();
        return;
    }
    const point = {
        messageId: Number(context.messageId),
        text: context.text,
        sourceRange: context.sourceRange ? { ...context.sourceRange } : null,
        paragraphIndex: context.paragraphIndex,
        capturedAt: Date.now(),
    };
    if (kind === 'start') state.sceneCaptureStart = point;
    else state.sceneCaptureEnd = point;
    renderCaptureStatus();
    setStatus((kind === 'start' ? '已记录开始取景点: ' : '已记录结束取景点: ') + compactPreview(point.text, 64));
}

function resolveCapturePointRange(fullText, point) {
    if (!point?.text) return null;
    if (point.sourceRange && Number.isInteger(point.sourceRange.start) && Number.isInteger(point.sourceRange.end)) {
        return point.sourceRange;
    }
    return findSelectedTextRange(fullText, point.text);
}

function buildCaptureSelectionFromPoints(startPoint, endPoint) {
    if (!startPoint?.text || !endPoint?.text) throw new Error('请先设置开始取景和结束取景');
    if (Number(startPoint.messageId) !== Number(endPoint.messageId)) throw new Error('开始取景和结束取景必须在同一条消息里');
    const messageId = Number(startPoint.messageId);
    const message = chat?.[messageId];
    if (!message) throw new Error('没有找到取景所在消息');
    const fullText = stripLastInlinePrompt(getMessageText(message), message);
    const startRange = resolveCapturePointRange(fullText, startPoint);
    const endRange = resolveCapturePointRange(fullText, endPoint);
    if (!startRange || !endRange) throw new Error('无法在消息正文中定位取景点，请重新选中起止片段');
    const start = Math.min(startRange.start, endRange.start);
    const end = Math.max(startRange.end, endRange.end);
    const text = normalizeMultiline(fullText.slice(start, end));
    if (!text || text.length < 8) throw new Error('取景范围太短，请扩大选段');
    return {
        messageId,
        text,
        sourceRange: { start, end, exact: Boolean(startRange.exact && endRange.exact) },
        paragraphIndex: normalizeMultiline(fullText.slice(0, start)).split(/\n{2,}|\n/).filter(Boolean).length,
    };
}

function openScenePreviewFromCapture() {
    try {
        const capture = buildCaptureSelectionFromPoints(state.sceneCaptureStart, state.sceneCaptureEnd);
        state.activeMessageId = capture.messageId;
        state.activeSelectionText = capture.text;
        state.activeSelectionRange = null;
        state.lastSelectionContext = {
            messageId: capture.messageId,
            text: capture.text,
            sourceRange: capture.sourceRange,
            paragraphIndex: capture.paragraphIndex,
            capturedAt: Date.now(),
        };
        openScenePreviewFromSelection(capture.messageId, capture.text, null, capture.sourceRange);
    } catch (error) {
        setStatus('生成这一幕失败: ' + error.message);
        setLastDebug({ generationStatus: 'error', error: error.message });
    }
}

function selectedParagraphIndex(fullText, selectedText, preferredRange = null) {
    const range = resolveSelectedTextRange(fullText, selectedText, preferredRange);
    if (!range) return null;
    return normalizeMultiline(fullText.slice(0, range.start)).split(/\n{2,}|\n/).filter(Boolean).length;
}

function getSelectionSceneContext(messageId, selectedText, preferredRange = null) {
    const message = chat?.[Number(messageId)];
    const fullText = stripLastInlinePrompt(getMessageText(message), message);
    const range = resolveSelectedTextRange(fullText, selectedText, preferredRange);
    const start = range?.start ?? 0;
    const end = range?.end ?? selectedText.length;
    return {
        fullText,
        contextBefore: compactPreview(fullText.slice(Math.max(0, start - 420), start), 420),
        contextAfter: compactPreview(fullText.slice(end, Math.min(fullText.length, end + 420)), 420),
        paragraphIndex: range ? selectedParagraphIndex(fullText, selectedText, range) : null,
        range,
    };
}

function buildScenePreviewPayload(messageId, selectedText, options = {}) {
    const raw = normalizeMultiline(selectedText || '').trim();
    const sceneText = prepareSceneText(raw);
    if (!sceneText || sceneText.length < 8) throw new Error('选中的剧情太短或为空，请重新选择一段真正剧情');
    if (looksLikePromptScaffold(sceneText)) throw new Error('这段内容像预设/提示词，不适合直接生图，请只选真正剧情段落');
    const cached = state.lastSelectionContext;
    const cachedMatches = cached?.messageId === Number(messageId) && normalizeMultiline(cached.text || '').trim() === raw;
    const preferredRange = options.sourceRange || (cachedMatches ? cached.sourceRange : null);
    const sceneContext = getSelectionSceneContext(messageId, raw, preferredRange);
    const focus = resolveFocusCharacter(sceneText, options.focusCharacter || '');
    const result = compilePrompt(sceneText, { focusCharacter: options.focusCharacter || '' });
    const finalPrompt = normalizePromptText(result.positive);
    const trigger = buildChatu8Trigger(finalPrompt);
    return {
        id: 'csid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        messageId: Number(messageId),
        selectedTextRaw: raw,
        selectedText: sceneText,
        contextBefore: sceneContext.contextBefore,
        contextAfter: sceneContext.contextAfter,
        insertTargetMessageId: Number(messageId),
        insertTargetParagraphIndex: sceneContext.paragraphIndex,
        selectionRange: options.selectionRange || null,
        sourceRange: sceneContext.range,
        range: sceneContext.range,
        focusCharacter: result.focus?.name || focus.name,
        focusCandidates: focus.candidates,
        focusRequired: focus.ambiguous && !options.focusCharacter,
        detectedLocation: result.localScene.location || ensureChatMemory().scene.location || '',
        detectedOutfit: result.localScene.outfit || getCharacterMemory(result.focus?.name || focus.name).currentOutfit || '',
        detectedProps: result.localScene.props || '',
        localScene: result.localScene,
        result,
        finalPrompt,
        trigger,
        negativePrompt: normalizePromptText(result.negative),
        shotCard: result.shotCard,
        mode: options.mode || 'insert',
    };
}

function setPromptOutputsFromPayload(payload) {
    state.lastPositive = normalizePromptText(payload.finalPrompt || payload.result?.positive || '');
    state.lastNegative = normalizePromptText(payload.negativePrompt || payload.result?.negative || '');
    state.lastShotCard = payload.shotCard || payload.result?.shotCard || '';
    state.lastTrigger = payload.trigger || buildChatu8Trigger(state.lastPositive);
    const root = document.querySelector(SETTINGS_SELECTOR);
    if (!root) return;
    const positiveArea = root.querySelector('[data-role="positive"]');
    const negativeArea = root.querySelector('[data-role="negative"]');
    const shotArea = root.querySelector('[data-role="shot-card"]');
    const triggerArea = root.querySelector('[data-role="chatu8-trigger"]');
    if (positiveArea) positiveArea.value = state.lastPositive;
    if (negativeArea) negativeArea.value = state.lastNegative;
    if (shotArea) shotArea.value = state.lastShotCard;
    if (triggerArea) triggerArea.value = state.lastTrigger;
}

function setGenerationStatus(status, message = '') {
    state.generationStatus = status;
    if (message) setStatus(message);
    renderDebugPanel();
}

function buildDebugInfo(patch = {}) {
    const base = state.lastDebug || {};
    return {
        selectedText: '',
        contextBefore: '',
        contextAfter: '',
        detectedFocusCharacter: '',
        detectedLocation: '',
        detectedOutfit: '',
        detectedProps: '',
        finalPrompt: '',
        insertTargetMessageId: null,
        insertTargetParagraphIndex: null,
        actualButtonText: '',
        actualPromptSentToZhihuiji: '',
        calledZhihuijiFunction: '',
        usedOfficialZhihuijiPipeline: false,
        triggeredZhihuijiButton: false,
        zhihuijiPipelineRoute: '',
        generationStatus: state.generationStatus || 'idle',
        error: '',
        ...base,
        ...patch,
    };
}

function setLastDebug(patch = {}) {
    state.lastDebug = buildDebugInfo(patch);
    renderDebugPanel();
    console.log('[' + EXT_NAME + '] debug', structuredClone(state.lastDebug));
    return state.lastDebug;
}

function getDebugText() {
    return JSON.stringify(buildDebugInfo(), null, 2);
}

function renderDebugPanel() {
    const area = document.querySelector(SETTINGS_SELECTOR + ' [data-role="debug-info"]');
    if (area) area.value = getDebugText();
    const status = document.querySelector(SETTINGS_SELECTOR + ' [data-role="generation-status"]');
    if (status) {
        status.textContent = state.generationStatus || 'idle';
        status.dataset.state = state.generationStatus || 'idle';
    }
}

function closeScenePreview() {
    document.querySelectorAll('.csid-preview-backdrop').forEach(node => node.remove());
}

function renderScenePreviewModal(payload) {
    closeScenePreview();
    state.pendingPreview = payload;
    setPromptOutputsFromPayload(payload);
    const backdrop = document.createElement('div');
    backdrop.className = 'csid-preview-backdrop';
    const focusOptions = uniqueParts([...(payload.focusCandidates || []), payload.focusCharacter].filter(Boolean));
    const mustChooseFocus = payload.focusRequired && focusOptions.length > 1;
    backdrop.innerHTML = `
        <div class="csid-preview-dialog" role="dialog" aria-modal="true">
            <div class="csid-preview-head">
                <div>
                    <b><i class="fa-solid fa-clapperboard"></i> 确认这一幕</b>
                    <span>先确认选段和 prompt，再选择插入或直接生图</span>
                </div>
                <button class="menu_button" data-csid-preview-action="cancel"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="csid-preview-body">
                <label class="csid-label">当前选中的剧情 selectedText</label>
                <textarea class="text_pole csid-preview-text" readonly>${escapeHtml(payload.selectedTextRaw)}</textarea>
                <div class="csid-preview-meta">
                    <label>focusCharacter
                        <select class="text_pole" data-csid-preview-focus>
                            ${mustChooseFocus ? '<option value="">请选择焦点角色</option>' : ''}
                            ${focusOptions.map(name => `<option value="${escapeHtml(name)}" ${name === payload.focusCharacter && !mustChooseFocus ? 'selected' : ''}>${escapeHtml(name)}${englishCharacterName(name) ? ' / ' + escapeHtml(englishCharacterName(name)) : ''}</option>`).join('')}
                        </select>
                    </label>
                    <label>location<input class="text_pole" value="${escapeHtml(payload.detectedLocation || '未检测到')}" readonly></label>
                    <label>outfit<input class="text_pole" value="${escapeHtml(payload.detectedOutfit || '未检测到')}" readonly></label>
                    <label>props<input class="text_pole" value="${escapeHtml(payload.detectedProps || '未检测到')}" readonly></label>
                </div>
                <details>
                    <summary>contextBefore / contextAfter</summary>
                    <label class="csid-label">contextBefore</label>
                    <textarea class="text_pole csid-preview-context" readonly>${escapeHtml(payload.contextBefore)}</textarea>
                    <label class="csid-label">contextAfter</label>
                    <textarea class="text_pole csid-preview-context" readonly>${escapeHtml(payload.contextAfter)}</textarea>
                </details>
                <label class="csid-label">finalPrompt（完整可复制）</label>
                <textarea class="text_pole csid-preview-prompt" data-csid-preview-prompt>${escapeHtml(payload.finalPrompt)}</textarea>
                <div class="csid-preview-mode">
                    <b>当前模式</b>
                    <span>模式A：插入智绘姬可识别按钮</span>
                    <span>模式B：直接调用智绘姬生成</span>
                </div>
                <div class="csid-preview-warning" ${mustChooseFocus ? '' : 'hidden'}>检测到多个角色，请先选择 focusCharacter，避免混脸或混衣服。</div>
            </div>
            <div class="csid-preview-actions">
                <button class="menu_button" data-csid-preview-action="cancel">取消</button>
                <button class="menu_button" data-csid-preview-action="insert" ${mustChooseFocus ? 'disabled' : ''}>仅插入 prompt 按钮</button>
                <button class="menu_button result-control" data-csid-preview-action="generate" ${mustChooseFocus ? 'disabled' : ''}>立即调用智绘姬生图</button>
            </div>
        </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', event => {
        const actionButton = event.target.closest('[data-csid-preview-action]');
        if (actionButton) {
            const action = actionButton.dataset.csidPreviewAction;
            if (action === 'cancel') closeScenePreview();
            if (action === 'insert' || action === 'generate') confirmScenePreview(action);
            return;
        }
        if (event.target === backdrop) closeScenePreview();
    });
    const focusSelect = backdrop.querySelector('[data-csid-preview-focus]');
    focusSelect?.addEventListener('change', () => {
        try {
            const next = buildScenePreviewPayload(payload.messageId, payload.selectedTextRaw, {
                selectionRange: payload.selectionRange,
                sourceRange: payload.sourceRange,
                focusCharacter: focusSelect.value,
            });
            renderScenePreviewModal(next);
        } catch (error) {
            setStatus('切换焦点失败: ' + error.message);
        }
    });
    setLastDebug({
        selectedText: payload.selectedText,
        contextBefore: payload.contextBefore,
        contextAfter: payload.contextAfter,
        detectedFocusCharacter: payload.focusCharacter,
        detectedLocation: payload.detectedLocation,
        detectedOutfit: payload.detectedOutfit,
        detectedProps: payload.detectedProps,
        finalPrompt: payload.finalPrompt,
        insertTargetMessageId: payload.insertTargetMessageId,
        insertTargetParagraphIndex: payload.insertTargetParagraphIndex,
        actualPromptSentToZhihuiji: payload.finalPrompt,
        generationStatus: 'idle',
    });
    return backdrop;
}

function openScenePreviewFromSelection(messageId, selectedText = '', selectionRange = null, sourceRange = null) {
    try {
        const fallback = state.lastSelectionContext;
        const actualText = normalizeMultiline(selectedText || (fallback?.messageId === messageId ? fallback.text : '') || '').trim();
        if (!actualText) throw new Error('没有读到选中的剧情。手机端如果选区丢失，请重新长按选择后再点图片生成');
        const fallbackRange = fallback?.messageId === Number(messageId) && normalizeMultiline(fallback.text || '').trim() === actualText ? fallback.sourceRange : null;
        const payload = buildScenePreviewPayload(messageId, actualText, { selectionRange, sourceRange: sourceRange || fallbackRange });
        renderScenePreviewModal(payload);
    } catch (error) {
        console.error('[' + EXT_NAME + '] preview failed', error);
        setStatus('预览失败: ' + error.message);
    }
}

function showMessageMenu(eventOrPoint, messageId, selectedText = '', selectionRange = null, sourceRange = null) {
    closeMessageMenu();
    state.activeMessageId = messageId;
    state.activeSelectionText = normalizeMultiline(selectedText || '').trim();
    state.activeSelectionRange = selectionRange;
    state.activeSelectionSourceRange = sourceRange;
    state.messageMenuOpenedAt = Date.now();
    const menu = document.createElement('div');
    menu.className = 'csid-message-menu';
    if (state.activeSelectionText) {
        const hint = document.createElement('div');
        hint.className = 'csid-message-menu-hint';
        hint.textContent = '已选中 ' + state.activeSelectionText.length + ' 字，确认后写到原文下方';
        menu.appendChild(hint);
    }
    const imageButton = document.createElement('button');
    imageButton.type = 'button';
    imageButton.dataset.csidMessageAction = 'image';
    imageButton.className = 'csid-confirm-image-button';
    imageButton.innerHTML = '<span class="fa-solid fa-image"></span><span>确认生图</span>';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.dataset.csidMessageAction = 'close';
    closeButton.innerHTML = '<span class="fa-solid fa-xmark"></span><span>取消</span>';
    menu.append(imageButton, closeButton);
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
        showMessageMenu({ clientX: context.x, clientY: context.y }, context.messageId, context.text, context.range, context.sourceRange);
    }, delay);
}

function bindMessageMenu() {
    if (state.messageMenuBound) return;
    state.messageMenuBound = true;
    document.addEventListener('selectionchange', () => {
        clearTimeout(state.selectionCacheTimer);
        state.selectionCacheTimer = setTimeout(() => {
            if (document.querySelector('.csid-preview-backdrop')) return;
            const context = getSelectionContext();
            if (!context) return;
            showMessageMenu({ clientX: context.x, clientY: context.y }, context.messageId, context.text, context.range, context.sourceRange);
        }, 160);
    }, true);
    document.addEventListener('mouseup', event => openMenuFromSelection(event, 0), true);
    document.addEventListener('touchend', event => openMenuFromSelection(event, 120), true);
    document.addEventListener('click', event => {
        const actionButton = event.target.closest('[data-csid-message-action]');
        if (actionButton) {
            const action = actionButton.dataset.csidMessageAction;
            const messageId = Number(state.activeMessageId);
            const selectedText = state.activeSelectionText || '';
            const selectionRange = state.activeSelectionRange || null;
            const sourceRange = state.activeSelectionSourceRange || null;
            closeMessageMenu();
            if (action === 'image') openScenePreviewFromSelection(messageId, selectedText, selectionRange, sourceRange);
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

function nthIndexOf(source, needle, occurrenceIndex = 0) {
    const target = Math.max(0, Number(occurrenceIndex) || 0);
    let from = 0;
    let index = -1;
    for (let i = 0; i <= target; i++) {
        index = source.indexOf(needle, from);
        if (index < 0) return -1;
        from = index + Math.max(1, needle.length);
    }
    return index;
}

function findSelectedTextRange(sourceText, selectedText, occurrenceIndex = 0) {
    const source = normalizeMultiline(sourceText || '');
    const selected = normalizeMultiline(selectedText || '').trim();
    if (!source || !selected) return null;
    const exactStart = nthIndexOf(source, selected, occurrenceIndex);
    if (exactStart >= 0) return { start: exactStart, end: exactStart + selected.length, exact: true };
    const sourceIndex = buildCollapsedSearchIndex(source);
    const selectedIndex = buildCollapsedSearchIndex(selected);
    const collapsedStart = nthIndexOf(sourceIndex.value, selectedIndex.value, occurrenceIndex);
    if (collapsedStart < 0) return null;
    const collapsedEnd = collapsedStart + selectedIndex.value.length - 1;
    const start = sourceIndex.map[collapsedStart];
    const end = sourceIndex.map[collapsedEnd] + 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
    return { start, end, exact: false };
}

function sameCollapsedText(a, b) {
    return buildCollapsedSearchIndex(a).value.trim() === buildCollapsedSearchIndex(b).value.trim();
}

function rangeMatchesSelectedText(fullText, selectedText, sourceRange) {
    const source = normalizeMultiline(fullText || '');
    const selected = normalizeMultiline(selectedText || '').trim();
    if (!selected || !sourceRange) return false;
    const start = Number(sourceRange.start);
    const end = Number(sourceRange.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.length) return false;
    const slice = normalizeMultiline(source.slice(start, end)).trim();
    return slice === selected || sameCollapsedText(slice, selected);
}

function resolveSelectedTextRange(fullText, selectedText, preferredRange = null) {
    if (rangeMatchesSelectedText(fullText, selectedText, preferredRange)) {
        return {
            start: Number(preferredRange.start),
            end: Number(preferredRange.end),
            exact: Boolean(preferredRange.exact),
        };
    }
    return findSelectedTextRange(fullText, selectedText);
}

function insertTriggerAfterSelectedText(fullText, selectedText, trigger, preferredRange = null) {
    const base = normalizeMultiline(fullText || '').trimEnd();
    const selected = normalizeMultiline(selectedText || '').trim();
    const range = selected ? resolveSelectedTextRange(base, selected, preferredRange) : null;
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

function removeOwnVisibleTriggers(messageId) {
    const mes = getMessageElementById(messageId);
    if (!mes) return;
    mes.querySelectorAll('.csid-visible-trigger-wrap[data-csid-owned="true"]').forEach(node => node.remove());
}

function insertTriggerIntoVisibleMessage(messageId, trigger, selectionRange = null) {
    const mes = getMessageElementById(messageId);
    const textNode = mes?.querySelector('.mes_text');
    if (!textNode || !trigger) return null;
    removeOwnVisibleTriggers(messageId);
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
    try { await eventSource.emit(event_types.MESSAGE_UPDATED, Number(messageId), 'codex-scene-image-director'); } catch (error) { console.warn('[' + EXT_NAME + '] message update event failed', error); }
}

function findChatu8GenerationButtons(messageId) {
    const mes = getMessageElementById(messageId);
    if (!mes) return [];
    return [...mes.querySelectorAll('button, .menu_button, [role="button"], .st-chatu8-image-button, .image-tag-button')]
        .filter(button => !button.closest('.csid-message-menu') && !button.closest('.csid-preview-dialog'))
        .filter(button => {
            const label = normalizeLine([button.textContent, button.title, button.getAttribute?.('aria-label')].filter(Boolean).join(' '));
            return button.classList?.contains('st-chatu8-image-button')
                || button.classList?.contains('image-tag-button')
                || button.dataset?.prompt
                || button.dataset?.tag
                || /生成图片|图片生成/.test(label);
        });
}

async function waitForChatu8Button(messageId, timeoutMs = 3500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const buttons = findChatu8GenerationButtons(messageId);
        if (buttons.length) return buttons[buttons.length - 1];
        await new Promise(resolve => setTimeout(resolve, 180));
    }
    return null;
}

function listenForChatu8Response(requestId, prompt) {
    const responseEvent = 'generate-image-response';
    const listener = payload => {
        if (requestId && payload?.id && payload.id !== requestId) return;
        eventSource.removeListener?.(responseEvent, listener);
        const ok = Boolean(payload?.success);
        setGenerationStatus(ok ? 'success' : 'error', ok ? '智绘姬生成成功' : '智绘姬生成失败: ' + (payload?.error || '未知错误'));
        setLastDebug({
            generationStatus: ok ? 'success' : 'error',
            actualPromptSentToZhihuiji: payload?.prompt || prompt,
            error: ok ? '' : payload?.error || '未知错误',
        });
    };
    eventSource.on(responseEvent, listener);
    setTimeout(() => {
        if (state.generationStatus === 'submitted') {
            setGenerationStatus('running', '已提交智绘姬，等待 ComfyUI 返回');
            setLastDebug({ generationStatus: 'running' });
        }
    }, 900);
    setTimeout(() => {
        if (state.generationStatus === 'submitted' || state.generationStatus === 'running') {
            eventSource.removeListener?.(responseEvent, listener);
            setLastDebug({ generationStatus: state.generationStatus, error: '等待生成结果超时，但任务可能仍在智绘姬/ComfyUI 队列中' });
            renderDebugPanel();
        }
    }, 120000);
}

async function invokeChatu8Generation(messageId, prompt) {
    const requestEvent = 'generate-image-request';
    setGenerationStatus('submitted', '正在提交到智绘姬生成链路');
    const button = await waitForChatu8Button(messageId);
    if (button) {
        const requestId = button.dataset?.requestId || button.getAttribute('data-request-id') || '';
        const actualPrompt = button.dataset?.prompt || button.dataset?.tag || prompt;
        setLastDebug({
            actualButtonText: normalizeLine(button.textContent || button.title || ''),
            actualPromptSentToZhihuiji: actualPrompt,
            calledZhihuijiFunction: 'HTMLElement.click() -> st-chatu8 triggerGeneration(button)',
            usedOfficialZhihuijiPipeline: true,
            triggeredZhihuijiButton: true,
            zhihuijiPipelineRoute: 'official-button-click',
            generationStatus: 'submitted',
        });
        listenForChatu8Response(requestId, prompt);
        button.click();
        return { usedOfficialZhihuijiPipeline: true, triggeredZhihuijiButton: true, requestId, actualPrompt };
    }
    const requestId = 'csid-direct-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const listenerCount = typeof eventSource.listenerCount === 'function' ? eventSource.listenerCount(requestEvent) : null;
    setLastDebug({
        actualButtonText: '',
        actualPromptSentToZhihuiji: prompt,
        calledZhihuijiFunction: 'eventSource.emit("generate-image-request", { id, prompt })',
        usedOfficialZhihuijiPipeline: Boolean(listenerCount === null || listenerCount > 0),
        triggeredZhihuijiButton: false,
        zhihuijiPipelineRoute: listenerCount === 0 ? 'missing-chatu8-listener' : 'official-event-fallback',
        generationStatus: 'submitted',
        error: listenerCount === 0 ? '未检测到智绘姬 generate-image-request 监听器' : '未找到智绘姬按钮，已改用事件提交',
    });
    listenForChatu8Response(requestId, prompt);
    await eventSource.emit(requestEvent, { id: requestId, prompt });
    return { usedOfficialZhihuijiPipeline: Boolean(listenerCount === null || listenerCount > 0), triggeredZhihuijiButton: false, requestId, actualPrompt: prompt };
}

async function confirmScenePreview(action) {
    const payload = state.pendingPreview;
    if (!payload) return;
    const promptArea = document.querySelector('.csid-preview-dialog [data-csid-preview-prompt]');
    const finalPrompt = normalizePromptText(promptArea?.value || payload.finalPrompt);
    payload.finalPrompt = finalPrompt;
    payload.trigger = buildChatu8Trigger(finalPrompt);
    payload.mode = action;
    try {
        const writeResult = await writePromptToMessage(payload.messageId, payload.selectedTextRaw, {
            selectedText: payload.selectedTextRaw,
            selectionRange: payload.selectionRange,
            sourceRange: payload.sourceRange,
            preview: payload,
            mode: action,
        });
        closeScenePreview();
        if (action === 'generate') {
            await invokeChatu8Generation(payload.messageId, writeResult.positive);
        }
    } catch (error) {
        console.error('[' + EXT_NAME + '] confirm preview failed', error);
        setGenerationStatus('error', '确认生图失败: ' + error.message);
        setLastDebug({ generationStatus: 'error', error: error.message });
    }
}

async function writePromptToMessage(messageId, sourceText, options = {}) {
    const message = chat?.[Number(messageId)];
    if (!message) throw new Error('没有找到这条消息');
    const fullText = stripLastInlinePrompt(getMessageText(message), message);
    const selectedText = normalizeMultiline(options.selectedText || sourceText || '').trim();
    const sceneText = options.preview?.selectedText || prepareSceneText(selectedText || fullText);
    if (!sceneText || looksLikePromptScaffold(sceneText)) throw new Error('这段内容像预设/提示词，不适合直接生图，请只选真正剧情段落');
    setStatus(selectedText ? '正在为选中剧情准备智绘姬提示词' : '正在为原文准备智绘姬提示词');
    const payload = options.preview || buildScenePreviewPayload(messageId, selectedText || fullText, { selectionRange: options.selectionRange, sourceRange: options.sourceRange });
    payload.finalPrompt = normalizePromptText(payload.finalPrompt || payload.result?.positive || '');
    payload.trigger = buildChatu8Trigger(payload.finalPrompt);
    setPromptOutputsFromPayload(payload);
    updateMemoryFromSelectedScene(sceneText, payload.localScene || payload.result?.localScene || extractSceneLocal(sceneText), payload.focusCharacter || payload.result?.focus?.name || getCurrentCharacterName());
    ensureChatMetadataVariables().zhihuiji = true;
    syncTavernHelperMemory();
    renderMemoryFields();
    saveAll();
    const preferredRange = payload.sourceRange || options.sourceRange || null;
    const nextText = insertTriggerAfterSelectedText(fullText, selectedText, state.lastTrigger, preferredRange);
    setMessageRawText(messageId, nextText, state.lastTrigger);
    removeOwnVisibleTriggers(messageId);
    const promptAnchor = insertTriggerIntoVisibleMessage(messageId, state.lastTrigger, options.selectionRange || null);
    await emitMessagePromptEvents(messageId);
    setGenerationStatus(options.mode === 'generate' ? 'submitted' : 'idle', options.mode === 'generate' ? '已插入 prompt，正在寻找智绘姬生成按钮' : '已写到选中剧情下方；可点击智绘姬图片按钮生成');
    setLastDebug({
        selectedText: sceneText,
        contextBefore: payload.contextBefore || '',
        contextAfter: payload.contextAfter || '',
        detectedFocusCharacter: payload.focusCharacter || payload.result?.focus?.name || '',
        detectedLocation: payload.detectedLocation || '',
        detectedOutfit: payload.detectedOutfit || '',
        detectedProps: payload.detectedProps || '',
        finalPrompt: state.lastPositive,
        insertTargetMessageId: Number(messageId),
        insertTargetParagraphIndex: payload.insertTargetParagraphIndex ?? selectedParagraphIndex(fullText, selectedText, preferredRange),
        actualPromptSentToZhihuiji: state.lastPositive,
        generationStatus: state.generationStatus,
    });
    return { ...payload.result, positive: state.lastPositive, negative: state.lastNegative, shotCard: state.lastShotCard, trigger: state.lastTrigger, promptAnchor, insertedAtSelection: Boolean(selectedText && resolveSelectedTextRange(fullText, selectedText, preferredRange)), clicked: false };
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
        const text = prepareSceneText(normalizeMultiline(selectedText || '').trim() || fullText);
        if (!text) throw new Error('没有可复制的剧情正文');
        setStatus(selectedText ? '正在生成选中剧情的触发文本' : '正在生成这条消息的触发文本');
        const result = compilePrompt(text);
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
    setStatus('正在按选段生成英文提示词');
    const result = compilePrompt(input);
    state.lastPositive = normalizePromptText(result.positive);
    state.lastNegative = normalizePromptText(result.negative);
    state.lastShotCard = result.shotCard;
    state.lastTrigger = buildChatu8Trigger(state.lastPositive);
    document.querySelector(SETTINGS_SELECTOR + ' [data-role="positive"]').value = state.lastPositive;
    document.querySelector(SETTINGS_SELECTOR + ' [data-role="negative"]').value = state.lastNegative;
    document.querySelector(SETTINGS_SELECTOR + ' [data-role="shot-card"]').value = state.lastShotCard;
    const triggerArea = document.querySelector(SETTINGS_SELECTOR + ' [data-role="chatu8-trigger"]');
    if (triggerArea) triggerArea.value = state.lastTrigger;
    updateMemoryFromSelectedScene(input, result.localScene, result.focus?.name || getCurrentCharacterName());
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
            hydrateStoryFromDbIfUseful().finally(() => {
                indexExistingStoryMemory({ silent: true });
                updateStoryMemoryInjection();
                fillFormFromSettings();
                renderMemoryFields();
            });
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
    renderCaptureStatus();
    setTimeout(() => {
        hydrateStoryFromDbIfUseful().finally(() => {
            indexExistingStoryMemory({ silent: true });
            updateStoryMemoryInjection();
            renderStoryMemoryFields();
        });
    }, 300);
    const tab = ensureSettings().ui.tab || 'compose';
    switchTab(tab);
    exposeDebugApi();
    setStatus(getTavernHelper() ? '就绪，已检测到酒馆助手' : '就绪，独立记忆模式');
}

function exposeDebugApi() {
    globalThis.codexSceneImageDirector = {
        version: EXT_VERSION,
        extractSceneLocal,
        compilePrompt,
        async composeText(text, { updateMemory = false, smart = false, focusCharacter = '' } = {}) {
            const sceneText = prepareSceneText(String(text || ''));
            const result = smart ? await buildSmartPrompt(sceneText) : compilePrompt(sceneText, { focusCharacter });
            if (updateMemory) {
                updateMemoryFromSelectedScene(sceneText, result.localScene, result.focus?.name || focusCharacter || getCurrentCharacterName());
                syncTavernHelperMemory();
            }
            return { ...result, trigger: buildChatu8Trigger(result.positive) };
        },
        buildScenePreviewPayload,
        resolveFocusCharacter,
        buildCaptureSelectionFromPoints,
        getDebugText,
        getSettings: () => structuredClone(ensureSettings()),
        getMemory: () => structuredClone(ensureChatMemory()),
        getStoryPrompt: () => buildStoryMemoryPrompt(getLatestStoryQuery()),
        getStoryPath: (query = '') => structuredClone(retrieveStoryPath(query || getLatestStoryQuery(), getStoryConfig().maxRetrieved)),
        getStoryDbStats: () => structuredClone(ensureStoryMemory().dbStats || {}),
        cleanStoryText,
        prepareSceneText,
        runDiagnostics,
        applyRecommendedSettings,
        refreshStoryMemory: () => updateStoryMemoryInjection(getLatestStoryQuery()),
        indexStoryMemory: () => indexExistingStoryMemory(),
        writePromptToMessage,
    };
}
$(() => init());
