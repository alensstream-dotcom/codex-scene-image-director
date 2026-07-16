const PACKET_RE = /<!--\s*JANIMA_CG\s*:\s*([\s\S]*?)\s*-->/gi;
const END_RE = /<!--\s*JANIMA_CG_END\s*:\s*([\s\S]*?)\s*-->/gi;

export const QUALITY_TAGS = ['masterpiece', 'best quality', 'score_7', 'highres', 'newest'];
export const NEGATIVE_TAGS = [
    'worst quality', 'low quality', 'score_1', 'score_2', 'score_3',
    'bad anatomy', 'bad hands', 'extra fingers', 'missing fingers',
    'fused bodies', 'duplicated person', 'merged people', 'wrong face',
    'different face', 'wrong hair color', 'wrong eye color', 'wrong clothes',
    'text', 'logo', 'signature', 'watermark', 'artist name', 'blurry', 'jpeg artifacts', 'chromatic aberration',
];

const NON_STORY_BLOCK_RE = /<(status|state|world_state|details|analysis|reasoning|thinking|thinking_process)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const STATUS_LINE_RE = /^(?:世界|状态栏?|当前状态|时间|地点|场景|好感度|神原樱|私密日记|当前位置|当前动作|体位动作|心情|学段|事件|目标|进度)\s*[：:#]/i;
const SERIALIZED_AUX_RE = /^(?:\\n|\[|\{|\}|```|PS\s*[:：]|nPS\s*[:：])/i;

const FEMALE_RE = /(?:\b(?:1girl|2girls|3girls|female|woman|women|girl|girls|lady|heroine|wife|girlfriend|mother|sister)\b|她|少女|女孩|女人|女性|女主|姑娘|妻子|女友|姐姐|妹妹|母亲|公主|女王|女仆)/i;
const MALE_RE = /(?:\b(?:1boy|2boys|male|man|men|boy|boys|husband|boyfriend)\b|他|男人|男性|男主|少年|丈夫|男友)/i;
const VISUAL_ACTION_RE = /(?:抓|握|扣|拽|抱|搂|环|吻|贴|靠|推|拉|扑|跌|跪|坐|站|跑|冲|跃|跳|躲|挥|刺|砍|射|脱|撕|压|抬|拔|挡|斩|劈|撞|递|喂|咬|旋身|闪避|转身|回头|靠近|分开|触碰|抚摸|颤抖|流泪|微笑|怒视|拥抱|接触|进入|抽动|高潮|亲吻|kiss|grab|hold|embrace|feed|bite|touch|press|pull|push|run|jump|fight|strike|block|draw|turn|kneel|sit|stand|undress|penetrat|climax|cry|smile)/i;
const DECISIVE_ACTION_RE = /(?:抓住|扣住|拽住|抱紧|搂紧|扑进|跃过|跳进|斩断|砍断|刺穿|挡住|击退|逼退|破窗|救下|拉住|亲吻|吻上|嘴唇[^。\n]{0,18}贴|kiss|block|strike|cut(?:s|ting)? through|leap|rescue)/i;
const EXPLICIT_RE = /(?:性交|做爱|插入|进入她|阴茎|阴道|乳房|裸体|全裸|口交|手交|高潮|射精|penetrat|oral sex|handjob|vaginal|penis|nipples?|nude|climax|cum)/i;
const NSFW_RE = /(?:情欲|暧昧|喘息|抚摸|脱下|解开|赤裸|亲吻|乳沟|裙底|nsfw|erotic|undress|naked|intimate)/i;

export function stableHash(value = '') {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function normalizedText(value = '') {
    return String(value)
        .replace(/\s+/g, ' ')
        .replace(/[\u200b-\u200d\ufeff]/g, '')
        .trim();
}

/**
 * Return only prose that can legitimately become a CG.
 *
 * Mobile regex themes often render status panels and database recall payloads
 * inside the same message container.  Reading innerText therefore turns
 * helper data into fake story beats unless the committed reply is cleaned
 * before storyboarding.
 */
export function extractNarrativeStory(value = '') {
    let text = stripProtocol(String(value || ''))
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(NON_STORY_BLOCK_RE, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|section|article|li|blockquote|content)>/gi, '\n\n')
        .replace(/<(?:p|div|section|article|li|blockquote|content)\b[^>]*>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&');

    const lines = text.replace(/\r/g, '').split('\n');
    const kept = [];
    let storyStarted = false;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (STATUS_LINE_RE.test(line)) break;
        if (storyStarted && SERIALIZED_AUX_RE.test(line)) {
            if (/^(?:\\n|\[|\{|```)/.test(line)) break;
            continue;
        }
        if (/^(?:#{1,6}\s*)?(?:输出开始|讨论开始|思维链|分析|写作计划)\s*[：:]?$/i.test(line)) continue;
        if (/^(?:Atri&Deach|assistant|system)\s*[：:]/i.test(line)) continue;
        kept.push(rawLine.trimEnd());
        if (line.length >= 6 && !/^[-#*]/.test(line)) storyStarted = true;
    }
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function cleanField(value, maximum = 1200) {
    return normalizedText(value).slice(0, maximum);
}

function cleanId(value, fallback) {
    const result = cleanField(value, 80).replace(/[<>"']/g, '');
    return result || fallback;
}

function uniqueTags(values) {
    const seen = new Set();
    const result = [];
    for (const raw of values.flatMap(value => String(value || '').split(/[,，]\s*/))) {
        const tag = cleanField(raw, 320);
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        result.push(tag);
    }
    return result;
}

function weightedAppearanceTags(value = '') {
    const text = normalizedText(value);
    const tags = [];
    const add = (pattern, tag) => { if (pattern.test(text)) tags.push(tag); };
    add(/银白(?:色)?(?:长发|短发|头发|马尾)|silver[- ]white hair|silver hair/i, '(long silver-white hair:1.8)');
    add(/黑色?(?:长发|短发|头发|马尾)|black hair/i, '(black hair:1.9)');
    add(/(?:棕|栗|茶)色?(?:长发|短发|头发|马尾)|brown hair/i, '(brown hair:1.9)');
    add(/金色?(?:长发|短发|头发|马尾)|金发|blonde hair/i, '(blonde hair:1.9)');
    add(/蓝色?(?:长发|短发|头发|马尾)|blue hair/i, '(blue hair:1.9)');
    add(/(?:樱|浅|淡)?粉色?(?:的)?[^。；,，]{0,4}(?:长发|短发|头发|马尾)|pink hair/i, '(sakura-pink hair:1.9)');
    add(/红色?(?:长发|短发|头发|马尾)|red hair/i, '(red hair:1.9)');
    add(/紫色?(?:长发|短发|头发|马尾)|purple hair/i, '(purple hair:1.9)');
    add(/(?<!银)白色?(?:长发|短发|头发|马尾)|white hair/i, '(white hair:1.9)');
    add(/双马尾|两条[^。；,，]{0,8}马尾|twin[- ]tails|twintails/i, '(twin ponytails:1.8)');
    add(/单马尾|高马尾|ponytail/i, '(ponytail:1.6)');
    add(/长发|long hair/i, '(long hair:1.5)');
    add(/短发|short hair/i, '(short hair:1.5)');
    add(/齐刘海|平刘海|straight bangs|blunt bangs/i, '(straight bangs:1.6)');
    add(/紫色(?:眼睛|眼眸|瞳)|purple eyes/i, '(purple eyes:1.7)');
    add(/蓝色(?:眼睛|眼眸|瞳)|blue eyes/i, '(blue eyes:1.7)');
    add(/琥珀色?(?:眼睛|眼眸|瞳)|amber eyes/i, '(amber eyes:1.7)');
    add(/绿色?(?:眼睛|眼眸|瞳)|green eyes/i, '(green eyes:1.7)');
    add(/棕色?(?:眼睛|眼眸|瞳)|brown eyes/i, '(brown eyes:1.7)');
    add(/红色?(?:眼睛|眼眸|瞳)|red eyes/i, '(red eyes:1.7)');
    add(/粉色?(?:眼睛|眼眸|瞳)|pink eyes/i, '(pink eyes:1.7)');
    add(/黑色?(?:眼睛|眼眸|瞳)|black eyes/i, '(black eyes:1.7)');
    add(/纤细(?:身材|体型)?|苗条|slim build|slender/i, 'slim build');
    add(/深蓝(?:色)?(?:制服|校服)|dark navy uniform|navy uniform/i, '(dark navy uniform:1.6)');
    add(/红色(?:领结|蝴蝶结)|red ribbon(?: tie)?/i, '(red ribbon tie:1.6)');
    add(/校服|school uniform/i, '(school uniform:1.5)');
    add(/(?:樱|浅|淡)?粉色?(?:针织)?(?:开衫|外套)|pink cardigan/i, '(pink cardigan:1.7)');
    add(/水手服|sailor uniform/i, '(sailor school uniform:1.7)');
    add(/百褶裙|pleated skirt/i, '(pleated school skirt:1.6)');
    add(/(?:樱|浅|淡)?粉色?(?:书包|背包)|pink school bag/i, '(pink school bag:1.7)');
    add(/乐福鞋|小皮鞋|loafers/i, 'brown loafers');
    add(/白色(?:连衣裙|长裙)|white dress/i, '(white dress:1.5)');
    add(/黑色(?:外套|大衣)|black coat/i, '(black coat:1.5)');
    add(/湿透|淋湿|wet hair|soaked/i, 'wet hair, soaked clothes');
    return uniqueTags(tags);
}

function conflictingAppearanceTags(value = '') {
    const text = normalizedText(value);
    const negatives = [];
    const add = (pattern, tags) => { if (pattern.test(text)) negatives.push(tags); };
    add(/(?:樱|浅|淡)?粉色?(?:的)?[^。；,，]{0,4}(?:长发|短发|头发|马尾)|pink hair/i, 'black hair, blue hair, brown hair, blonde hair, white hair');
    add(/银白(?:色)?(?:长发|短发|头发|马尾)|silver[- ]white hair|silver hair/i, 'black hair, blue hair, brown hair, blonde hair, pink hair');
    add(/黑色?(?:长发|短发|头发|马尾)|black hair/i, 'blue hair, brown hair, blonde hair, pink hair, white hair');
    add(/双马尾|两条[^。；,，]{0,8}马尾|twin[- ]tails|twintails/i, 'single ponytail, bob cut');
    add(/校服|school uniform|水手服/i, 'tactical outfit, bodysuit, military uniform, office suit');
    return uniqueTags(negatives);
}

function conflictingSceneTags(value = '') {
    const text = normalizedText(value);
    const negatives = [];
    const add = (pattern, tags) => { if (pattern.test(text)) negatives.push(tags); };
    add(/教室|课堂|课桌|classroom/i, 'train interior, bus interior, subway interior, outdoor street');
    add(/商店街|住宅街|放学.*路|shopping street/i, 'train interior, bus interior, classroom interior');
    return uniqueTags(negatives);
}

function englishSceneTags(value = '') {
    const text = normalizedText(value);
    const tags = [];
    const add = (pattern, tag) => { if (pattern.test(text)) tags.push(tag); };
    const wristContact = /(?:wrist\s+(?:grab|grip)|grab(?:bing|s|bed)?\s+(?:his|her|the)\s+wrist|grip(?:ping|s|ped)?\s+(?:his|her|the)\s+wrist)/i;
    add(wristContact, "close-up of heroine's right hand wrapped around her partner's left wrist, her fingers visibly circling his sleeve cuff, wrist contact point centered in frame, his hand open and empty, their arms extended between them");
    if (wristContact.test(text) && /bicycle|bike/i.test(text)) tags.push('parked bicycle behind the characters, both hands dedicated to the wrist contact');
    add(/抓住|扣住|拽住|扯住|gr(?:ab|ip)/i, "heroine gripping her male partner's wrist");
    add(/拉回|拽回|扯回|拉住|救下|to safety/i, 'pulling him to safety');
    add(/护在.*(?:身前|前面)|挡到.*(?:身前|前面)|shield/i, 'heroine shielding her male partner');
    add(/斩断|砍断|刀刃断开|武器.*(?:断|碎)|slash|weapon breaking/i, 'glowing sword slash, enemy weapon breaking, broken blade flying');
    add(/挡住|格挡|block/i, 'blocking an incoming strike with a glowing sword');
    add(/抱紧.*腰|环住.*腰|搂住.*腰|holding.*waist/i, "heroine holding her male partner's waist");
    add(/扑进.*怀|靠进.*怀|靠在.*肩|embrace/i, "heroine leaning into her male partner's embrace");
    add(/亲吻|吻上|嘴唇[^。\n]{0,22}贴|kiss/i, 'heroine kissing her male partner, lips touching');
    add(/跑|冲向|奔向|running/i, 'dynamic running motion');
    add(/跟在.*(?:身后|后面)|走在.*(?:前面|前方)|并肩.*走|一起.*走|回家|步伐|walking/i, 'heroine and her male companion walking together, both clearly visible in the same frame');
    add(/牵手|拉着.*手|手牵手|holding hands/i, 'heroine holding her male companion by the hand');
    add(/跃|跳(?:进|入|上|下|过|起)|leap|jump/i, 'dynamic leap');
    add(/跪|kneel/i, 'kneeling pose');
    add(/拔.*剑|细剑|光刃|sword/i, 'glowing slender sword');
    add(/车厢|列车|train/i, 'inside a damaged train car');
    add(/车顶|train roof/i, 'on top of a moving train');
    add(/断桥|broken bridge/i, 'broken railway bridge');
    add(/车站|站台|station/i, 'old train station platform');
    add(/学校|校门|教室|课堂|班主任|school|classroom/i, 'Japanese school setting');
    add(/商店街|店铺|商店|shopping street/i, 'sunlit neighborhood shopping street');
    add(/三明治|泡芙|奶油|点心|面包|sandwich|cream puff/i, 'visible snack in her hands');
    add(/(?:递|送|拿|举)[^。；\n]{0,12}(?:嘴边|唇边)|喂(?:给|到)?|feed/i, "heroine extending the snack directly to her male companion's mouth, he leans forward to take a bite, both faces visible");
    add(/雨夜|暴雨|雨水|rain/i, 'stormy night, heavy rain, wet hair, wet clothes');
    add(/破窗|玻璃.*(?:炸|碎)|shattered window/i, 'shattered train window');
    add(/火花|sparks/i, 'electric sparks');
    add(/含泪|流泪|眼泪|泪光|tears/i, 'tears in her eyes');
    add(/发抖|颤抖|trembling/i, 'trembling after danger');
    add(/脱下|脱掉|褪下|解开.*(?:衣|裙|裤|制服)|undress/i, 'clearly adult heroine undressing');
    add(/全裸|裸体|赤裸|naked|nude/i, 'clearly adult nude woman');
    add(/抚摸|爱抚|揉捏|caress|fondl/i, 'consensual adult intimate touching');
    add(/口交|oral sex/i, 'consensual adult oral sex');
    add(/手交|handjob/i, 'consensual adult handjob');
    add(/性交|做爱|插入|进入她|penetrat|vaginal/i, 'consensual adult vaginal intercourse, visible penetration');
    add(/骑乘|跨坐|cowgirl/i, 'adult woman straddling her partner, cowgirl position');
    add(/后入|doggystyle/i, 'consensual adult rear-entry position');
    add(/高潮|射精|climax|orgasm|cum/i, 'consensual adult sexual climax');
    add(/事后|余韵|aftercare/i, 'adult lovers embracing during aftercare');
    return uniqueTags(tags);
}

export function sanitizePacket(raw, index = 0) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('CG packet must be an object');
    const quote = cleanField(raw.quote, 420);
    if (quote.length < 4) throw new Error('CG packet quote is missing');
    const castInput = Array.isArray(raw.cast) ? raw.cast : [];
    const cast = castInput.slice(0, 4).map((item, castIndex) => ({
        id: cleanId(item?.id, `character_${castIndex + 1}`),
        prompt_name: cleanId(item?.prompt_name || item?.name, ''),
        dna: cleanField(item?.dna, 720),
        outfit: cleanField(item?.outfit, 420),
        identity_change: Boolean(item?.identity_change),
        outfit_change: Boolean(item?.outfit_change),
    }));
    return {
        version: 1,
        id: cleanId(raw.id, `shot_${index + 1}`),
        quote,
        people: cleanField(raw.people, 100),
        cast,
        action: cleanField(raw.action, 720),
        setting: cleanField(raw.setting, 420),
        expression: cleanField(raw.expression, 320),
        composition: cleanField(raw.composition, 320),
        stage: cleanId(raw.stage, 'story_beat').toLowerCase(),
        safety: normalizeSafety(raw.safety, `${quote} ${raw.action || ''}`),
    };
}

export function parseCgPackets(text = '') {
    const packets = [];
    const errors = [];
    const seen = new Set();
    PACKET_RE.lastIndex = 0;
    for (const match of String(text).matchAll(PACKET_RE)) {
        try {
            const packet = sanitizePacket(JSON.parse(match[1]), packets.length);
            if (seen.has(packet.id)) continue;
            seen.add(packet.id);
            packets.push(packet);
        } catch (error) {
            errors.push(String(error?.message || error));
        }
    }
    return { packets, errors };
}

export function stripProtocol(text = '') {
    return String(text).replace(PACKET_RE, '').replace(END_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * Removes legacy image-tag paragraphs without touching short choices or links.
 * Older worldbooks commonly emit a whole comma-separated prompt inside one
 * pair of square brackets.  Matching the shape is more reliable than matching
 * a particular language or model tag vocabulary.
 */
export function stripLegacyImagePromptLines(text = '') {
    return String(text)
        .split('\n')
        .filter(line => {
            const match = line.trim().match(/^\[([^\]\n]+)\]$/);
            if (!match) return true;
            const tags = match[1].split(/[,，]/).map(tag => tag.trim()).filter(Boolean);
            const words = match[1].split(/\s+/).filter(Boolean);
            const visualTagLine = match[1].length >= 40
                && words.length >= 7
                && /(?:1girl|2girls|woman|female|hair|eyes?|uniform|dress|skirt|kiss|embrace|kneel|rain|night|lighting|masterpiece|best quality|长发|短发|眼睛|眼眸|制服|裙|亲吻|拥抱|雨夜)/i.test(match[1]);
            return !((tags.length >= 5 && match[1].length >= 30) || visualTagLine);
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
}

export function normalizeSafety(value, evidence = '') {
    const requested = cleanField(value, 20).toLowerCase();
    if (EXPLICIT_RE.test(evidence) || requested === 'explicit') return 'explicit';
    if (NSFW_RE.test(evidence) || requested === 'nsfw') return 'nsfw';
    if (requested === 'sensitive') return 'sensitive';
    return 'safe';
}

export function hasFemale(packetOrText) {
    if (typeof packetOrText === 'string') return FEMALE_RE.test(packetOrText);
    const packet = packetOrText || {};
    return FEMALE_RE.test([
        packet.people,
        packet.quote,
        packet.action,
        ...(packet.cast || []).flatMap(item => [item.id, item.prompt_name, item.dna]),
    ].join(' '));
}

export function createBible() {
    return Object.create(null);
}

export function mergePacketIntoBible(bible, packet) {
    const target = bible || createBible();
    for (const cast of packet?.cast || []) {
        const key = cast.id.toLowerCase();
        const existing = target[key];
        if (!existing) {
            target[key] = {
                id: cast.id,
                prompt_name: cast.prompt_name,
                dna: cast.dna,
                outfit: cast.outfit,
            };
            continue;
        }
        // Identity is immutable by default. An image-model mistake never writes
        // back here, and a model-authored drift is ignored unless the story
        // explicitly marked a real transformation.
        if (cast.identity_change && cast.dna) existing.dna = cast.dna;
        if (!existing.dna && cast.dna) existing.dna = cast.dna;
        if (!existing.prompt_name && cast.prompt_name) existing.prompt_name = cast.prompt_name;
        if (cast.outfit_change && cast.outfit) existing.outfit = cast.outfit;
        if (!existing.outfit && cast.outfit) existing.outfit = cast.outfit;
    }
    return target;
}

export function applyBible(packet, bible) {
    const clone = structuredClone(packet);
    clone.cast = (clone.cast || []).map(cast => {
        const locked = bible?.[cast.id.toLowerCase()];
        if (!locked) return cast;
        return {
            ...cast,
            prompt_name: locked.prompt_name || cast.prompt_name,
            dna: cast.identity_change ? (cast.dna || locked.dna) : (locked.dna || cast.dna),
            outfit: cast.outfit_change ? (cast.outfit || locked.outfit) : (locked.outfit || cast.outfit),
        };
    });
    return clone;
}

export function serializeBible(bible, limit = 4200) {
    const lines = Object.values(bible || {}).map(item =>
        `- ${item.id}${item.prompt_name ? ` / ${item.prompt_name}` : ''}: DNA=${item.dna || 'unknown'}; CURRENT_OUTFIT=${item.outfit || 'unspecified'}`,
    );
    return lines.join('\n').slice(0, limit);
}

function actionTokens(value = '') {
    const text = normalizedText(value).toLowerCase();
    const latin = text.match(/[a-z0-9_]+/g) || [];
    const cjk = [...text.replace(/[^\u3400-\u9fff]/g, '')];
    const bigrams = cjk.slice(0, -1).map((char, index) => char + cjk[index + 1]);
    return new Set([...latin, ...bigrams]);
}

function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    for (const token of a) if (b.has(token)) intersection++;
    return intersection / (a.size + b.size - intersection);
}

export function beatSignature(packet) {
    const cast = (packet.cast || []).map(item => item.id.toLowerCase()).sort().join('+');
    return `${packet.stage}|${cast}|${normalizedText(packet.action).toLowerCase()}|${normalizedText(packet.setting).toLowerCase()}`;
}

export function isDuplicateBeat(packet, previous = []) {
    const action = actionTokens(`${packet.stage} ${packet.action} ${packet.quote}`);
    const setting = normalizedText(packet.setting).toLowerCase();
    const cast = (packet.cast || []).map(item => item.id.toLowerCase()).sort().join('+');
    return previous.slice(-8).some(item => {
        const other = item.packet || item;
        const otherCast = (other.cast || []).map(value => value.id.toLowerCase()).sort().join('+');
        const sameCast = !cast || !otherCast || cast === otherCast;
        const sameStage = packet.stage === other.stage;
        const sameSetting = !setting || !other.setting || setting === normalizedText(other.setting).toLowerCase();
        const similarity = jaccard(action, actionTokens(`${other.stage} ${other.action} ${other.quote}`));
        const specificStage = !['story_beat', 'story_action', 'unknown'].includes(packet.stage);
        const stageThreshold = specificStage ? 0.22 : 0.52;
        return sameCast && sameSetting && ((sameStage && similarity >= stageThreshold) || similarity >= 0.78);
    });
}

export function compilePrompt(packet, bible, extraDna = '') {
    const shot = applyBible(packet, bible);
    const castTags = shot.cast.flatMap((cast, index) => {
        const label = cast.prompt_name || cast.id || `character ${index + 1}`;
        const translated = weightedAppearanceTags(`${cast.dna} ${cast.outfit} ${extraDna}`);
        return [
            `character ${index + 1}: ${label}`,
            translated,
            cast.dna ? `identity reference: ${cleanField(cast.dna, 340)}` : '',
            cast.outfit ? `current outfit: ${cleanField(cast.outfit, 180)}` : '',
        ];
    });
    const evidence = shot.quote ? `story evidence: ${cleanField(shot.quote, 240)}` : '';
    const sceneTags = englishSceneTags(`${shot.action} ${shot.setting} ${shot.expression} ${shot.quote}`);
    const interactionTags = /1boy|2boys/i.test(shot.people)
        ? ['one heroine and one male companion, both prominent, same frame, visible interaction', 'do not replace the male companion with background extras']
        : [];
    const exactActionTags = sceneTags.map(tag => `(${tag}:1.25)`);
    const caption = sceneTags.length
        ? `An anime visual novel event CG. Show exactly this decisive instant: ${sceneTags.join(', ')}.`
        : 'An anime visual novel event CG. Show the decisive physical interaction described by the story evidence.';
    const positive = uniqueTags([
        QUALITY_TAGS,
        shot.safety,
        shot.people,
        castTags,
        'anime screenshot, official art, visual novel event CG',
        interactionTags,
        exactActionTags,
        sceneTags,
        caption,
        shot.composition || 'dynamic cinematic medium shot, clear character interaction',
        shot.action ? `original story action: ${cleanField(shot.action, 360)}` : '',
        evidence,
        'consistent character design',
    ]).join(', ');
    return {
        positive: positive.slice(0, 1800),
        negative: uniqueTags([
            NEGATIVE_TAGS,
            ...shot.cast.map(cast => conflictingAppearanceTags(`${cast.dna} ${cast.outfit} ${extraDna}`)),
            conflictingSceneTags(`${shot.action} ${shot.setting} ${shot.quote}`),
        ]).join(', '),
        packet: shot,
    };
}

export function seedForPacket(packet, retry = 0) {
    const identityKey = (packet.cast || []).map(item => item.id.toLowerCase()).sort().join('|') || 'janima-heroine';
    const base = stableHash(identityKey) % 2_000_000_000;
    return Math.max(1, (base + Math.max(0, Number(retry) || 0) * 104729) % 2_147_483_647);
}

function paragraphCandidates(story = '') {
    const clean = extractNarrativeStory(story).replace(PACKET_RE, '').replace(END_RE, '');
    let blocks = clean.split(/\n\s*\n+/);
    if (blocks.length < 3) {
        const lines = clean.split(/\n+/).map(line => line.trim()).filter(Boolean);
        const grouped = [];
        let current = [];
        for (const line of lines) {
            current.push(line);
            const proseLength = current.join(' ').length;
            const isDialogue = /^[“「『'\"]/.test(line) && /[。！？.!?][”」』']?$/.test(line);
            if (proseLength >= 90 || (isDialogue && proseLength >= 45)) {
                grouped.push(current.join(' '));
                current = [];
            }
        }
        if (current.length) grouped.push(current.join(' '));
        if (grouped.length > blocks.length) blocks = grouped;
    }
    return blocks
        .map((text, index, all) => ({ text: normalizedText(text), index, total: all.length }))
        .filter(item => item.text.length >= 12 && item.text.length <= 900);
}

function fallbackStage(text = '') {
    if (/高潮|射精|climax|orgasm/i.test(text)) return 'climax';
    if (/插入|进入她|penetrat/i.test(text)) return 'penetration';
    if (/(?:脱下|脱掉|褪下|解开|撕开)[^。；\n]{0,18}(?:衣|裙|裤|内衣|制服|衬衫)|undress|naked|裸体/i.test(text)) return 'undressing';
    if (/吻|kiss|嘴唇[^。\n]{0,18}贴/i.test(text)) return 'kiss';
    if (/递到.*嘴|喂|咬下|feed|bite/i.test(text)) return 'feeding';
    if (/打击|打斗|挥打|击打|打中|砍|刺|射|剑|利爪|拔|挡|斩|劈|fight|strike|block|draw sword/i.test(text)) return 'combat';
    if (/抱|拥抱|embrace/i.test(text)) return 'embrace';
    return 'story_action';
}

export function buildFallbackPackets(story, { bible = createBible(), characterName = '', characterVisual = '', maximum = 2 } = {}) {
    const knownFemale = hasFemale(`${characterName} ${characterVisual} ${serializeBible(bible)}`);
    const paragraphs = paragraphCandidates(story);
    const candidates = paragraphs.map(item => {
        const female = hasFemale(item.text) || knownFemale;
        const visual = VISUAL_ACTION_RE.test(item.text);
        const explicit = EXPLICIT_RE.test(item.text);
        const nsfw = NSFW_RE.test(item.text);
        const decisive = DECISIVE_ACTION_RE.test(item.text);
        const laterBonus = item.total > 1 ? item.index / (item.total - 1) * 2.2 : 0;
        const staticPenalty = /(?:只是站|站在原地|静静站|等待|观察|look(?:s|ing)? around|stand(?:s|ing)? still)/i.test(item.text) ? 3.5 : 0;
        const score = (female ? 6 : -20) + (visual ? 4 : 0) + (decisive ? 3 : 0) + (explicit ? 5 : nsfw ? 3 : 0)
            + Math.min(3, item.text.length / 120) + laterBonus - staticPenalty;
        return { ...item, female, visual, score, stage: fallbackStage(item.text) };
    }).filter(item => item.female && item.visual && item.score > 3);
    candidates.sort((a, b) => b.score - a.score || b.index - a.index);
    const selected = [];
    for (const candidate of candidates) {
        if (selected.some(item => item.stage === candidate.stage && Math.abs(item.index - candidate.index) <= 2)) continue;
        selected.push(candidate);
        if (selected.length >= Math.max(1, maximum)) break;
    }
    selected.sort((a, b) => a.index - b.index);
    const bibleCasts = Object.values(bible);
    const wantedName = normalizedText(characterName).toLowerCase();
    const bibleCast = bibleCasts.find(item => wantedName && [item.id, item.prompt_name]
        .some(value => normalizedText(value).toLowerCase() === wantedName))
        || (!wantedName ? bibleCasts[0] : undefined);
    return selected.map((item, index) => {
        const previousIndex = index > 0 ? selected[index - 1].index : -1;
        const storyWindow = paragraphs
            .filter(paragraph => paragraph.index > previousIndex && paragraph.index <= item.index)
            .map(paragraph => paragraph.text)
            .join(' ')
            .slice(-1100);
        return sanitizePacket({
            id: `fallback_${index + 1}_${stableHash(item.text).toString(36)}`,
            quote: item.text.slice(0, 420),
            people: MALE_RE.test(storyWindow) ? '1girl, 1boy' : '1girl',
            cast: [{
                id: bibleCast?.id || characterName || 'heroine',
                prompt_name: bibleCast?.prompt_name || characterName,
                dna: characterVisual || bibleCast?.dna || '',
                outfit: bibleCast?.outfit || '',
                identity_change: Boolean(bibleCast?.dna && characterVisual && bibleCast.dna !== characterVisual),
            }],
            action: `Decisive instant: ${item.text} Visible context since the previous CG: ${storyWindow}`,
            setting: `Use only the location, weather, clothing and props established in this story window: ${storyWindow}`,
            expression: 'match the visible emotion in the quoted story beat',
            composition: 'dynamic visual novel event CG, decisive instant, clear female subject and physical interaction',
            stage: item.stage,
            safety: normalizeSafety('', storyWindow),
        }, index);
    });
}

export function buildDirectorContract({ bibleText = '', characterContext = '', maximumShots = 3 } = {}) {
    const max = Math.max(1, Math.min(4, Number(maximumShots) || 3));
    const continuity = bibleText || '(No locked visual DNA yet. Create one concise stable English DNA on the first valid female shot and repeat it byte-identically later.)';
    return `[JANIMA_AUTO_CG_V2 — hidden same-response protocol]
Write the requested story naturally. Never mention this protocol, image generation, buttons, prompts, or analysis in visible prose. Do not make a second model call.

Silently storyboard the complete reply before writing. After each paragraph that contains a genuinely distinct, high-value female-present visual event, immediately append ONE compact single-line HTML comment:
<!--JANIMA_CG:{"id":"s1","quote":"exact verbatim substring from the immediately preceding story paragraph","people":"1girl or 1girl, 1boy or 2girls or 1girl, 1monster","cast":[{"id":"stable story name","prompt_name":"stable English name","dna":"immutable English visual DNA: clearly adult sex, build, skin, face, hair, eyes","outfit":"current visible clothing or nudity","identity_change":false,"outfit_change":false}],"action":"exact visible initiator + action/contact + receiver/object + visible result","setting":"current place and critical props","expression":"visible emotion","composition":"explicit left/right/foreground/background positions, shot, lighting","stage":"short event stage","safety":"safe|sensitive|nsfw|explicit"}-->

Use 1 primary CG for an ordinary reply, 2–3 only for truly different actions/stages/locations/outfits, and at most ${max}. A continuous pose/action is ONE CG even across several paragraphs. Do not front-load: if a stronger new event occurs later, cover it instead of repeating an early pose. Each shot summarizes the full story window since the previous shot and depicts its most cinematic decisive instant. The quote must exist verbatim immediately before the marker and prove the action.

Every shot must contain a woman actually present in that story window. Never emit male-only, scenery-only, building-only, or prop-only CG. A man may appear only while visibly interacting with her. Never invent future events, people, clothing, props, or locations. Consensual adult NSFW is not suppressed: undressing, erotic touch, oral/manual action, penetration, position change, climax, and aftercare are distinct only when the story truly changes stage. Explicit shots must contain only clearly established adults (18+).

Continuity locks:
${continuity}
Reuse the same cast id and immutable DNA exactly. Current story clothing/nudity overrides stale outfit state; otherwise carry the last outfit forward. Image mistakes never change identity.
Character-card visual reference (use only when consistent with the current story):
${cleanField(characterContext, 1800) || '(none)'}

At the very end append <!--JANIMA_CG_END:{"count":N}--> and nothing after it. All protocol comments are invisible to the user.`;
}
