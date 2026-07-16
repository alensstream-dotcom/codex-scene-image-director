import {
    DEFAULT_GROUNDED_NEGATIVE,
    DEFAULT_GROUNDED_POSITIVE,
    adultPacketAllowed,
    buildLocalGroundedPackets as buildBaseLocalPackets,
    compileGroundedPrompt as compileBasePrompt,
    mergeGroundedPackets,
    parseRichPackets,
    selectGroundedPackets as selectBasePackets,
} from './scene-grounding.mjs';

export {
    DEFAULT_GROUNDED_NEGATIVE,
    DEFAULT_GROUNDED_POSITIVE,
    adultPacketAllowed,
    mergeGroundedPackets,
    parseRichPackets,
};

const CJK_VISUAL_RE = /(?:走|跑|坐|站|跪|躺|推|拉|抱|搂|吻|抓|握|拔|挥|劈|刺|练|舞|回头|转身|探头|开门|关门|递|喂|抚|摸|脱|穿|进入|抽动|高潮|弹琴|抚琴|举剑|出剑|剑招|步法|微笑|流泪|脸红|颤抖)/i;
const EXPLICIT_STAGE_RE = [
    /(?:脱下|解开|裸体|赤裸|undress|nude|naked)/i,
    /(?:口交|oral sex)/i,
    /(?:手交|handjob)/i,
    /(?:性交|做爱|性行为|插入|进入她|penetrat|intercourse)/i,
    /(?:骑乘|跨坐|cowgirl|后入|doggystyle|体位)/i,
    /(?:高潮|射精|orgasm|climax|cum)/i,
    /(?:事后|余韵|aftercare)/i,
];
const ANCIENT_RE = /(?:古代|王家|夫人|公子|小姐|木剑|真剑|剑法|剑招|步法|仙女|宫图|亭|琴弦|抚琴|竹林|湖心|银甲|花枝|江湖|武林|hanfu|wuxia|ancient china)/i;
const FORBIDDEN_ANCIENT_POSITIVE_RE = /^(?:western military uniform|red military coat|red coat|military coat|military uniform|gold epaulettes?|epaulettes?|modern school uniform|futuristic armor|european palace interior|red cape)$/i;

function clean(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function quoteKey(packet = {}) {
    return clean(packet.quote).replace(/\s+/g, '').slice(0, 300);
}

function paragraphList(story = '') {
    return String(story || '').split(/\n\s*\n+/).map(clean).filter(Boolean);
}

function correctedPeople(text = '', fallback = '1girl') {
    const female = /(?:她|夫人|小姐|姑娘|姐姐|妹妹|女子|女人|少女|女主|女友|妻子|母亲|公主|女王|女仆|woman|women|girl|girls|heroine|wife|girlfriend|lady)/i.test(text);
    const male = /(?:他|男子|男人|男主|丈夫|男友|公子|少年|man|men|boy|boys|husband|boyfriend)/i.test(text);
    const pluralFemale = /(?:她们|两名女子|两个女人|二女|姐妹|2girls|two women|two girls)/i.test(text);
    if (pluralFemale && male) return '2girls, 1boy';
    if (pluralFemale) return '2girls';
    if (female && male) return '1girl, 1boy';
    if (female) return '1girl';
    return fallback;
}

function makeGenericPacket(paragraph, index) {
    const ancient = ANCIENT_RE.test(paragraph);
    const prompt = [
        correctedPeople(paragraph),
        ancient ? 'ancient Chinese fantasy, wuxia, hanfu, traditional Chinese environment' : 'visual novel scene',
        /木剑|练剑|剑招|步法/i.test(paragraph) ? 'woman practicing swordsmanship, wooden sword in hand, visible sword stance' : '',
        /真剑|拔剑|剑身|剑鞘/i.test(paragraph) ? 'woman drawing a reflective Chinese sword from its scabbard' : '',
        /抚琴|弹琴|琴弦|古琴/i.test(paragraph) ? 'woman seated and playing a guqin, both hands touching the strings' : '',
        /湖心亭|亭中|亭子/i.test(paragraph) ? 'lakeside Chinese pavilion' : '',
        /房间|卧房|卧室/i.test(paragraph) ? 'traditional bedroom interior' : '',
        /书房|书桌|书架/i.test(paragraph) ? 'traditional study room, desk and bookshelves' : '',
        /亲吻|接吻/i.test(paragraph) ? 'adult lovers kissing, lips touching' : '',
        /拥抱|抱紧|搂住/i.test(paragraph) ? 'adult lovers embracing, visible body contact' : '',
        /脱下|解开|裸体|赤裸/i.test(paragraph) ? 'clearly adult woman undressing, clothing being removed' : '',
        /性交|做爱|性行为|插入|进入她/i.test(paragraph) ? 'consensual adult intercourse, explicit penetration, clear body positioning' : '',
        /高潮|射精/i.test(paragraph) ? 'consensual adult sexual climax, flushed face' : '',
        /事后|余韵/i.test(paragraph) ? 'adult lovers embracing during aftercare' : '',
        'cinematic medium shot, clear visible action, important props fully visible',
    ].filter(Boolean).join(', ');
    const negative = ancient
        ? 'western military uniform, red military coat, epaulettes, red cape, modern school uniform, futuristic armor, European palace interior'
        : '';
    return {
        id: `filler_${index + 1}`,
        quote: paragraph,
        people: correctedPeople(paragraph),
        cast: [],
        action: '',
        setting: '',
        expression: '',
        composition: 'cinematic medium shot, clear visible action',
        prompt,
        negative,
        stage: /木剑|真剑|剑法|剑招/i.test(paragraph) ? 'sword_action'
            : /抚琴|弹琴|琴弦|古琴/i.test(paragraph) ? 'music'
                : /脱下|解开|裸体|赤裸/i.test(paragraph) ? 'undressing'
                    : /性交|做爱|性行为|插入|进入她/i.test(paragraph) ? 'penetration'
                        : /高潮|射精/i.test(paragraph) ? 'climax'
                            : 'story_action',
        safety: /性交|做爱|性行为|插入|进入她|高潮|射精|口交|手交|裸体|赤裸/i.test(paragraph) ? 'explicit'
            : /亲吻|接吻|拥抱|抚摸|脱下|解开/i.test(paragraph) ? 'nsfw'
                : 'safe',
        source: 'local-filler',
    };
}

export function desiredGroundedCount(story = '', { minimum = 3, maximum = 5 } = {}) {
    const paragraphs = paragraphList(story);
    const text = paragraphs.join('\n');
    const explicitStageCount = EXPLICIT_STAGE_RE.filter(pattern => pattern.test(text)).length;
    const changeCount = (text.match(/(?:换上|换下|脱下|穿上|走进|来到|离开|转场|房间|卧室|浴室|教室|街道|庭院|亭|湖边|树林|竹林|夜晚|清晨)/g) || []).length;
    let count = minimum;
    if (paragraphs.length >= 7 || text.length >= 900 || changeCount >= 2 || /(?:亲吻|接吻|拥抱|抚摸|爱抚|暧昧|喘息)/i.test(text)) count = 4;
    if (paragraphs.length >= 11 || text.length >= 1500 || explicitStageCount >= 2) count = 5;
    return Math.max(minimum, Math.min(maximum, count));
}

export function buildLocalGroundedPackets(story = '', { maximum = 5 } = {}) {
    const packets = buildBaseLocalPackets(story, { maximum }).map(packet => ({
        ...packet,
        people: correctedPeople(`${packet.quote} ${packet.prompt}`, packet.people || '1girl'),
    }));
    const targetMinimum = Math.min(3, Math.max(1, maximum));
    if (packets.length >= targetMinimum) return packets;

    const existing = new Set(packets.map(quoteKey));
    const paragraphs = paragraphList(story);
    const candidates = paragraphs
        .map((paragraph, index) => ({ paragraph, index, visual: CJK_VISUAL_RE.test(paragraph), ancient: ANCIENT_RE.test(paragraph) }))
        .sort((a, b) => Number(b.visual) - Number(a.visual) || Number(b.ancient) - Number(a.ancient) || b.index - a.index);
    for (const candidate of candidates) {
        if (packets.length >= targetMinimum) break;
        const packet = makeGenericPacket(candidate.paragraph, candidate.index);
        if (existing.has(quoteKey(packet))) continue;
        existing.add(quoteKey(packet));
        packets.push(packet);
    }
    const order = new Map(paragraphs.map((paragraph, index) => [clean(paragraph).replace(/\s+/g, ''), index]));
    return packets.sort((a, b) => (order.get(clean(a.quote).replace(/\s+/g, '')) ?? 9999) - (order.get(clean(b.quote).replace(/\s+/g, '')) ?? 9999));
}

export function selectGroundedPackets(packets = [], story = '', { minimum = 3, maximum = 5 } = {}) {
    const desired = desiredGroundedCount(story, { minimum, maximum });
    const selected = selectBasePackets(packets, story, { minimum, maximum });
    const selectedKeys = new Set(selected.map(quoteKey));
    for (const packet of packets) {
        if (selected.length >= desired) break;
        if (selectedKeys.has(quoteKey(packet))) continue;
        selectedKeys.add(quoteKey(packet));
        selected.push(packet);
    }
    const paragraphs = paragraphList(story);
    const order = new Map(paragraphs.map((paragraph, index) => [clean(paragraph).replace(/\s+/g, ''), index]));
    return selected.slice(0, maximum).sort((a, b) => (order.get(clean(a.quote).replace(/\s+/g, '')) ?? 9999) - (order.get(clean(b.quote).replace(/\s+/g, '')) ?? 9999));
}

export function compileGroundedPrompt(packet = {}, options = {}) {
    const compiled = compileBasePrompt(packet, options);
    const evidence = `${packet.quote || ''} ${packet.prompt || ''} ${packet.setting || ''}`;
    if (!ANCIENT_RE.test(evidence)) return compiled;
    const positive = compiled.positive
        .split(/,\s*/)
        .filter(tag => !FORBIDDEN_ANCIENT_POSITIVE_RE.test(tag.trim()))
        .join(', ');
    const negativeTags = new Set(compiled.negative.split(/,\s*/).filter(Boolean));
    for (const tag of ['western military uniform', 'red military coat', 'epaulettes', 'red cape', 'modern school uniform', 'futuristic armor', 'European palace interior']) {
        negativeTags.add(tag);
    }
    return { positive, negative: [...negativeTags].join(', ') };
}
