import { splitStoryParagraphs } from './scene-anchor.mjs';

const SCHOOL_RE = /(?:学院|学校|校园|教室|校服|学生制服|school|academy|classroom|school uniform|student uniform)/i;
const ANCIENT_RE = /(?:古代|江湖|武林|修仙|仙门|师姐|师妹|师父|夫人|公子|小姐|木剑|真剑|剑法|古琴|亭|竹林|hanfu|wuxia|xianxia|ancient china)/i;
const MODERN_RE = /(?:现代|都市|办公室|手机|汽车|西装|衬衫|连衣裙|office|city|smartphone|car|suit|shirt|dress)/i;
const OUTFIT_RE = /(?:穿着|身穿|换上|披着|裹着|着一袭|衣着|服饰|裙|袍|衫|衣|甲|盔|制服|校服|斗篷|披风|长靴|鞋|内衣|裸体|赤裸|nude|naked|wearing|dressed in|outfit|uniform|robe|hanfu|dress|skirt|shirt|coat|armor|lingerie)/i;
const APPEARANCE_RE = /(?:长发|短发|黑发|白发|银发|金发|棕发|红发|蓝发|绿发|粉发|紫发|眼睛|眼眸|瞳|肤色|身材|脸|面容|发色|发型|hair|eyes|skin|face|appearance)/i;

function clean(value = '', max = 1800) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function unique(values) {
    const result = [];
    const seen = new Set();
    for (const raw of values.flatMap(value => String(value || '').split(/[,，]\s*/))) {
        const item = clean(raw, 300);
        const key = item.toLowerCase();
        if (!item || seen.has(key)) continue;
        seen.add(key);
        result.push(item);
    }
    return result;
}

function paragraphWindow(story = '', paragraphIndex = 0, radius = 2) {
    const paragraphs = splitStoryParagraphs(story);
    const index = Math.max(0, Math.min(paragraphs.length - 1, Number(paragraphIndex) || 0));
    const start = Math.max(0, index - radius);
    const end = Math.min(paragraphs.length, index + radius + 1);
    return paragraphs.slice(start, end).map(item => item.text).join(' ');
}

function descriptionLines(text = '') {
    return String(text || '')
        .split(/(?<=[。！？；\n])/)
        .map(value => clean(value, 500))
        .filter(Boolean);
}

function extractOutfit(text = '') {
    return descriptionLines(text)
        .filter(line => OUTFIT_RE.test(line))
        .slice(-3)
        .join(' ')
        .slice(0, 900);
}

function extractAppearance(text = '') {
    return descriptionLines(text)
        .filter(line => APPEARANCE_RE.test(line))
        .slice(-4)
        .join(' ')
        .slice(0, 1100);
}

function styleLock(text = '') {
    if (ANCIENT_RE.test(text)) return {
        positive: 'ancient Chinese fantasy, xianxia, wuxia, hanfu, traditional Chinese architecture, Chinese props, period-accurate clothing',
        negative: 'school uniform, academy uniform, student uniform, blazer, necktie, western military uniform, epaulettes, red cape, modern city street, modern classroom, futuristic armor, European palace',
    };
    if (SCHOOL_RE.test(text)) return {
        positive: 'school setting, context-appropriate student clothing',
        negative: 'ancient hanfu, military uniform, fantasy armor',
    };
    if (MODERN_RE.test(text)) return {
        positive: 'modern setting, context-appropriate modern clothing',
        negative: 'school uniform, academy uniform, military uniform, fantasy armor, hanfu unless explicitly described',
    };
    return {
        positive: 'setting and clothing exactly matching the visible story context',
        negative: 'school uniform, academy uniform, student uniform, blazer, necktie, military uniform, fantasy armor unless explicitly described',
    };
}

function cardApplies(card = {}, window = '') {
    const name = clean(card.name, 120);
    if (!name) return false;
    return window.toLowerCase().includes(name.toLowerCase());
}

export function buildSceneLock({
    story = '',
    paragraphIndex = 0,
    card = {},
    manualCharacterLock = '',
    manualOutfitLock = '',
} = {}) {
    const window = paragraphWindow(story, paragraphIndex, 2);
    const fullContext = `${story} ${window}`;
    const style = styleLock(fullContext);
    const localOutfit = extractOutfit(window) || extractOutfit(story);
    const localAppearance = extractAppearance(window) || extractAppearance(story);
    const cardVisual = cardApplies(card, window) ? clean(card.visual, 1200) : '';
    const characterLock = clean(manualCharacterLock, 1200) || localAppearance || cardVisual;
    const outfitLock = clean(manualOutfitLock, 900) || localOutfit;

    const positive = unique([
        'SCENE LOCK',
        style.positive,
        characterLock ? `same character identity, ${characterLock}` : 'same character identity as described in the visible story',
        outfitLock ? `exact current outfit, ${outfitLock}` : 'exact current outfit from the selected story paragraph',
        'do not replace the described outfit with a school uniform or academy costume',
        'do not change hair color, eye color, face, body type, clothing era, or location',
    ]).join(', ');

    const negative = unique([
        style.negative,
        !SCHOOL_RE.test(window) ? 'school uniform, academy uniform, student uniform, blazer, necktie, school cape, campus costume' : '',
        'wrong character, different character, changed face, changed hair color, changed eye color, wrong outfit, different outfit, outfit substitution, unrelated costume, unrelated location',
    ]).join(', ');

    return {
        window,
        characterLock,
        outfitLock,
        style,
        positive,
        negative,
    };
}

export function findBestDomAnchor(blocks = [], anchor = '', paragraphIndex = 0) {
    if (!Array.isArray(blocks) || !blocks.length) return null;
    const normalize = value => clean(value, 1000).replace(/[“”「」『』]/g, '"').toLowerCase();
    const wanted = normalize(anchor);
    if (wanted) {
        let best = null;
        for (let index = 0; index < blocks.length; index++) {
            const text = normalize(blocks[index]?.textContent || '');
            if (!text) continue;
            let score = 0;
            if (text.includes(wanted) || wanted.includes(text)) score = 1000 + Math.min(text.length, wanted.length);
            else {
                for (const length of [120, 88, 64, 42, 26, 16]) {
                    if (wanted.length < length) continue;
                    const head = wanted.slice(0, length);
                    const tail = wanted.slice(-length);
                    if (text.includes(head) || text.includes(tail)) {
                        score = Math.max(score, 500 + length);
                        break;
                    }
                }
            }
            if (!best || score > best.score) best = { index, score };
        }
        if (best?.score > 0) return blocks[best.index];
    }
    const safeIndex = Math.max(0, Math.min(blocks.length - 1, Number(paragraphIndex) || 0));
    return blocks[safeIndex];
}
