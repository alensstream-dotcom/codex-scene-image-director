import {
    applyBible,
    buildFallbackPackets,
    compilePrompt,
    createBible,
    extractNarrativeStory,
    groundedActionFromEvidence,
    hasFemale,
    isDuplicateBeat,
    mergePacketIntoBible,
    normalizedText,
    resolveIdentityFromStory,
    resolveOutfitFromStory,
    sanitizePacket,
    sceneConcepts,
    sceneSettingFromStory,
    serializeBible,
    stableHash,
    storyBeatCandidates,
    stripLegacyImagePromptLines,
} from './director-core.mjs';

export const DIRECTOR_SCHEMA = 1;
export const DEFAULT_DIRECTOR_SETTINGS = Object.freeze({
    enabled: true,
    // Buttons are created automatically, but the player decides which CGs to render.
    autoGenerate: false,
    apiUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    minimumShots: 3,
    maximumShots: 6,
    timeoutMs: 12000,
    temperature: 0.2,
    maxTokens: 1200,
});

const SEXUAL_RE = /(?:性交|性行为|做爱|插入|阴茎|阴道|裸体|全裸|口交|手交|高潮|射精|骑乘位|后入|penetrat|intercourse|sexual|oral sex|handjob|vaginal|penis|nude|climax|orgasm|cum|sex\b)/i;
const ADULT_RE = /(?:成年|成人|18\+|1[89]\s*岁|[2-9]\d\s*岁|adult|woman|wife|mother)/i;
const MINOR_RE = /(?:幼女|小女孩|儿童|未成年|小学生|初中生|婴儿|child|minor|underage|loli|elementary school|middle school|\b(?:[0-9]|1[0-7])\s*(?:岁|years? old)\b)/i;
const FEMALE_RE = /(?:她|少女|女孩|女人|女性|女主|姑娘|妻子|女友|姐姐|妹妹|母亲|公主|女王|女仆|\b(?:1girl|2girls|female|woman|women|girl|girls|heroine|wife|girlfriend)\b)/i;
const OLD_PROMPT_RE = /^\s*\[([^\]\n]{40,})\]\s*$/gm;
const FEMALE_PRONOUN_RE = /\u5979(?:\u4eec)?/;

function clamp(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function text(value, maximum = 1200) {
    return normalizedText(value).slice(0, maximum);
}

function unique(values) {
    return [...new Set(values.map(value => text(value, 420)).filter(Boolean))];
}

function stripCodeFence(value = '') {
    return String(value).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function extractJsonObject(value = '') {
    const clean = stripCodeFence(value);
    try {
        return JSON.parse(clean);
    } catch {
        const first = clean.indexOf('{');
        const last = clean.lastIndexOf('}');
        if (first < 0 || last <= first) throw new Error('导演模型没有返回 JSON');
        return JSON.parse(clean.slice(first, last + 1));
    }
}

export function normalizeDirectorSettings(input = {}) {
    return {
        ...DEFAULT_DIRECTOR_SETTINGS,
        ...input,
        enabled: input.enabled !== false,
        autoGenerate: input.autoGenerate === true,
        apiUrl: String(input.apiUrl || DEFAULT_DIRECTOR_SETTINGS.apiUrl).replace(/\/+$/, ''),
        apiKey: String(input.apiKey || ''),
        model: String(input.model || DEFAULT_DIRECTOR_SETTINGS.model),
        minimumShots: Math.round(clamp(input.minimumShots, 1, 4, DEFAULT_DIRECTOR_SETTINGS.minimumShots)),
        maximumShots: Math.round(clamp(input.maximumShots, 3, 6, DEFAULT_DIRECTOR_SETTINGS.maximumShots)),
        timeoutMs: Math.round(clamp(input.timeoutMs, 3000, 20000, DEFAULT_DIRECTOR_SETTINGS.timeoutMs)),
        temperature: clamp(input.temperature, 0, 1, DEFAULT_DIRECTOR_SETTINGS.temperature),
        maxTokens: Math.round(clamp(input.maxTokens, 600, 3000, DEFAULT_DIRECTOR_SETTINGS.maxTokens)),
    };
}

export function cleanStory(raw = '') {
    return extractNarrativeStory(stripLegacyImagePromptLines(String(raw).replace(OLD_PROMPT_RE, '')));
}

export function desiredShotCount(story, settings = {}) {
    const config = normalizeDirectorSettings(settings);
    const clean = cleanStory(story);
    if (!hasFemale(clean) && !FEMALE_RE.test(clean) && !FEMALE_PRONOUN_RE.test(clean)) return 0;
    // A normal visual-novel reply must never silently degrade to one or two
    // buttons merely because the prose is concise.  The grounding pass later
    // decides whether the beats are genuinely distinct; this is the target KPI.
    if (clean.length < 32) return 0;
    if (clean.length < 120) return Math.min(config.minimumShots, config.maximumShots);
    const stagePatterns = [
        /抓住|扣住|拉住|拽住|护在|挡在|grab|pull|shield/i,
        /递|送|喂|咖啡|食物|hand(?:ing)?|offer|feed|coffee/i,
        /擦(?:掉|去)|奶泡|抚摸|触碰|wipe|caress|touch/i,
        /拥抱|环住.*腰|亲吻|吻上|嘴唇.*(?:贴|压|碰)|embrace|kiss/i,
        /拔剑|光刃|挡住|格挡|斩断|砍断|刺穿|击倒|战斗|attack|fight|block|slash|stab/i,
        /奔跑|冲向|跃过|跳(?:进|上|下|过)|追逐|run|jump|leap|chase/i,
        /脱下|脱掉|褪下|解开.*(?:衣|裙|裤|制服)|undress|strip/i,
        /口交|手交|oral sex|handjob/i,
        /插入|进入她|性交|penetrat|vaginal/i,
        /骑乘|跨坐|后入|体位|cowgirl|doggystyle|position change/i,
        /高潮|射精|climax|orgasm|cum/i,
        /事后|包扎|照料|aftercare|bandag/i,
    ];
    const distinctStages = stagePatterns.filter(pattern => pattern.test(clean)).length;
    const extra = Math.min(3, Math.max(0, distinctStages - config.minimumShots));
    return Math.min(config.maximumShots, Math.max(config.minimumShots, config.minimumShots + extra));
}

function cinematicSceneScore(scene) {
    // Score only grounded packet fields. The compiled prompt intentionally
    // contains many support tags and must never be able to inflate its own rank.
    const value = `${scene?.packet?.stage || ''} ${scene?.packet?.action || ''} ${scene?.packet?.quote || ''}`;
    let score = 0;
    if (/递.*(?:咖啡|杯)|coffee_handoff|hand(?:ing)? .*coffee/i.test(value)) score += 8;
    if (/奶泡|wiping|wipe.*(?:foam|lip)/i.test(value)) score += 9;
    if (/亲吻|吻上|嘴唇.*(?:贴|压|碰)|kiss/i.test(value)) score += 11;
    if (/拥抱|环住.*腰|embrace/i.test(value)) score += 7;
    if (/刺穿|斩断|砍断|格挡|击倒|拔剑|attack|fight|block|slash|stab/i.test(value)) score += 10;
    if (/脱下|undress/i.test(value)) score += 8;
    if (/口交|手交|oral sex|handjob/i.test(value)) score += 11;
    if (/插入|penetrat|vaginal/i.test(value)) score += 12;
    if (/骑乘|后入|position_change|cowgirl|doggystyle/i.test(value)) score += 12;
    if (/高潮|射精|climax|orgasm/i.test(value)) score += 13;
    if (/事后|aftercare/i.test(value)) score += 7;
    if (/抓住|握住|拉住|触碰|擦掉|grab|hold|pull|touch|wipe/i.test(value)) score += 3;
    if (/含泪|流泪|颤抖|愤怒|惊讶|tears|trembling|angry|surprised/i.test(value)) score += 2;
    if (/enter(?:ing)?|parting|walking away|look(?:ing)? around|进入.*(?:店|房间)|离开|后退|转身走/i.test(value)) score -= 5;
    return score;
}

function cinematicSceneCategory(scene) {
    const value = `${scene?.packet?.stage || ''} ${scene?.packet?.action || ''} ${scene?.packet?.quote || ''}`;
    if (/递.*(?:咖啡|杯)|coffee[_ -]?handoff|hand(?:ing)? .*coffee/i.test(value)) return 'coffee_handoff';
    if (/奶泡|wiping|wipe.*(?:foam|lip)/i.test(value)) return 'wiping';
    if (/亲吻|吻上|嘴唇.*(?:贴|压|碰)|拥抱|环住.*腰|kiss|embrace/i.test(value)) return 'romance_contact';
    if (/脱下|脱掉|undress|strip/i.test(value)) return 'undressing';
    if (/口交|oral sex/i.test(value)) return 'oral';
    if (/手交|handjob/i.test(value)) return 'manual';
    if (/插入|性交|penetrat|vaginal/i.test(value)) return 'penetration';
    if (/骑乘|后入|cowgirl|doggystyle|position change/i.test(value)) return 'position_change';
    if (/高潮|射精|climax|orgasm|cum/i.test(value)) return 'climax';
    if (/事后|照料|aftercare/i.test(value)) return 'aftercare';
    if (/刺穿|斩断|砍断|格挡|击倒|拔剑|attack|fight|block|slash|stab/i.test(value)) {
        if (/格挡|挡住|架住|block/i.test(value)) return 'combat:block';
        if (/刺穿|刺入|stab|pierc/i.test(value)) return 'combat:stab';
        if (/斩断|砍断|劈开|slash|cut/i.test(value)) return 'combat:slash';
        if (/射击|开枪|gun|shoot/i.test(value)) return 'combat:shoot';
        if (/击倒|击退|knock|defeat/i.test(value)) return 'combat:defeat';
        return 'combat:action';
    }
    return '';
}

function selectCoveredScenes(scenes, wanted, storyLength) {
    const ordered = [...scenes].sort((a, b) => a.position - b.position);
    if (ordered.length <= wanted) return ordered;
    const selected = [];
    const usedCategories = new Set();
    const length = Math.max(1, storyLength);
    const strong = ordered.filter(scene => cinematicSceneScore(scene) > 0);
    const pool = strong.length >= wanted ? strong : ordered;
    const choose = candidate => {
        if (!candidate || selected.includes(candidate)) return;
        selected.push(candidate);
        const category = cinematicSceneCategory(candidate);
        if (category) usedCategories.add(category);
    };

    // Hard global coverage pass.  DeepSeek often returns several attractive
    // candidates from the first action cluster.  It is therefore only a
    // candidate generator: when a valid beat exists in a story third, reserve
    // one slot for the strongest beat in that third before filling extras.
    if (wanted >= 3) {
        for (let band = 0; band < 3; band++) {
            const start = band / 3;
            const end = (band + 1) / 3;
            const inBand = pool.filter(scene => {
                const ratio = scene.position / length;
                return !selected.includes(scene) && ratio >= start && (band === 2 ? ratio <= end : ratio < end);
            });
            if (!inBand.length) continue;
            const distinct = inBand.filter(scene => {
                const category = cinematicSceneCategory(scene);
                return !category || !usedCategories.has(category);
            });
            const distinctElsewhere = pool.some(scene => {
                if (selected.includes(scene)) return false;
                const category = cinematicSceneCategory(scene);
                return !category || !usedCategories.has(category);
            });
            const bandPool = distinct.length ? distinct : (distinctElsewhere ? [] : inBand);
            const candidate = bandPool
                .map(scene => ({ scene, rank: cinematicSceneScore(scene) }))
                .sort((a, b) => b.rank - a.rank || b.scene.position - a.scene.position)[0]?.scene;
            choose(candidate);
        }
    }

    // Fill remaining slots with a balanced quality/spacing objective. Scores
    // are normalized so even a spectacular early kiss cannot numerically
    // overpower every later valid action merely because its raw score is high.
    while (selected.length < wanted) {
        const unused = pool.filter(scene => !selected.includes(scene));
        if (!unused.length) break;
        const distinct = unused.filter(scene => {
            const category = cinematicSceneCategory(scene);
            return !category || !usedCategories.has(category);
        });
        const candidates = distinct.length ? distinct : unused;
        const candidate = candidates.map(scene => {
            const ratio = scene.position / length;
            const minDistance = selected.length
                ? Math.min(...selected.map(item => Math.abs(ratio - item.position / length)))
                : 1;
            const quality = Math.max(0, Math.min(15, cinematicSceneScore(scene))) / 15;
            return { scene, rank: quality * 5 + minDistance * 8 };
        }).sort((a, b) => b.rank - a.rank || b.scene.position - a.scene.position)[0]?.scene;
        choose(candidate);
    }
    return selected.sort((a, b) => a.position - b.position);
}

export function buildDirectorMessages({ story, lastUserMessage = '', bible = {}, settings = {} }) {
    const config = normalizeDirectorSettings(settings);
    const clean = cleanStory(story).slice(0, 9000);
    const wanted = desiredShotCount(clean, config);
    // Six well-spread alternatives are enough for a normal three-CG turn.
    // Fast turns can expand to ten, without making DeepSeek narrate a second
    // copy of the story and timing out before the selector can use the result.
    const proposalLimit = Math.min(10, Math.max(6, wanted + 3));
    const evidenceCandidates = storyBeatCandidates(clean)
        .filter(item => sceneConcepts(item.text).length || /她|女|woman|girl|heroine/i.test(item.text))
        .slice(0, 48)
        .map((item, index) => `B${index + 1}@${item.position}: ${item.text}`)
        .join('\n')
        .slice(0, 2600);
    const system = `You are a fast storyboard director for an anime visual-novel image generator. Return one strict JSON object only, with keys "characters" and "scenes". Do not explain.

You propose candidates; the plugin chooses final buttons. Scan the WHOLE STORY and return up to ${proposalLimit} distinct high-value female-present beats (at least ${wanted} if available), including alternatives from early, middle and late. Never front-load. Repeated paragraphs of one continuous pose are one candidate. Prefer completed contact, decisive result, emotional climax or real stage/outfit change over setup, entering, standing, looking, walking or scenery.

Every scene must contain at least one woman who actually appears before that anchor. Never output a male-only, scenery-only, building-only, object-only, or invented-person scene. If a man is relevant, show him interacting with the woman rather than alone. Do not use future events. Adult consensual NSFW is allowed and should follow the exact current stage. Sexual scenes are forbidden if any depicted person's age is minor or not clearly adult.

For each character return: {"name":"stable story name","english_name":"stable English name","sex":"female|male","age":"adult|minor|unknown","identity":"concise immutable English Danbooru appearance tags: age, build, skin, face, hair style/color, eye color","outfit":"current visible English clothing tags","outfit_changed":false}. Reuse locked identity byte-for-byte unless the story explicitly transforms appearance. Carry clothing forward unless this reply explicitly changes it.

For each scene return only: {"anchor":"exact 8-80 character verbatim STORY substring","female_names":["names"],"stage":"short unique stage key","action_key":"short literal English subject-action-object-result translation","people":"1girl|1girl, 1boy|2girls","safety":"safe|nsfw|explicit"}. Anchor must occur verbatim. Add nothing absent from its story window.

Physical accuracy is mandatory. action_key must state subject + body part + contact + direction + visible result. Distinguish grabbing, holding, hugging, feeding and attempted versus completed action. Use one unambiguous action, no mood/quality/artist tag spam. Never replace a difficult key action with an easier nearby pose.`;
    const user = `LOCKED CHARACTER BIBLE (authoritative; may be empty):
${serializeBible(bible, 3600) || '(empty)'}

LAST USER MESSAGE (context only; never anchor here):
${text(lastUserMessage, 1600) || '(none)'}

EXACT VISUAL EVIDENCE CANDIDATES (selection aid; every line is copied from STORY):
${evidenceCandidates || '(none)'}

STORY TO STORYBOARD:
${clean}`;
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function characterFromModel(raw = {}) {
    const name = text(raw.name || raw.id || raw.english_name, 80);
    if (!name) return null;
    const sex = text(raw.sex, 16).toLowerCase();
    const age = text(raw.age, 16).toLowerCase();
    return {
        id: name,
        prompt_name: text(raw.english_name || name, 80),
        sex: sex === 'male' ? 'male' : 'female',
        age: ['adult', 'minor', 'unknown'].includes(age) ? age : 'unknown',
        dna: text(raw.identity || raw.dna, 620),
        outfit: text(raw.outfit, 360),
        identity_change: Boolean(raw.identity_changed || raw.identity_change),
        outfit_change: Boolean(raw.outfit_changed || raw.outfit_change),
    };
}

function isSexualMinor(packet, charactersByName, windowText = '') {
    if (!SEXUAL_RE.test(`${packet.safety} ${packet.action} ${packet.quote} ${windowText}`)) return false;
    return (packet.cast || []).some(cast => {
        const item = charactersByName.get(cast.id.toLowerCase());
        const evidence = `${item?.age || ''} ${cast.dna || ''}`;
        return item?.age === 'minor' || MINOR_RE.test(evidence) || (!ADULT_RE.test(evidence) && item?.age !== 'adult');
    });
}

function sourceIndex(story, anchor, after = 0) {
    const exact = story.indexOf(anchor, after);
    if (exact >= 0) return exact;
    const compact = text(anchor, 100);
    if (compact.length < 8) return -1;
    return story.indexOf(compact, after);
}

export function parseDirectorResponse(rawContent, { story, bible = createBible(), settings = {} } = {}) {
    const config = normalizeDirectorSettings(settings);
    const clean = cleanStory(story);
    const data = typeof rawContent === 'string' ? extractJsonObject(rawContent) : rawContent;
    const characters = (Array.isArray(data?.characters) ? data.characters : [])
        .map(characterFromModel).filter(Boolean);
    const charactersByName = new Map();
    for (const character of characters) {
        charactersByName.set(character.id.toLowerCase(), character);
        charactersByName.set(character.prompt_name.toLowerCase(), character);
    }
    for (const item of Object.values(bible || {})) {
        const proxy = {
            id: item.id,
            prompt_name: item.prompt_name || item.id,
            sex: 'female',
            age: ADULT_RE.test(`${item.dna || ''}`) ? 'adult' : 'unknown',
            dna: item.dna || '',
            outfit: item.outfit || '',
            identity_change: false,
            outfit_change: false,
        };
        if (!charactersByName.has(proxy.id.toLowerCase())) charactersByName.set(proxy.id.toLowerCase(), proxy);
        if (!charactersByName.has(proxy.prompt_name.toLowerCase())) charactersByName.set(proxy.prompt_name.toLowerCase(), proxy);
    }

    const prepared = [];
    const proposalLimit = Math.min(12, Math.max(config.maximumShots * 2, config.minimumShots));
    const anchoredScenes = (Array.isArray(data?.scenes) ? data.scenes : [])
        .map((scene, index) => {
            const anchor = text(scene?.anchor, 160);
            return { scene, index, anchor, position: sourceIndex(clean, anchor, 0) };
        })
        .filter(item => item.anchor && item.position >= 0)
        .sort((a, b) => a.position - b.position || a.index - b.index)
        .filter((item, index, all) => !all.slice(0, index).some(previous => previous.position === item.position && previous.anchor === item.anchor));
    for (const { scene, index, anchor, position } of anchoredScenes) {
        const end = position + anchor.length;
        const storyWindow = clean.slice(prepared.at(-1)?.end || 0, end);
        const requestedNames = Array.isArray(scene.female_names) ? scene.female_names : [];
        let cast = unique(requestedNames).map(name => charactersByName.get(name.toLowerCase()))
            .filter(item => item?.sex !== 'male');
        if (!cast.length && (requestedNames.length > 0 || hasFemale(storyWindow))) {
            const onlyFemale = [...new Map([...charactersByName.values()]
                .filter(item => item.sex !== 'male')
                .map(item => [item.id.toLowerCase(), item])).values()];
            if (onlyFemale.length === 1) cast = [onlyFemale[0]];
        }
        if (!cast.length) continue;
        // The long free-form model prompt is advisory UI data and is the most
        // common source of invented clothes, props and locations. Only the
        // compact action translation is eligible for evidence validation; all
        // scene/location/outfit facts are rebuilt from the story itself.
        const candidateTranslation = text(scene.action_key || '', 520);
        const grounding = groundedActionFromEvidence(anchor, candidateTranslation, text(scene.stage, 60));
        const sceneOutfits = scene?.outfits && typeof scene.outfits === 'object' ? scene.outfits : {};
        const groundedCast = cast.map(item => {
            const locked = bible?.[item.id.toLowerCase()];
            const modelOutfit = text(sceneOutfits[item.id] || sceneOutfits[item.prompt_name] || item.outfit, 420);
            const carried = locked?.outfit || item.outfit || '';
            const wardrobe = resolveOutfitFromStory(clean.slice(0, end), carried, modelOutfit === 'CARRY' ? '' : modelOutfit);
            const resolvedDna = resolveIdentityFromStory(clean, locked?.dna || item.dna, item.dna);
            return {
                ...item,
                dna: resolvedDna,
                identity_change: Boolean(resolvedDna && resolvedDna !== (locked?.dna || '')),
                outfit: wardrobe.outfit || carried,
                outfit_change: Boolean(wardrobe.changed && wardrobe.outfit && wardrobe.outfit !== carried),
            };
        });
        const packet = sanitizePacket({
            id: `director_${index + 1}_${stableHash(anchor).toString(36)}`,
            quote: anchor,
            people: text(scene.people, 40) || (/(?:他|男人|男主|1boy|male)/i.test(storyWindow) ? '1girl, 1boy' : '1girl'),
            cast: groundedCast,
            action: grounding.action,
            setting: sceneSettingFromStory(clean.slice(0, end)),
            expression: 'match only the visible emotion explicitly described in the verbatim story evidence',
            composition: /close[- ]?up|特写/i.test(String(scene.composition || ''))
                ? 'dynamic medium-full visual novel event CG, both characters and the exact contact clearly visible'
                : text(scene.composition, 260) || 'dynamic medium-full visual novel event CG, decisive instant, clear female subject',
            stage: grounding.stage === 'story_action' ? (text(scene.stage, 60) || `beat_${index + 1}`) : grounding.stage,
            safety: text(scene.safety, 20),
        }, index);
        if (isSexualMinor(packet, charactersByName, storyWindow)) continue;
        if (isDuplicateBeat(packet, prepared.map(item => item.packet))) continue;
        const locked = applyBible(packet, bible);
        const compiled = compilePrompt(locked, bible);
        prepared.push({
            packet: locked,
            anchor,
            position,
            end,
            prompt: compiled.positive,
            negative: compiled.negative,
            evidenceWindow: storyWindow,
            audit: { rejectedConcepts: grounding.rejectedConcepts, grounded: true },
        });
        if (prepared.length >= proposalLimit) break;
    }
    return { characters, scenes: prepared, raw: data };
}

function fallbackScenes(story, bible, maximum, minimum = 3) {
    const known = Object.values(bible || {}).find(item => hasFemale(`${item.id} ${item.prompt_name} ${item.dna}`));
    const packets = buildFallbackPackets(story, {
        bible,
        characterName: known?.id || '',
        characterVisual: known?.dna || '',
        minimum,
        maximum,
    });
    const clean = cleanStory(story);
    let cursor = 0;
    return packets.map(packet => {
        const position = sourceIndex(clean, packet.quote, cursor);
        cursor = Math.max(cursor, position + packet.quote.length);
        const compiled = compilePrompt(packet, bible);
        return {
            packet,
            anchor: packet.quote,
            position,
            end: position + packet.quote.length,
            prompt: compiled.positive,
            negative: compiled.negative,
            source: 'grounded-local-candidate',
        };
    }).filter(scene => scene.position >= 0);
}

function finalizeGroundedScenes(scenes, story, bible) {
    const clean = cleanStory(story);
    const outfitState = new Map(Object.entries(bible || {}).map(([key, value]) => [key, value.outfit || '']));
    let previousEnd = 0;
    return [...scenes].sort((a, b) => a.position - b.position).map((scene, index) => {
        const end = Math.max(scene.end || 0, scene.position + String(scene.anchor || '').length);
        const evidenceWindow = clean.slice(previousEnd, end);
        previousEnd = end;
        const carriedAction = /(?:Verbatim story evidence|Grounded English rendering)/i.test(scene.packet.action || '') ? '' : scene.packet.action;
        const grounding = groundedActionFromEvidence(scene.anchor, carriedAction, scene.packet.stage);
        const cast = (scene.packet.cast || []).map(item => {
            const key = item.id.toLowerCase();
            const carried = outfitState.get(key) ?? bible?.[key]?.outfit ?? item.outfit ?? '';
            const wardrobe = resolveOutfitFromStory(clean.slice(0, end), carried, item.outfit);
            const resolved = wardrobe.outfit || carried;
            outfitState.set(key, resolved);
            const resolvedDna = resolveIdentityFromStory(clean, bible?.[key]?.dna || item.dna, item.dna);
            return {
                ...item,
                dna: resolvedDna,
                identity_change: Boolean(resolvedDna && resolvedDna !== (bible?.[key]?.dna || '')),
                outfit: resolved,
                outfit_change: Boolean(resolved && resolved !== (bible?.[key]?.outfit || '')),
            };
        });
        const packet = applyBible(sanitizePacket({
            ...scene.packet,
            id: scene.packet.id || `grounded_${index + 1}_${stableHash(scene.anchor).toString(36)}`,
            quote: scene.anchor,
            cast,
            action: grounding.action,
            setting: sceneSettingFromStory(clean.slice(0, end)),
            composition: /close[- ]?up|特写/i.test(String(scene.packet.composition || ''))
                ? 'dynamic medium-full visual novel event CG, full interaction and contact point visible'
                : scene.packet.composition || 'dynamic medium-full visual novel event CG, full interaction visible',
            stage: grounding.stage === 'story_action' ? scene.packet.stage : grounding.stage,
        }, index), bible);
        const compiled = compilePrompt(packet, bible);
        return {
            ...scene,
            packet,
            prompt: compiled.positive,
            negative: compiled.negative,
            evidenceWindow,
            audit: {
                grounded: true,
                rejectedConcepts: unique([...(scene.audit?.rejectedConcepts || []), ...grounding.rejectedConcepts]),
                storyConcepts: sceneConcepts(evidenceWindow),
                outfitByCharacter: Object.fromEntries(packet.cast.map(item => [item.id, item.outfit])),
            },
        };
    });
}

export function completeScenes({ story, parsedScenes = [], bible = createBible(), settings = {} }) {
    const config = normalizeDirectorSettings(settings);
    const wanted = desiredShotCount(story, config);
    if (!wanted) return [];
    // DeepSeek only proposes candidates. Deterministic story candidates always
    // compete with them, even when the model returned the requested count.
    // This prevents three easy early poses from blocking a later decisive beat.
    const merged = parsedScenes.filter(scene => cinematicSceneScore(scene) >= 0);
    const proposalLimit = Math.min(12, Math.max(config.maximumShots * 2, wanted));
    for (const fallback of fallbackScenes(story, bible, proposalLimit, wanted)) {
        if (merged.some(scene => scene.anchor === fallback.anchor || isDuplicateBeat(fallback.packet, merged.map(item => item.packet)))) continue;
        merged.push(fallback);
    }
    const selected = selectCoveredScenes(merged, wanted, cleanStory(story).length);
    return finalizeGroundedScenes(selected, story, bible);
}

export function mergeCharactersIntoBible(bible = createBible(), characters = []) {
    for (const character of characters) {
        if (character.sex === 'male') continue;
        const existing = bible?.[character.id.toLowerCase()];
        mergePacketIntoBible(bible, {
            cast: [{
                ...character,
                // A model summary describes the reply as a whole. It must not
                // overwrite the chronological outfit state before shots are
                // grounded against their exact story positions.
                outfit: existing?.outfit || character.outfit,
                outfit_change: false,
            }],
        });
    }
    return bible;
}

export function insertInlinePrompts(rawMessage, scenes = []) {
    let result = String(rawMessage || '');
    const insertions = [];
    let cursor = 0;
    for (const scene of [...scenes].sort((a, b) => a.position - b.position)) {
        const anchor = String(scene.anchor || '');
        const index = result.indexOf(anchor, cursor);
        if (index < 0 || !scene.prompt) continue;
        const end = index + anchor.length;
        cursor = end;
        insertions.push({ index: end, marker: `\n\n[${String(scene.prompt).replace(/[\[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim()}]\n\n` });
    }
    for (const insertion of insertions.sort((a, b) => b.index - a.index)) {
        const nearby = result.slice(insertion.index, insertion.index + insertion.marker.length + 16);
        if (nearby.includes(insertion.marker.trim())) continue;
        result = result.slice(0, insertion.index) + insertion.marker + result.slice(insertion.index);
    }
    return { message: result.replace(/\n{4,}/g, '\n\n\n'), inserted: insertions.length };
}

export function composeDirectedMessage(rawMessage, story, scenes = []) {
    const insertion = insertInlinePrompts(story, scenes);
    const statusBlocks = [...String(rawMessage || '').matchAll(/<status\b[^>]*>[\s\S]{0,6000}?<\/status\s*>/gi)];
    const status = statusBlocks.at(-1)?.[0]?.trim() || '';
    return {
        ...insertion,
        message: [insertion.message.trim(), status].filter(Boolean).join('\n\n'),
    };
}

export function processingKey(rawMessage) {
    return stableHash(cleanStory(rawMessage)).toString(36);
}
