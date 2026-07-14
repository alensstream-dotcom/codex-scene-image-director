import { identityAnchorIssues } from './identity-locks.mjs';
import { ANIMA_NATIVE_QUALITY_TAGS, ANIMA_SAFETY_TAGS } from './anima-workflow.mjs';

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const VISUAL_TOKEN_RE = /(?:^|,\s*)(?:[123](?:girl|boy)s?|solo|duo|pov|[a-z]+\s+(?:hair|eyes?|dress|uniform|shirt|skirt|socks?|pose|shot|lighting|background|room|door|sofa)|sitting|standing|peeking|holding|looking|smiling|crying|tight\s+(?:framing|composition)|upper body|full body)(?:,|$)/i;
const SENTENCE_RE = /\b(?:because|while|then|she thinks|he thinks|she realizes|he realizes|remembered that|felt that)\b/i;
const SOLO_RELATION_RE = /\b(?:beside|next to|alongside|together with|facing|embracing|kissing|holding hands with)\s+(?:her|him|them|another|each other)\b/i;
const FEMALE_SUBJECT_RE = /\b(?:[1-6]girls?|girl|girls|adult woman|adult women|woman|women|female protagonist|female focus)\b/i;
const CINEMATIC_BEAT_RE = /\b(?:entering|appearing|opening|closing|turning|looking|gazing|reaching|grabbing|holding|offering|receiving|pulling|pushing|embracing|kissing|protecting|fighting|running|kneeling|sitting|standing|peeking|pointing|raising|drawing|crying|smiling|blushing|laughing|shocked|surprised|angry|furious|afraid|determined|trembling|wounded|transformation|dynamic pose|expressive face|expressive faces)\b/i;
const COUNT_RE = /<!--\s*IMG_COUNT\s*:\s*([0-6])\s*-->/gi;
const VISIBLE_FEMALE_STORY_RE = /(?:她|她们|少女|女孩|女生|女人|女性|女士|姑娘|女王|女皇|公主|圣女|魔女|女仆|姐姐|妹妹|母亲|妻子|女友|女朋友|老婆|新娘|(?:女|雌)性角色|\b(?:she|her|hers|woman|women|girl|girls|female|lady|ladies|queen|princess|witch|maid|sister|mother|wife|girlfriend|bride)\b)/i;
const STORY_TRANSITION_RE = /(?:忽然|突然|下一刻|紧接着|随后|与此同时|片刻后|不久后|次日|清晨|黄昏|夜幕|转场|画面切|镜头切|来到|抵达|冲入|闯入|推开.{0,8}(?:门|窗)|离开|走出|换上|换下|脱下|解开|撕开|变身|现身|出现|登场|却|但是|然而|反而|\b(?:suddenly|moments? later|meanwhile|the next|at dawn|at dusk|arriv(?:e|es|ed)|enter(?:s|ed|ing)?|leave(?:s|left|ing)?|change[sd]? into|remove[sd]?|undress(?:es|ed|ing)?|transform(?:s|ed|ing)?|appear(?:s|ed|ing)?|but|however)\b)/i;
const STORY_EMOTION_RE = /(?:震惊|惊讶|错愕|恐惧|愤怒|恼怒|哭|泪|脸红|潮红|羞耻|害羞|微笑|大笑|绝望|坚定|决然|犹豫|颤抖|喘息|高潮|释然|温柔|冰冷|杀意|\b(?:shocked|surprised|afraid|angry|furious|crying|tears|blushing|embarrassed|smiling|laughing|despair|determined|hesitat(?:e|es|ed|ing)|trembling|panting|climax|relieved|tender)\b)/i;
const CONTINUOUS_BEAT_RE = /(?:继续|仍然|依旧|保持|没有松开|反复|持续|一动不动|\b(?:continue[sd]?|still|keeps?|remain(?:s|ed)?|without letting go|repeatedly)\b)/i;
const STORY_RESULT_RE = /(?:终于|成功|失败|挣脱|断裂|倒下|击中|制服|屈服|松开|释放|爆发|达到|结束|停止|余韵|满足|失神|瘫软|\b(?:finally|succeed(?:s|ed)?|fail(?:s|ed)?|breaks? free|shatter(?:s|ed)?|defeat(?:s|ed)?|surrender(?:s|ed)?|release(?:s|d)?|erupts?|reaches?|ends?|stops?|aftermath|spent|satisfied)\b)/i;
const STORY_META_RE = /^(?:#{1,6}\s*)?(?:\d+(?:\.\d+)*[.、:]?\s*)?(?:基础要求|人物塑造|剧情要求|详略安排|字数段落|文笔要求|创作手法|补充要求|生图处理|最终检查|检查清单|执行步骤|思维链|analysis|reasoning|planning|requirements?|image planning)\b/i;
const HIDDEN_REASONING_BLOCK_RE = /<(think|thinking|analysis|reasoning|planning|scratchpad)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const ACTION_PATTERNS = [
    ['enter', /(?:冲入|闯入|进入|走进|推门|现身|登场|出现|\b(?:enter(?:s|ed|ing)?|burst(?:s)? in|appear(?:s|ed|ing)?)\b)/i],
    ['leave', /(?:离开|走出|退场|消失|\b(?:leave(?:s|left|ing)?|exit(?:s|ed|ing)?|disappear(?:s|ed|ing)?)\b)/i],
    ['turn', /(?:转身|回头|侧过脸|\b(?:turn(?:s|ed|ing)?|look(?:s|ed|ing)? back)\b)/i],
    ['reach', /(?:伸手|探手|递出|接过|塞进|\b(?:reach(?:es|ed|ing)?|offer(?:s|ed|ing)?|hand(?:s|ed|ing)? over|receiv(?:e|es|ed|ing))\b)/i],
    ['touch', /(?:触碰|抚摸|按住|捏住|揉|摸|\b(?:touch(?:es|ed|ing)?|caress(?:es|ed|ing)?|press(?:es|ed|ing)?|stroke(?:s|d|ing)?)\b)/i],
    ['grab', /(?:抓住|握住|握紧|拿着|攥住|揪住|扯住|\b(?:grab(?:s|bed|bing)?|grip(?:s|ped|ping)?|clutch(?:es|ed|ing)?|hold(?:s|ing)?)\b)/i],
    ['embrace', /(?:拥抱|抱住|搂住|扑进.{0,8}怀|\b(?:embrac(?:e|es|ed|ing)|hug(?:s|ged|ging)?|hold(?:s|ing)? .*close)\b)/i],
    ['kiss', /(?:亲吻|吻住|接吻|\b(?:kiss(?:es|ed|ing)?)\b)/i],
    ['run', /(?:奔跑|冲向|扑向|追逐|逃跑|\b(?:run(?:s|ning)?|rush(?:es|ed|ing)?|chase(?:s|d|ing)?|flee(?:s|ing)?)\b)/i],
    ['attack', /(?:攻击|挥剑|劈下|刺向|开枪|射击|施法|扑杀|\b(?:attack(?:s|ed|ing)?|swing(?:s|ing)? .*sword|stab(?:s|bed|bing)?|shoot(?:s|ing)?|cast(?:s|ing)? .*spell)\b)/i],
    ['defend', /(?:挡住|保护|护在|格挡|闪避|\b(?:defend(?:s|ed|ing)?|protect(?:s|ed|ing)?|shield(?:s|ed|ing)?|block(?:s|ed|ing)?|dodge(?:s|d|ing)?)\b)/i],
    ['fall', /(?:倒下|跌倒|跪下|坠落|摔|\b(?:fall(?:s|ing)?|fell|collapse(?:s|d|ing)?|kneel(?:s|ed|ing)?)\b)/i],
    ['rise', /(?:站起|起身|跃起|\b(?:stand(?:s|ing)? up|rise(?:s|n|ing)?|jump(?:s|ed|ing)?)\b)/i],
    ['reveal', /(?:揭开|显露|暴露|裂开|打开|发现|\b(?:reveal(?:s|ed|ing)?|expose(?:s|d|ing)?|open(?:s|ed|ing)?|discover(?:s|ed|ing)?)\b)/i],
    ['outfit_change', /(?:换上|换下|脱下|解开|撕开|衣.{0,4}(?:滑落|散开)|裸体|赤裸|\b(?:change[sd]? into|remove[sd]? .*clothes|undress(?:es|ed|ing)?|unbutton(?:s|ed|ing)?|nude|naked)\b)/i],
    ['erotic_touch', /(?:爱抚|挑逗|揉弄|抚弄|摩挲|刺激|\b(?:fondl(?:e|es|ed|ing)|grope(?:s|d|ing)?|teas(?:e|es|ed|ing)|erotic touch|stimul(?:ate|ates|ated|ating))\b)/i],
    ['manual_stimulation', /(?:手交|指交|手指进入|用手刺激|用手取悦|手部互动|\b(?:handjob|fingering|finger(?:s|ed|ing)? (?:her|his) (?:pussy|vagina|genitals)|manual stimulation|hand stimulation)\b)/i],
    ['oral_sex', /(?:口交|口部互动|用嘴取悦|俯身含住|舔舐.{0,8}(?:阴茎|阴蒂|阴部)|含住.{0,8}(?:阴茎|乳头)|\b(?:oral sex|oral interaction|fellatio|cunnilingus|blowjob|using (?:her|his) mouth|lick(?:s|ed|ing)? (?:her|his) (?:pussy|clit|cock|genitals))\b)/i],
    ['penetration', /(?:进入她|进入他|进入体内|插入|贯入|结合|\b(?:penetrat(?:e|es|ed|ing|ion)|vaginal sex|anal sex|cock inside|inside (?:her|him))\b)/i],
    ['thrusting', /(?:抽插|抽送|律动|挺动|\b(?:thrust(?:s|ed|ing)?|piston(?:s|ed|ing)?|rhythmic sex)\b)/i],
    ['position_change', /(?:换了?体位|改变体位|翻身压住|骑到.{0,8}身上|转为.{0,8}体位|\b(?:position change|changes? position|switch(?:es|ed|ing)? position|roll(?:s|ed|ing)? (?:her|him) over|mount(?:s|ed|ing)?|riding position)\b)/i],
    ['climax', /(?:高潮|达到顶点|失神|痉挛|颤栗|\b(?:climax(?:es|ed|ing)?|orgasm(?:s|ed|ing)?|coming|ecstasy)\b)/i],
    ['ejaculation', /(?:射精|射入|射在|精液|\b(?:ejaculat(?:e|es|ed|ing|ion)|cum(?:s|ming)?|creampie|semen)\b)/i],
    ['aftercare', /(?:事后|余韵|清理身体|擦拭身体|相拥休息|依偎着休息|\b(?:aftercare|afterglow|clean(?:s|ed|ing)? (?:her|him) up|rest(?:s|ed|ing)? together|cuddl(?:e|es|ed|ing)? afterward)\b)/i],
];

const ACTION_SALIENCE = Object.freeze({
    enter: 3, leave: 4, turn: 1, reach: 2, touch: 3, grab: 4, embrace: 5, kiss: 6,
    run: 6, attack: 7, defend: 7, fall: 6, rise: 4, reveal: 5, outfit_change: 6,
    erotic_touch: 5, manual_stimulation: 7, oral_sex: 8, penetration: 9, thrusting: 6,
    position_change: 9, climax: 10, ejaculation: 10, aftercare: 4,
});
const ADULT_ACTIONS = new Set(['erotic_touch', 'manual_stimulation', 'oral_sex', 'penetration', 'thrusting', 'position_change', 'climax', 'ejaculation', 'aftercare']);
const EXPLICIT_NO_FEMALE_STORY_RE = /(?:男人.{0,12}(?:独自|单独)|(?:独自|单独).{0,12}男人|只有.{0,8}(?:男人|男性|男主)|无人(?:的|出现|在场)?|空无一人|纯场景|空镜|\b(?:man alone|male alone|only (?:a )?man|no (?:woman|women|girl|girls|people)|empty scene|scenery only)\b)/i;

export function normalizeLineEndings(value = '') {
    return String(value).replace(/\r\n?/g, '\n');
}

export function parseDeclaredImageCount(text = '') {
    const matches = [...normalizeLineEndings(text).matchAll(COUNT_RE)];
    if (!matches.length) return { count: null, matches: [] };
    return {
        count: Number(matches[matches.length - 1][1]),
        matches: matches.map(match => ({ count: Number(match[1]), index: match.index, raw: match[0] })),
    };
}

export function splitTags(prompt = '') {
    return String(prompt)
        .replace(/^\s*\[|\]\s*$/g, '')
        .replace(/[，、；;]/g, ',')
        .split(/,|\n/)
        .map(tag => tag.trim().replace(/\s+/g, ' '))
        .filter(Boolean);
}

export function isLikelyImagePrompt(content = '') {
    const value = String(content).trim();
    if (!value || /\]\s*\(/.test(value)) return false;
    // Zhihuiji treats every configured bracket pair as an image tag. Variable
    // update payloads also use JSON arrays, so reject their object bodies before
    // applying the looser tag-count heuristic below.
    if (/^[\[{]/.test(value)
        || /"(?:op|path|value|from)"\s*:/i.test(value)
        || /<\/?(?:JSONPatch|UpdateVariable)\b/i.test(value)) return false;
    const tags = splitTags(value);
    if (tags.length < 3) return false;
    const commaCount = (value.match(/,/g) || []).length;
    if (commaCount < 2) return false;
    if (VISUAL_TOKEN_RE.test(value)) return true;
    return tags.length >= 6;
}

export function paragraphRanges(text = '') {
    const source = normalizeLineEndings(text);
    const ranges = [];
    const regex = /(?:^|\n{2,})([^\n](?:[\s\S]*?))(?=\n{2,}|$)/g;
    let match;
    while ((match = regex.exec(source))) {
        const raw = match[1];
        const start = match.index + match[0].indexOf(raw);
        ranges.push({ index: ranges.length, start, end: start + raw.length, text: raw });
    }
    return ranges;
}

export function storyParagraphCandidates(text = '') {
    const source = normalizeLineEndings(text);
    const hiddenRanges = [...source.matchAll(HIDDEN_REASONING_BLOCK_RE)].map(match => ({ start: match.index, end: match.index + match[0].length }));
    return paragraphRanges(source).flatMap(item => {
        const raw = item.text.trim();
        if (!raw || /^<!--\s*IMG_COUNT/i.test(raw)) return [];
        if (hiddenRanges.some(range => item.start >= range.start && item.end <= range.end)) return [];
        if (/^```|<(?:UpdateVariable|initvar|StatusPlaceHolderImpl|imgthink|image|details|head|style|script|iframe|status|think|thinking|analysis|reasoning|planning|scratchpad)\b/i.test(raw)) return [];
        if (raw.length > 4000 || extractImagePrompts(raw).length) return [];
        const visible = raw
            .replace(/<[^>]+>/g, ' ')
            .replace(/&(?:nbsp|lt|gt|amp|quot);/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (STORY_META_RE.test(visible)) return [];
        if (visible.length < 8 || (!CJK_RE.test(visible) && !/[A-Za-z]{4}/.test(visible))) return [];
        return [{ ...item, text: visible }];
    });
}

export function hasVisibleFemaleStoryBeat(text = '') {
    const story = storyParagraphCandidates(text).map(item => item.text).join('\n');
    return VISIBLE_FEMALE_STORY_RE.test(story);
}

export function isExplicitNoFemaleStory(text = '') {
    const story = storyParagraphCandidates(text).map(item => item.text).join('\n');
    return EXPLICIT_NO_FEMALE_STORY_RE.test(story);
}

export function storyActionTypes(text = '') {
    const value = String(text);
    return ACTION_PATTERNS.filter(([name, pattern]) => {
        if (!pattern.test(value)) return false;
        if (name === 'position_change' && /(?:没有|并未|未曾|不再).{0,5}(?:改变|更换|切换).{0,3}体位|(?:same|unchanged) position|without changing position/i.test(value)) return false;
        return true;
    }).map(([name]) => name);
}

export function storyActionPhase(actions = []) {
    const set = new Set(Array.isArray(actions) ? actions : storyActionTypes(actions));
    if (set.has('aftercare')) return 'aftercare';
    if (set.has('climax') || set.has('ejaculation')) return 'climax';
    if (set.has('position_change')) return 'position_change';
    if (set.has('penetration') || set.has('thrusting')) return 'penetration';
    if (set.has('oral_sex')) return 'oral_sex';
    if (set.has('manual_stimulation')) return 'manual_stimulation';
    if (set.has('erotic_touch')) return 'erotic_touch';
    if (set.has('outfit_change')) return 'outfit_change';
    return [...set].sort((a, b) => (ACTION_SALIENCE[b] || 0) - (ACTION_SALIENCE[a] || 0))[0] || 'reaction';
}

function beatActionScore(actions = []) {
    const ranked = actions.map(action => ACTION_SALIENCE[action] || 1).sort((a, b) => b - a);
    return (ranked[0] || 0) + Math.min(2, Math.max(0, ranked.length - 1));
}

export function storyBeatGroups(text = '', options = {}) {
    const candidates = storyParagraphCandidates(text);
    const assumeFemale = Boolean(options.assumeFemale);
    let lastFemaleOrder = -99;
    const analyzed = candidates.map((item, order) => {
        const directFemale = VISIBLE_FEMALE_STORY_RE.test(item.text);
        if (directFemale) lastFemaleOrder = order;
        const actions = storyActionTypes(item.text);
        const transition = STORY_TRANSITION_RE.test(item.text);
        const emotion = STORY_EMOTION_RE.test(item.text);
        const result = STORY_RESULT_RE.test(item.text);
        const femaleContext = directFemale || assumeFemale || order - lastFemaleOrder <= 2;
        const actionPhase = storyActionPhase(actions);
        const score = (directFemale ? 4 : femaleContext ? 1 : 0)
            + beatActionScore(actions)
            + (transition ? 1 : 0)
            + (emotion ? 2 : 0)
            + (result ? 3 : 0)
            + (item.text.length >= 24 ? 1 : 0);
        return { ...item, order, directFemale, femaleContext, actions, actionPhase, transition, emotion, result, score };
    });

    const eligible = analyzed.filter(item => item.femaleContext && (item.directFemale || item.actions.length || item.transition || item.emotion));
    const groups = [];
    for (const beat of eligible) {
        const group = groups.at(-1);
        const previousBeat = group?.beats.at(-1);
        const sharedAction = previousBeat && beat.actions.some(action => previousBeat.actions.includes(action));
        const sameActionPhase = previousBeat && beat.actionPhase === previousBeat.actionPhase;
        const adultStageChanged = Boolean(previousBeat
            && (ADULT_ACTIONS.has(previousBeat.actionPhase) || ADULT_ACTIONS.has(beat.actionPhase))
            && !sameActionPhase);
        const bridgeBeats = previousBeat
            ? analyzed.filter(item => item.order > previousBeat.order && item.order < beat.order)
            : [];
        const continuousBridge = bridgeBeats.length > 0 && bridgeBeats.every(item =>
            !item.transition
            && !item.emotion
            && CONTINUOUS_BEAT_RE.test(item.text)
            && (!item.actions.length || item.actions.some(action => group.actions.includes(action))));
        const sameContinuousAction = Boolean(group && previousBeat
            && (beat.order - previousBeat.order <= 1 || continuousBridge)
            && !beat.transition
            && !adultStageChanged
            && (CONTINUOUS_BEAT_RE.test(beat.text) || (sharedAction && sameActionPhase) || (!beat.actions.length && !beat.emotion && !beat.result)));
        if (sameContinuousAction) {
            group.beats.push(beat);
            group.paragraphIndexes.push(beat.index);
            group.score = Math.max(group.score, beat.score);
            group.actions = [...new Set([...group.actions, ...beat.actions])];
            group.transition ||= beat.transition;
            group.emotion ||= beat.emotion;
            group.result ||= beat.result;
            group.endOrder = beat.order;
            group.text += `\n\n${beat.text}`;
            if (beat.score >= group.winnerBeat.score) group.winnerBeat = beat;
            continue;
        }
        groups.push({
            index: groups.length,
            beats: [beat],
            paragraphIndexes: [beat.index],
            startOrder: beat.order,
            endOrder: beat.order,
            score: beat.score,
            actions: [...beat.actions],
            actionPhase: beat.actionPhase,
            transition: beat.transition,
            emotion: beat.emotion,
            result: beat.result,
            winnerBeat: beat,
            text: beat.text,
        });
    }
    return { candidates: analyzed, groups };
}

export function planStoryboardSlots(text = '', options = {}) {
    const preferred = Math.max(1, Math.min(6, Number(options.preferred ?? options.minimum ?? 3) || 3));
    const maximum = Math.max(1, Math.min(6, Number(options.maximum ?? 6) || 6));
    const { candidates, groups } = storyBeatGroups(text, options);
    if (!groups.length) return { targetCount: 0, candidates, groups, slots: [] };

    let targetCount = Math.min(preferred, groups.length, maximum);
    const decisiveGroups = groups.filter(group => group.score >= 7 || group.transition || group.actions.some(action => !['turn'].includes(action))).length;
    if (groups.length >= 4 && decisiveGroups >= 4) targetCount = Math.max(targetCount, 4);
    const adultStageGroups = groups.filter(group => ADULT_ACTIONS.has(group.actionPhase)).length;
    if (groups.length >= 5 && decisiveGroups >= 5 && (groups.filter(group => group.transition).length >= 2 || adultStageGroups >= 4)) targetCount = Math.max(targetCount, 5);
    if (groups.length >= 6 && decisiveGroups >= 6 && (groups.filter(group => group.transition).length >= 4 || adultStageGroups >= 5)) targetCount = Math.max(targetCount, 6);
    targetCount = Math.min(targetCount, groups.length, maximum);

    const chosen = [];
    for (let slotIndex = 0; slotIndex < targetCount; slotIndex++) {
        const start = Math.floor(slotIndex * groups.length / targetCount);
        const end = Math.max(start + 1, Math.floor((slotIndex + 1) * groups.length / targetCount));
        const bucket = groups.slice(start, end);
        const ranked = bucket.map((group, offset) => ({ group, offset })).sort((a, b) => {
            if (b.group.score !== a.group.score) return b.group.score - a.group.score;
            return slotIndex === targetCount - 1 ? b.offset - a.offset : a.offset - b.offset;
        });
        chosen.push(ranked[0].group);
    }

    const slots = chosen.map((group, slotIndex) => {
        const previousEndOrder = slotIndex ? chosen[slotIndex - 1].endOrder : -1;
        const window = candidates.filter(item => item.order > previousEndOrder && item.order <= group.endOrder);
        const insertionParagraphIndex = group.paragraphIndexes.at(-1);
        return {
            slotIndex,
            phase: targetCount === 1 ? 'whole' : slotIndex === 0 ? 'opening' : slotIndex === targetCount - 1 ? 'ending' : 'middle',
            groupIndex: group.index,
            score: group.score,
            actions: group.actions,
            actionPhase: group.actionPhase,
            eventKey: `${group.index}:${group.actionPhase}:${group.winnerBeat.index}`,
            paragraphIndexes: [insertionParagraphIndex],
            sourceParagraphIndexes: [...group.paragraphIndexes],
            anchorOrder: group.endOrder,
            windowParagraphIndexes: window.map(item => item.index),
            windowText: window.map(item => item.text).join('\n\n'),
            selectedBeatText: group.winnerBeat.text,
            selectedBeatParagraphIndex: group.winnerBeat.index,
            eventLedger: window.map(item => ({
                paragraph_index: item.index,
                action_phase: item.actionPhase,
                actions: item.actions,
                salience_score: item.score,
                has_result_change: item.result,
                text: item.text,
            })),
        };
    });
    return { targetCount, candidates, groups, slots };
}

function decisivePromptActionSignature(prompt = '') {
    return storyActionTypes(prompt).filter(action => !['turn', 'reveal'].includes(action)).sort().join('|');
}

export function analyzeStoryboardCoverage(text = '', suppliedPrompts = null, options = {}) {
    const prompts = Array.isArray(suppliedPrompts) ? suppliedPrompts : extractImagePrompts(text);
    const plan = options.plan || planStoryboardSlots(text, options);
    const issues = [];
    if (prompts.length !== plan.targetCount) {
        issues.push({ code: 'storyboard_count_mismatch', severity: 'error', message: `独立剧情 beat 需要 ${plan.targetCount} 张，当前为 ${prompts.length} 张` });
    }

    const anchors = prompts.map(prompt => {
        const preceding = plan.candidates.filter(item => item.end <= prompt.start);
        const candidate = preceding.at(-1) || null;
        const group = candidate ? [...plan.groups].reverse().find(item => item.startOrder <= candidate.order) || null : null;
        return { promptIndex: prompt.index, candidateOrder: candidate?.order ?? -1, paragraphIndex: candidate?.index ?? -1, groupIndex: group?.index ?? -1 };
    });
    const occupiedGroups = new Map();
    for (const anchor of anchors) {
        if (anchor.groupIndex < 0) continue;
        if (occupiedGroups.has(anchor.groupIndex)) {
            issues.push({ code: 'repeated_continuous_beat', severity: 'error', promptIndex: anchor.promptIndex, message: `与第 ${occupiedGroups.get(anchor.groupIndex) + 1} 张属于同一持续动作，必须合并为一张` });
        } else occupiedGroups.set(anchor.groupIndex, anchor.promptIndex);
    }

    const actionOwners = new Map();
    for (const prompt of prompts) {
        const signature = decisivePromptActionSignature(prompt.prompt);
        if (!signature) continue;
        if (actionOwners.has(signature)) {
            issues.push({ code: 'near_duplicate_action', severity: 'error', promptIndex: prompt.index, message: `与第 ${actionOwners.get(signature) + 1} 张的核心动作重复` });
        } else actionOwners.set(signature, prompt.index);
    }

    if (anchors.length >= 2 && plan.slots.length >= 2) {
        const lastActual = anchors.at(-1)?.candidateOrder ?? -1;
        const lastPlanned = plan.slots.at(-1)?.anchorOrder ?? -1;
        const total = Math.max(1, plan.candidates.length - 1);
        if (lastPlanned / total >= 0.62 && lastPlanned - lastActual >= 2) {
            issues.push({ code: 'uncovered_late_beat', severity: 'error', message: '后半段存在新的女性动作/转折，但最后一个按钮出现得过早' });
        }
        if (anchors.length >= 3 && lastActual / total < 0.58) {
            issues.push({ code: 'front_loaded_storyboard', severity: 'error', message: '按钮集中在回复前半段，后半段没有覆盖' });
        }
    }
    return { ...plan, prompts, anchors, issues, needsReflow: issues.some(issue => issue.severity === 'error') };
}

export function desiredImageCount(text = '', options = {}) {
    return planStoryboardSlots(text, { preferred: options.preferred ?? options.minimum ?? 3, maximum: options.maximum ?? 6 }).targetCount;
}

export function extractImagePrompts(text = '') {
    const source = normalizeLineEndings(text);
    const paragraphs = paragraphRanges(source);
    const found = [];
    const lineRe = /(^|\n)([ \t]*\[([^\]\n]+)\][ \t]*)(?=\n|$)/g;
    let match;
    while ((match = lineRe.exec(source))) {
        const content = match[3].trim();
        if (!isLikelyImagePrompt(content)) continue;
        const start = match.index + match[1].length;
        const paragraph = paragraphs.find(item => start >= item.start && start <= item.end);
        found.push({
            index: found.length,
            start,
            end: start + match[2].length,
            raw: match[2],
            prompt: content,
            tags: splitTags(content),
            paragraphIndex: paragraph?.index ?? -1,
        });
    }
    return found;
}

export function storySegmentsForPrompts(text = '', suppliedPrompts = null) {
    const source = normalizeLineEndings(text);
    const prompts = Array.isArray(suppliedPrompts) ? suppliedPrompts : extractImagePrompts(source);
    // Segment ownership is structural, so even a short but meaningful beat such
    // as “她笑了。” counts as new story. The stricter fallback candidate filter
    // intentionally ignores such short lines, but continuity validation must not.
    const candidates = paragraphRanges(source).filter(item => {
        const raw = item.text.trim();
        if (!raw || /^<!--\s*IMG_COUNT/i.test(raw)) return false;
        if (/^```|<(?:UpdateVariable|details|head|style|script|iframe|status)\b/i.test(raw)) return false;
        if (extractImagePrompts(raw).length) return false;
        const visible = raw.replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|lt|gt|amp|quot);/gi, ' ').replace(/\s+/g, ' ').trim();
        return visible.length >= 2 && (CJK_RE.test(visible) || /[A-Za-z]{2}/.test(visible));
    });
    return prompts.map((prompt, index) => {
        const previousPromptEnd = index > 0 ? prompts[index - 1].end : 0;
        const paragraphs = candidates.filter(item => item.start >= previousPromptEnd && item.end <= prompt.start);
        return {
            promptIndex: prompt.index,
            previousPromptEnd,
            promptStart: prompt.start,
            fromParagraphIndex: paragraphs[0]?.index ?? null,
            toParagraphIndex: paragraphs.at(-1)?.index ?? null,
            paragraphs,
            text: paragraphs.map(item => item.text).join('\n\n'),
        };
    });
}

function canonicalPrompt(prompt) {
    return splitTags(prompt).map(tag => tag.toLowerCase()).sort().join('|');
}

function arePromptsPiledAtEnd(text, prompts) {
    if (prompts.length < 2) return false;
    const paragraphs = paragraphRanges(text).filter(item => !/^<!--\s*IMG_COUNT/i.test(item.text.trim()));
    const promptParagraphs = new Set(prompts.map(prompt => prompt.paragraphIndex));
    const meaningful = paragraphs.filter(item => item.text.trim());
    const final = meaningful.slice(-prompts.length);
    return final.length === prompts.length && final.every(item => promptParagraphs.has(item.index));
}

export function validateTurn(text = '', options = {}) {
    const source = normalizeLineEndings(text);
    const declaration = parseDeclaredImageCount(source);
    const prompts = extractImagePrompts(source);
    const issues = [];
    if (declaration.count === null) issues.push({ code: 'missing_count', severity: 'warning', message: '未发现 IMG_COUNT 标记' });
    if (declaration.matches.length > 1) issues.push({ code: 'multiple_count', severity: 'warning', message: '存在多个 IMG_COUNT 标记' });
    if (declaration.count !== null && declaration.count !== prompts.length) {
        issues.push({ code: 'count_mismatch', severity: 'error', message: `应有 ${declaration.count} 张，实际 ${prompts.length} 张` });
    }
    if (arePromptsPiledAtEnd(source, prompts)) issues.push({ code: 'piled_at_end', severity: 'warning', message: '多个 prompt 集中堆在回复末尾' });

    const storySegments = storySegmentsForPrompts(source, prompts);
    const seen = new Map();
    for (const prompt of prompts) {
        const local = [];
        if (CJK_RE.test(prompt.prompt)) local.push({ code: 'contains_chinese', severity: 'error', message: 'prompt 含中文' });
        if (SENTENCE_RE.test(prompt.prompt) || /[.!?]\s+[A-Z][a-z]+\s/.test(prompt.prompt)) {
            local.push({ code: 'prose_sentence', severity: 'warning', message: 'prompt 像英文剧情长句' });
        }
        if (prompt.prompt.length > Number(options.maxPromptChars || 650)) local.push({ code: 'too_long', severity: 'warning', message: 'prompt 过长' });
        const lower = prompt.tags.map(tag => tag.toLowerCase());
        const has1Girl = lower.includes('1girl');
        const has2Girls = lower.includes('2girls');
        const hasSolo = lower.includes('solo');
        const hasDuo = lower.includes('duo');
        if ((has1Girl && has2Girls) || (hasSolo && (has2Girls || hasDuo))) {
            local.push({ code: 'people_conflict', severity: 'error', message: '人数标签冲突' });
        }
        if ((hasSolo || has1Girl) && SOLO_RELATION_RE.test(prompt.prompt)) {
            local.push({ code: 'solo_relation_conflict', severity: 'error', message: 'solo/单人标签与第二人物互动冲突' });
        }
        if (!FEMALE_SUBJECT_RE.test(prompt.prompt)) {
            local.push({ code: 'female_subject_missing', severity: 'error', message: 'Galgame 图片必须有剧情中真实出现的女性，禁止纯男性或纯场景图' });
        }
        if (!storySegments[prompt.index]?.paragraphs.length) {
            local.push({ code: 'empty_story_segment', severity: 'error', message: '该图片与上一张图片之间没有新的剧情段落' });
        }
        if (!CINEMATIC_BEAT_RE.test(prompt.prompt)) {
            local.push({ code: 'weak_visual_beat', severity: 'warning', message: 'Prompt 缺少明确动作或强表情，可能不是本段最有画面感的镜头' });
        }
        local.push(...identityAnchorIssues(prompt.prompt));
        const key = canonicalPrompt(prompt.prompt);
        if (seen.has(key)) local.push({ code: 'duplicate_prompt', severity: 'error', message: `与第 ${seen.get(key) + 1} 个 prompt 重复` });
        else seen.set(key, prompt.index);
        prompt.issues = local;
        issues.push(...local.map(issue => ({ ...issue, promptIndex: prompt.index })));
    }

    return {
        declaredImageCount: declaration.count,
        detectedPromptCount: prompts.length,
        prompts,
        issues,
        ok: issues.every(issue => issue.severity !== 'error') && declaration.count !== null,
    };
}

export function reinforcePromptLocal(prompt = '') {
    const originalTags = splitTags(prompt);
    const tags = [];
    const seen = new Set();
    for (const rawTag of originalTags) {
        const tag = rawTag.replace(/^\[+|\]+$/g, '').trim();
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        tags.push(tag);
    }
    const nativeQualityKeys = new Set(ANIMA_NATIVE_QUALITY_TAGS.map(tag => tag.toLowerCase()));
    const safetyKeys = new Set(ANIMA_SAFETY_TAGS);
    const obsoleteQualityKeys = new Set(['amazing quality', 'very aesthetic', 'high resolution', 'absurdres', 'year 2025']);
    const normalizedSafety = tags.map(tag => tag.toLowerCase().replace(/^rating[: ]+/, '')).find(tag => safetyKeys.has(tag));
    const promptText = tags.join(', ').toLowerCase();
    const contentSafety = /\b(?:vaginal|anal|fellatio|cunnilingus|blowjob|paizuri|handjob|footjob|sex|penetration|manual stimulation|oral interaction|orgasm|ejaculation|penis|pussy|cum)\b/.test(promptText) ? 'explicit'
            : /\b(?:nude|naked|nipples|topless|bottomless|bare breasts|exposed breasts|nsfw)\b/.test(promptText) ? 'nsfw'
                : /\b(?:lingerie|underwear|panties|bra|cleavage|breast focus|suggestive)\b/.test(promptText) ? 'sensitive'
                    : 'safe';
    const inferredSafety = contentSafety !== 'safe' ? contentSafety : (normalizedSafety || 'safe');
    const contentTags = tags.filter(tag => {
        const key = tag.toLowerCase().replace(/^rating[: ]+/, '');
        return !nativeQualityKeys.has(key) && !obsoleteQualityKeys.has(key) && !safetyKeys.has(key) && key !== 'sfw';
    });
    tags.length = 0;
    tags.push(...ANIMA_NATIVE_QUALITY_TAGS, inferredSafety, ...contentTags);
    let lower = tags.map(tag => tag.toLowerCase());
    const relationText = tags.join(', ');
    const hasMaleProtagonistRelation = FEMALE_SUBJECT_RE.test(relationText)
        && /\b(?:male protagonist|the protagonist|protagonist(?:'s)?|pov male)\b/i.test(relationText)
        && !lower.some(tag => /^(?:[2-6]girls?|2girls and 1boy)$/.test(tag));
    if (hasMaleProtagonistRelation) {
        for (let index = tags.length - 1; index >= 0; index--) {
            if (/^(?:1girl|solo)$/i.test(tags[index])) tags.splice(index, 1);
        }
        let countIndex = tags.findIndex(tag => /^1girl and 1boy$/i.test(tag));
        if (countIndex < 0) {
            countIndex = ANIMA_NATIVE_QUALITY_TAGS.length + 1;
            tags.splice(countIndex, 0, '1girl and 1boy');
        }
        const updatedText = tags.join(', ');
        if (!/\bmale protagonist (?:torso|hand|arm|body|partly visible)\b/i.test(updatedText)) {
            const visibility = /\b(?:chest|torso|badge|crest|emblem)\b/i.test(updatedText)
                ? 'male protagonist torso partly visible'
                : /\b(?:hand|wrist|palm|finger)\b/i.test(updatedText)
                    ? 'male protagonist hand and forearm visible'
                    : 'male protagonist partly visible';
            tags.splice(countIndex + 1, 0, visibility);
        }
        lower = tags.map(tag => tag.toLowerCase());
    } else if (lower.includes('1girl') && !lower.includes('2girls') && !lower.includes('solo')) {
        const at = tags.findIndex(tag => tag.toLowerCase() === '1girl');
        tags.splice(at + 1, 0, 'solo');
    }
    if (FEMALE_SUBJECT_RE.test(tags.join(', ')) && !tags.some(tag => tag.toLowerCase() === 'female focus')) {
        const at = tags.findIndex(tag => /\b(?:[1-6]girls?|adult women?|women?)\b/i.test(tag));
        const afterCountAndSolo = tags[at + 1]?.toLowerCase() === 'solo' ? at + 2 : at + 1;
        tags.splice(Math.max(0, afterCountAndSolo), 0, 'female focus');
    }
    const compositionRe = /\b(?:shot|framing|composition|close-up|upper body|full body|cowboy shot)\b/i;
    if (!tags.some(tag => compositionRe.test(tag))) tags.push('tight composition', 'subject fills most of the frame');
    return `[${tags.join(', ')}]`;
}

export function replacePromptAt(text, promptRecord, replacement) {
    const source = normalizeLineEndings(text);
    const wrapped = String(replacement).trim().startsWith('[') ? String(replacement).trim() : `[${String(replacement).trim()}]`;
    return source.slice(0, promptRecord.start) + wrapped + source.slice(promptRecord.end);
}

export function insertPromptAfterParagraph(text, paragraphIndex, prompt) {
    const source = normalizeLineEndings(text);
    const paragraphs = paragraphRanges(source);
    const target = paragraphs[Number(paragraphIndex)];
    if (!target) throw new Error(`段落 ${paragraphIndex} 不存在`);
    const wrapped = String(prompt).trim().startsWith('[') ? String(prompt).trim() : `[${String(prompt).trim()}]`;
    return source.slice(0, target.end) + `\n\n${wrapped}` + source.slice(target.end);
}

export function applyMissingPrompts(text, missingPrompts = []) {
    const ordered = [...missingPrompts].sort((a, b) => Number(b.after_paragraph_index) - Number(a.after_paragraph_index));
    let result = normalizeLineEndings(text);
    for (const item of ordered) {
        if (!Array.isArray(item.prompt_tags) || !item.prompt_tags.length) throw new Error('missing prompt_tags');
        result = insertPromptAfterParagraph(result, Number(item.after_paragraph_index), reinforcePromptLocal(item.prompt_tags.join(', ')));
    }
    return result;
}

export function replaceStoryboardPrompts(text, storyboardPrompts = []) {
    const source = normalizeLineEndings(text);
    const paragraphs = paragraphRanges(source);
    const operations = [];
    for (const prompt of extractImagePrompts(source)) operations.push({ start: prompt.start, end: prompt.end, value: '' });
    for (const marker of parseDeclaredImageCount(source).matches) {
        operations.push({ start: marker.index, end: marker.index + marker.raw.length, value: '' });
    }
    for (const item of storyboardPrompts) {
        const target = paragraphs[Number(item.after_paragraph_index)];
        if (!target) throw new Error(`分镜段落 ${item.after_paragraph_index} 不存在`);
        const rawPrompt = Array.isArray(item.prompt_tags) ? item.prompt_tags.join(', ') : String(item.prompt || '');
        const wrapped = rawPrompt.trim().startsWith('[') ? rawPrompt.trim() : `[${rawPrompt.trim()}]`;
        if (!isLikelyImagePrompt(wrapped.slice(1, -1))) throw new Error('分镜 Prompt 格式无效');
        operations.push({ start: target.end, end: target.end, value: `\n\n${wrapped}` });
    }
    let result = source;
    operations.sort((a, b) => b.start - a.start || b.end - a.end).forEach(operation => {
        result = result.slice(0, operation.start) + operation.value + result.slice(operation.end);
    });
    return `${result.trimEnd()}\n\n<!--IMG_COUNT:${Math.max(0, Math.min(6, storyboardPrompts.length))}-->`;
}

export function surroundingParagraphs(text, paragraphIndex) {
    const paragraphs = paragraphRanges(text);
    const index = Math.max(0, Math.min(paragraphs.length - 1, Number(paragraphIndex)));
    return {
        before: paragraphs[index - 1]?.text || '',
        current: paragraphs[index]?.text || '',
        after: paragraphs[index + 1]?.text || '',
        paragraphIndex: index,
    };
}

export function stableHash(value = '') {
    let hash = 0x811c9dc5;
    const text = String(value);
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function makeCacheKey({ messageId, messageContent = '', originalPrompt = '', repairMode = '' }) {
    return [messageId, stableHash(messageContent), stableHash(originalPrompt), repairMode].join(':');
}

export function parseStrictJson(text = '') {
    const value = String(text).trim();
    if (!value) throw new Error('AI 未返回可解析 JSON');

    try {
        const direct = JSON.parse(value);
        if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
    } catch {
        // Some otherwise compatible models wrap JSON in Markdown or short reasoning text.
    }

    for (let start = value.indexOf('{'); start >= 0; start = value.indexOf('{', start + 1)) {
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < value.length; index++) {
            const character = value[index];
            if (inString) {
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === '"') inString = false;
                continue;
            }
            if (character === '"') {
                inString = true;
                continue;
            }
            if (character === '{') depth++;
            if (character !== '}') continue;
            depth--;
            if (depth !== 0) continue;
            try {
                const candidate = JSON.parse(value.slice(start, index + 1));
                if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate;
            } catch {
                break;
            }
        }
    }
    throw new Error('AI 未返回可解析 JSON');
}

export function assertPromptRepairResponse(payload) {
    if (!payload || !Array.isArray(payload.prompt_tags) || !payload.prompt_tags.length) throw new Error('AI 响应缺少 prompt_tags');
    if (payload.prompt_tags.some(tag => typeof tag !== 'string' || !tag.trim())) throw new Error('prompt_tags 格式错误');
    return {
        prompt_tags: payload.prompt_tags.map(tag => tag.trim()),
        negative_tags: Array.isArray(payload.negative_tags) ? payload.negative_tags.filter(tag => typeof tag === 'string').map(tag => tag.trim()) : [],
        changes: Array.isArray(payload.changes) ? payload.changes.filter(change => typeof change === 'string') : [],
        confidence: Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : null,
    };
}

export function assertWholeTurnResponse(payload) {
    if (!payload || !Array.isArray(payload.missing_prompts)) throw new Error('AI 响应缺少 missing_prompts');
    for (const item of payload.missing_prompts) {
        if (!Number.isInteger(Number(item.after_paragraph_index)) || !Array.isArray(item.prompt_tags) || !item.prompt_tags.length) {
            throw new Error('missing_prompts 格式错误');
        }
    }
    return payload;
}

export function findSelectedParagraph(text, selectedText) {
    const source = normalizeLineEndings(text);
    const selection = normalizeLineEndings(selectedText).trim();
    if (!selection) return -1;
    const offset = source.indexOf(selection);
    if (offset < 0) return -1;
    return paragraphRanges(source).find(item => offset >= item.start && offset <= item.end)?.index ?? -1;
}
