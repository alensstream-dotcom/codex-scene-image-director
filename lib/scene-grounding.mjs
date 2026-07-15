const PACKET_RE = /<!--\s*JANIMA_CG\s*:\s*([\s\S]*?)\s*-->/gi;

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const FEMALE_RE = /(?:她|夫人|小姐|姑娘|姐姐|妹妹|女子|女人|少女|女主|女友|妻子|母亲|公主|女王|女仆|woman|women|girl|girls|heroine|wife|girlfriend|lady)/i;
const MALE_RE = /(?:他|男子|男人|男主|丈夫|男友|公子|少年|man|men|boy|boys|husband|boyfriend)/i;
const VISUAL_RE = /(?:走|跑|坐|站|跪|躺|推|拉|抱|搂|吻|抓|握|拔|挥|劈|刺|练|舞|回头|转身|探头|开门|关门|递|喂|抚|摸|脱|穿|进入|抽动|高潮|弹琴|抚琴|举剑|出剑|剑招|步法|微笑|流泪|脸红|颤抖|walk|run|sit|stand|kneel|lie|push|pull|embrace|kiss|grab|hold|draw|swing|stab|turn|peek|open|feed|touch|undress|penetrat|climax|play.*instrument)/i;
const CHANGE_RE = /(?:换上|换下|脱下|穿上|走进|来到|离开|转场|房间|卧室|浴室|教室|街道|庭院|亭|湖边|树林|竹林|夜晚|清晨|changed clothes|entered|arrived|left|bedroom|bathroom|classroom|street|courtyard|pavilion|lakeside|forest|night|morning)/i;
const NSFW_RE = /(?:性交|做爱|插入|进入她|口交|手交|裸体|全裸|高潮|射精|阴道|阴茎|乳房|乳头|penetrat|oral sex|handjob|nude|orgasm|climax|cum)/i;
const INTIMATE_RE = /(?:亲吻|接吻|拥抱|抚摸|爱抚|脱下|解开|暧昧|喘息|赤裸|kiss|embrace|caress|undress|intimate|erotic|naked)/i;
const MINOR_RE = /(?:未成年|小学生|初中生|幼女|萝莉|儿童|child|minor|underage|loli|\b(?:[0-9]|1[0-7])\s*(?:岁|years? old|yo)\b)/i;
const ANCIENT_RE = /(?:古代|王家|夫人|公子|小姐|木剑|真剑|剑法|剑招|步法|仙女|宫图|亭|琴弦|抚琴|竹林|湖心|银甲|花枝|江湖|武林|hanfu|wuxia|ancient china)/i;

export const DEFAULT_GROUNDED_POSITIVE = 'masterpiece, best quality, score_7, highres, newest, anime illustration, visual novel event CG, clean lineart, detailed eyes, detailed clothing, natural anatomy, coherent hands, cinematic composition, detailed environment';
export const DEFAULT_GROUNDED_NEGATIVE = 'worst quality, low quality, score_1, score_2, score_3, blurry, lowres, bad anatomy, bad hands, extra fingers, missing fingers, fused bodies, duplicated person, cloned face, wrong face, different face, wrong hair color, wrong eye color, wrong clothes, unrelated character, unrelated scene, multiple views, split screen, comic panel, collage, white border, large empty border, tiny subject, text, logo, signature, watermark, artist name, jpeg artifacts';

function clean(value = '', maximum = 1600) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function uniqueTags(values) {
    const seen = new Set();
    const result = [];
    for (const raw of values.flatMap(value => String(value || '').split(/[,，]\s*/))) {
        const tag = raw.trim();
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        result.push(tag);
    }
    return result;
}

function englishTags(value = '') {
    return uniqueTags([value]).filter(tag => !CJK_RE.test(tag) && /[a-z]/i.test(tag));
}

function safetyFor(text = '', requested = '') {
    const value = String(requested || '').toLowerCase();
    if (value === 'explicit' || NSFW_RE.test(text)) return 'explicit';
    if (value === 'nsfw' || INTIMATE_RE.test(text)) return 'nsfw';
    if (value === 'sensitive') return 'sensitive';
    return 'safe';
}

function stageFor(text = '') {
    if (/高潮|射精|orgasm|climax|cum/i.test(text)) return 'climax';
    if (/插入|进入她|性交|做爱|penetrat|intercourse/i.test(text)) return 'penetration';
    if (/口交|oral sex/i.test(text)) return 'oral';
    if (/手交|handjob/i.test(text)) return 'manual';
    if (/脱下|解开|裸体|赤裸|undress|nude|naked/i.test(text)) return 'undressing';
    if (/亲吻|接吻|kiss/i.test(text)) return 'kiss';
    if (/拥抱|抱紧|搂住|embrace|hug/i.test(text)) return 'embrace';
    if (/抚琴|弹琴|琴弦|play.*(?:guqin|zither|instrument)/i.test(text)) return 'music';
    if (/木剑|真剑|拔剑|挥剑|剑招|练剑|sword/i.test(text)) return 'sword_action';
    if (/走进|来到|离开|entered|arrived|left/i.test(text)) return 'location_change';
    return 'story_action';
}

function peopleFor(text = '') {
    const femaleHits = (String(text).match(/她|夫人|小姐|姑娘|姐姐|妹妹|女子|女人|少女|女主|女友|妻子|母亲|公主|女王|女仆/g) || []).length;
    const female = FEMALE_RE.test(text);
    const male = MALE_RE.test(text);
    if (femaleHits >= 2 && !male) return '2girls';
    if (female && male) return '1girl, 1boy';
    return '1girl';
}

function styleTags(text = '') {
    if (ANCIENT_RE.test(text)) return ['ancient Chinese fantasy', 'wuxia', 'traditional Chinese interior', 'hanfu'];
    if (/教室|学校|校服|classroom|school/i.test(text)) return ['modern Japanese school setting'];
    if (/都市|办公室|手机|汽车|office|city|smartphone|car/i.test(text)) return ['modern setting'];
    return ['visual novel scene'];
}

function actionTags(text = '') {
    const tags = [];
    const add = (pattern, value) => { if (pattern.test(text)) tags.push(value); };
    add(/木剑|练剑|剑招|步法|挥剑|拔剑|出剑|sword practice|wooden sword/i, 'woman practicing swordsmanship, wooden sword in hand, visible sword stance');
    add(/真剑|剑身|剑鞘|拔出.*剑|draw.*sword/i, 'woman drawing a real sword from its scabbard, reflective blade');
    add(/抚琴|弹琴|琴弦|古琴|play.*guqin|zither/i, 'woman seated and playing a guqin, both hands touching the strings');
    add(/亲吻|接吻|kiss/i, 'adult lovers kissing, lips touching');
    add(/拥抱|抱紧|搂住|embrace|hug/i, 'adult lovers embracing, visible body contact');
    add(/牵手|拉着.*手|holding hands/i, 'holding hands');
    add(/递|喂|feed|offer/i, 'handing an object to another character, visible interaction');
    add(/推开门|开门|door/i, 'opening a door');
    add(/探头|peek/i, 'peeking through a doorway');
    add(/回头|turn.*head/i, 'looking back over her shoulder');
    add(/坐下|坐在|sit/i, 'sitting');
    add(/跪|kneel/i, 'kneeling');
    add(/跑|奔|冲|run/i, 'dynamic running motion');
    add(/脱下|解开|褪下|undress/i, 'clearly adult woman undressing, clothing being removed');
    add(/全裸|裸体|赤裸|nude|naked/i, 'clearly adult nude woman');
    add(/抚摸|爱抚|caress|fondle/i, 'consensual adult intimate touching');
    add(/口交|oral sex/i, 'consensual adult oral sex');
    add(/手交|handjob/i, 'consensual adult handjob');
    add(/性交|做爱|插入|进入她|penetrat|intercourse/i, 'consensual adult intercourse, explicit penetration');
    add(/骑乘|跨坐|cowgirl/i, 'adult woman straddling her partner, cowgirl position');
    add(/后入|doggystyle/i, 'consensual adult rear-entry position');
    add(/高潮|射精|orgasm|climax|cum/i, 'consensual adult sexual climax');
    add(/事后|余韵|aftercare/i, 'adult lovers embracing during aftercare');
    return tags.length ? tags : ['clear visible physical action from the selected story paragraph'];
}

function settingTags(text = '') {
    const tags = [];
    const add = (pattern, value) => { if (pattern.test(text)) tags.push(value); };
    add(/房间|卧房|卧室|床榻|bedroom|room/i, 'inside a furnished bedroom');
    add(/书房|书桌|书架|study|bookshelf/i, 'inside a traditional study room, desk and bookshelves');
    add(/庭院|院子|courtyard/i, 'traditional Chinese courtyard');
    add(/湖心亭|亭中|亭子|pavilion/i, 'lakeside Chinese pavilion');
    add(/湖边|湖面|lakeside|lake/i, 'beside a misty lake');
    add(/竹林|bamboo/i, 'bamboo grove');
    add(/树林|森林|forest/i, 'forest');
    add(/教室|classroom/i, 'classroom interior');
    add(/街道|街上|street/i, 'street');
    add(/夜|灯笼|moon|night/i, 'night lighting, warm lantern light');
    add(/清晨|morning|dawn/i, 'soft morning light');
    return tags.length ? tags : ['environment matching the selected story paragraph'];
}

function expressionTags(text = '') {
    const tags = [];
    const add = (pattern, value) => { if (pattern.test(text)) tags.push(value); };
    add(/微笑|笑|smile/i, 'gentle smile');
    add(/脸红|羞|blush/i, 'blushing');
    add(/哭|眼泪|泪|tears|cry/i, 'tears in her eyes');
    add(/生气|怒|angry/i, 'angry expression');
    add(/紧张|害怕|fear|nervous/i, 'tense expression');
    add(/喘息|pant|moan/i, 'flushed face, heavy breathing');
    return tags.length ? tags : ['expression matching the selected story moment'];
}

function compositionTags(text = '') {
    if (NSFW_RE.test(text)) return ['intimate medium close-up', 'both adult participants clearly visible', 'clear contact and body positioning'];
    if (INTIMATE_RE.test(text)) return ['romantic medium close-up', 'both faces visible', 'clear physical interaction'];
    if (/剑|跑|冲|跃|fight|sword|run/i.test(text)) return ['dynamic full-body shot', 'clear limb positions', 'cinematic action composition'];
    if (/琴|坐|桌|pavilion|亭/i.test(text)) return ['medium shot', 'hands and important prop fully visible', 'balanced environmental composition'];
    return ['cinematic medium shot', 'main subject large in frame', 'clear action and environment'];
}

function conflictNegative(text = '') {
    const tags = [];
    if (ANCIENT_RE.test(text)) tags.push('western military uniform', 'red military coat', 'epaulettes', 'modern school uniform', 'futuristic armor', 'European palace interior');
    if (/木剑|真剑|剑法|剑招/i.test(text)) tags.push('gun', 'modern weapon', 'empty hands');
    if (/抚琴|琴弦|古琴/i.test(text)) tags.push('piano', 'guitar', 'violin', 'empty hands');
    return tags;
}

function localPrompt(text = '') {
    return uniqueTags([
        peopleFor(text),
        styleTags(text),
        actionTags(text),
        settingTags(text),
        expressionTags(text),
        compositionTags(text),
    ]).join(', ');
}

function packetScore(packet = {}, index = 0, total = 1) {
    const evidence = `${packet.quote || ''} ${packet.action || ''} ${packet.setting || ''} ${packet.prompt || ''} ${packet.stage || ''}`;
    const safety = safetyFor(evidence, packet.safety);
    let score = 0;
    if (safety === 'explicit') score += 180;
    else if (safety === 'nsfw') score += 100;
    if (VISUAL_RE.test(evidence)) score += 35;
    if (CHANGE_RE.test(evidence)) score += 20;
    if (englishTags(packet.prompt).length >= 8) score += 35;
    if (FEMALE_RE.test(evidence) || /girl|woman/i.test(packet.people || '')) score += 25;
    if (/^[“「『"']/.test(clean(packet.quote)) && clean(packet.quote).length < 80) score -= 25;
    score += total > 1 ? (index / (total - 1)) * 20 : 0;
    return score;
}

export function desiredGroundedCount(story = '', { minimum = 3, maximum = 5 } = {}) {
    const text = String(story || '');
    const paragraphs = text.split(/\n\s*\n+/).map(value => value.trim()).filter(value => value.length >= 12);
    const explicitStages = new Set();
    for (const paragraph of paragraphs) {
        const stage = stageFor(paragraph);
        if (['undressing', 'oral', 'manual', 'penetration', 'climax'].includes(stage)) explicitStages.add(stage);
    }
    let count = minimum;
    if (paragraphs.length >= 7 || text.length >= 900 || (text.match(new RegExp(CHANGE_RE.source, 'gi')) || []).length >= 2 || INTIMATE_RE.test(text)) count = 4;
    if (paragraphs.length >= 11 || text.length >= 1500 || explicitStages.size >= 2) count = 5;
    return Math.max(minimum, Math.min(maximum, count));
}

export function parseRichPackets(text = '') {
    const packets = [];
    const errors = [];
    PACKET_RE.lastIndex = 0;
    for (const match of String(text || '').matchAll(PACKET_RE)) {
        try {
            const raw = JSON.parse(match[1]);
            const quote = clean(raw.quote, 700);
            if (quote.length < 4) throw new Error('packet quote missing');
            const cast = (Array.isArray(raw.cast) ? raw.cast : []).slice(0, 4).map((item, castIndex) => ({
                id: clean(item?.id || `character_${castIndex + 1}`, 80),
                prompt_name: clean(item?.prompt_name || item?.name, 80),
                dna: clean(item?.dna, 800),
                outfit: clean(item?.outfit, 500),
            }));
            const evidence = `${quote} ${raw.action || ''} ${raw.prompt || ''}`;
            packets.push({
                id: clean(raw.id || `shot_${packets.length + 1}`, 80),
                quote,
                people: clean(raw.people || peopleFor(evidence), 80),
                cast,
                action: clean(raw.action, 800),
                setting: clean(raw.setting, 500),
                expression: clean(raw.expression, 300),
                composition: clean(raw.composition, 400),
                prompt: clean(raw.prompt || raw.visual_prompt, 1800),
                negative: clean(raw.negative, 900),
                stage: clean(raw.stage || stageFor(evidence), 80).toLowerCase(),
                safety: safetyFor(evidence, raw.safety),
                source: 'model',
            });
        } catch (error) {
            errors.push(String(error?.message || error));
        }
    }
    return { packets, errors };
}

export function buildLocalGroundedPackets(story = '', { maximum = 5 } = {}) {
    const paragraphs = String(story || '').split(/\n\s*\n+/).map(value => clean(value, 900)).filter(value => value.length >= 12);
    const storyHasFemale = FEMALE_RE.test(story);
    const candidates = paragraphs.map((quote, index, all) => {
        const previous = all.slice(Math.max(0, index - 2), index).join(' ');
        const window = `${previous} ${quote}`;
        const visual = VISUAL_RE.test(quote);
        const female = FEMALE_RE.test(window) || storyHasFemale;
        const safety = safetyFor(window);
        let score = packetScore({ quote, action: quote, safety, people: female ? peopleFor(window) : '' }, index, all.length);
        if (!visual && safety === 'safe') score -= 30;
        if (!female) score -= 80;
        return { quote, window, index, score, safety };
    }).filter(item => item.score > 0);
    candidates.sort((a, b) => b.score - a.score || b.index - a.index);
    const picked = [];
    const stages = new Set();
    for (const item of candidates) {
        const stage = stageFor(item.window);
        const critical = item.safety === 'explicit' || item.safety === 'nsfw';
        if (!critical && stages.has(stage)) continue;
        stages.add(stage);
        picked.push(item);
        if (picked.length >= Math.max(3, maximum)) break;
    }
    if (picked.length < Math.min(3, paragraphs.length)) {
        for (const item of candidates) {
            if (picked.includes(item)) continue;
            picked.push(item);
            if (picked.length >= Math.min(3, paragraphs.length)) break;
        }
    }
    return picked.sort((a, b) => a.index - b.index).map((item, index) => ({
        id: `local_${index + 1}_${Math.abs(hashText(item.quote)).toString(36)}`,
        quote: item.quote,
        people: peopleFor(item.window),
        cast: [],
        action: englishTags(actionTags(item.window)).join(', '),
        setting: englishTags(settingTags(item.window)).join(', '),
        expression: englishTags(expressionTags(item.window)).join(', '),
        composition: englishTags(compositionTags(item.window)).join(', '),
        prompt: localPrompt(item.window),
        negative: uniqueTags(conflictNegative(item.window)).join(', '),
        stage: stageFor(item.window),
        safety: item.safety,
        source: 'local',
    }));
}

function hashText(value = '') {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function mergeGroundedPackets(modelPackets = [], localPackets = []) {
    const byQuote = new Map();
    for (const packet of [...localPackets, ...modelPackets]) {
        const key = clean(packet.quote).replace(/\s+/g, '').slice(0, 240);
        const existing = byQuote.get(key);
        if (!existing || packetScore(packet) >= packetScore(existing)) byQuote.set(key, packet);
    }
    return [...byQuote.values()];
}

export function selectGroundedPackets(packets = [], story = '', { minimum = 3, maximum = 5 } = {}) {
    const desired = desiredGroundedCount(story, { minimum, maximum });
    const scored = packets.map((packet, index, all) => ({ packet, index, score: packetScore(packet, index, all.length) }));
    scored.sort((a, b) => b.score - a.score || b.index - a.index);
    const selected = [];
    const stages = new Set();
    const critical = scored.filter(item => ['nsfw', 'explicit'].includes(safetyFor(`${item.packet.quote} ${item.packet.prompt}`, item.packet.safety)));
    for (const item of critical) {
        const stage = item.packet.stage || stageFor(`${item.packet.quote} ${item.packet.prompt}`);
        if (selected.length >= maximum) break;
        if (stages.has(stage) && stage !== 'penetration') continue;
        selected.push(item);
        stages.add(stage);
    }
    for (const item of scored) {
        if (selected.includes(item) || selected.length >= desired) continue;
        const stage = item.packet.stage || 'story_action';
        if (stages.has(stage) && !['nsfw', 'explicit'].includes(item.packet.safety)) continue;
        selected.push(item);
        stages.add(stage);
    }
    for (const item of scored) {
        if (selected.includes(item) || selected.length >= desired) continue;
        selected.push(item);
    }
    const storyOrder = new Map(String(story || '').split(/\n\s*\n+/).map((paragraph, index) => [clean(paragraph).replace(/\s+/g, ''), index]));
    return selected.slice(0, maximum).sort((a, b) => {
        const ai = storyOrder.get(clean(a.packet.quote).replace(/\s+/g, '')) ?? a.index;
        const bi = storyOrder.get(clean(b.packet.quote).replace(/\s+/g, '')) ?? b.index;
        return ai - bi;
    }).map(item => item.packet);
}

export function adultPacketAllowed(packet = {}, context = '') {
    if (!['nsfw', 'explicit'].includes(String(packet.safety || '').toLowerCase())) return true;
    return !MINOR_RE.test(`${context} ${packet.quote} ${packet.prompt} ${(packet.cast || []).map(item => `${item.id} ${item.dna}`).join(' ')}`);
}

function cardMatchesPacket(packet = {}, card = {}) {
    const name = clean(card.name, 100);
    if (!name) return false;
    const evidence = `${packet.quote} ${packet.prompt} ${(packet.cast || []).map(item => `${item.id} ${item.prompt_name}`).join(' ')}`.toLowerCase();
    return evidence.includes(name.toLowerCase());
}

export function compileGroundedPrompt(packet = {}, {
    fixedPositive = DEFAULT_GROUNDED_POSITIVE,
    fixedNegative = DEFAULT_GROUNDED_NEGATIVE,
    card = {},
} = {}) {
    const evidence = `${packet.quote} ${packet.action} ${packet.setting} ${packet.prompt}`;
    const promptTags = englishTags(packet.prompt);
    const fallbackTags = uniqueTags([
        englishTags(packet.action),
        englishTags(packet.setting),
        englishTags(packet.expression),
        englishTags(packet.composition),
    ]);
    const castTags = [];
    for (const cast of packet.cast || []) {
        castTags.push(...englishTags(cast.prompt_name), ...englishTags(cast.dna), ...englishTags(cast.outfit));
    }
    if (cardMatchesPacket(packet, card)) castTags.push(...englishTags(card.visual));
    const sceneTags = promptTags.length >= 5 ? promptTags : uniqueTags([localPrompt(evidence), fallbackTags]);
    const positive = uniqueTags([
        fixedPositive,
        packet.safety || safetyFor(evidence),
        packet.people || peopleFor(evidence),
        castTags,
        sceneTags,
        englishTags(packet.composition),
    ]).join(', ').slice(0, 2000);
    const negative = uniqueTags([
        fixedNegative,
        englishTags(packet.negative),
        conflictNegative(evidence),
    ]).join(', ').slice(0, 1800);
    return { positive, negative };
}
