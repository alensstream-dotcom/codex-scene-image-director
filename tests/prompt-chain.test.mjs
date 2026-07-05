import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = new URL('../index.js', import.meta.url);
let source = fs.readFileSync(sourcePath, 'utf8');
source = source.replace(/^import[\s\S]*?from '\.\.\/\.\.\/\.\.\/\.\.\/script\.js';\s*import[\s\S]*?from '\.\.\/\.\.\/\.\.\/extensions\.js';\s*/, '');
source = source.replace(/\$\(\(\) => init\(\)\);\s*$/, '');
source += `
globalThis.__csidTest = {
  EXT_ID,
  ensureSettings,
  ensureChatMemory,
  compilePrompt,
  buildScenePreviewPayload,
  resolveFocusCharacter,
  prepareSceneText,
  buildChatu8Trigger,
  writePromptToMessage,
  buildCaptureSelectionFromPoints,
  selectBestVisualMoment,
  renderPromptFromVisualAtoms,
  validateImagePrompt,
  extractVisualAtomsByAI,
  buildPromptByVisualAtoms,
  buildCharacterCastForPrompt,
  resolveSourceText,
};
`;

function createContext() {
    const context = {
        console,
        structuredClone,
        AbortController,
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval: () => {},
        chat: [],
        chat_metadata: {},
        characters: [{ name: 'alens' }],
        this_chid: 0,
        eventSource: {
            on() {},
            once() {},
            emit() {},
            removeListener() {},
            listenerCount() { return 1; },
        },
        event_types: { MESSAGE_UPDATED: 'message_updated' },
        extension_prompt_roles: { SYSTEM: 'system' },
        extension_prompt_types: { IN_CHAT: 'in_chat' },
        getCurrentChatId: () => 'test-chat',
        saveChatConditional: async () => {},
        saveSettingsDebounced: () => {},
        setExtensionPrompt: () => {},
        extension_settings: {},
        getContext: () => ({ name2: 'alens' }),
        saveMetadataDebounced: () => {},
        window: {},
        globalThis: null,
        document: {
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: () => ({ style: {}, dataset: {}, appendChild() {}, setAttribute() {}, addEventListener() {} }),
            body: { appendChild() {} },
        },
        navigator: { clipboard: null },
        fetch: null,
        Blob: class {},
        URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
        FileReader: class {},
        $: () => {},
    };
    context.globalThis = context;
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'index.js' });
    const api = context.__csidTest;
    const settings = api.ensureSettings();
    settings.behavior.promptLanguage = 'en';
    settings.api.enabled = false;
    settings.chatu8.enabled = true;
    const memory = api.ensureChatMemory();
    return { context, api, settings, memory };
}

function setCharacter(memory, settings, name, appearance, outfit = '') {
    settings.memory.characters[name] = {
        appearance,
        currentOutfit: outfit,
        expression: '',
        pose: '',
        state: '',
        accessories: '',
        negative: '',
        locked: { appearance: true, currentOutfit: false, accessories: true },
    };
    memory.characters[name] = {
        currentOutfit: outfit,
        expression: '',
        pose: '',
        state: '',
        accessories: '',
    };
}

function promptOf(api, text, focusCharacter) {
    return api.compilePrompt(text, { focusCharacter }).positive;
}

{
    const { api, settings, memory } = createContext();
    setCharacter(memory, settings, '凛', 'silver hair', 'loose white hoodie');
    memory.scene.location = 'home dining room';
    memory.scene.time = 'morning';
    const prompt = promptOf(api, '凛坐在餐桌前，盯着那颗水蜜桃看了很久，拿着勺子的手停在半空。', '凛');
    for (const term of ['Rin', 'silver hair', 'loose white hoodie', 'dining table', 'honey peach', 'spoon']) {
        assert.match(prompt, new RegExp(term, 'i'), `test1 missing ${term}: ${prompt}`);
    }
    assert.doesNotMatch(prompt, /solo male|young man/i);
}

{
    const { api, settings, memory } = createContext();
    setCharacter(memory, settings, '樱', 'soft brown hair', 'school uniform');
    memory.scene.location = 'school gate';
    memory.scene.time = 'morning';
    const prompt = promptOf(api, '樱站在校门口，脸红得厉害，把草莓牛奶从 alens 手里接过去。', '樱');
    for (const term of ['Sakura', 'school gate', 'blushing', 'accepting strawberry milk']) {
        assert.match(prompt, new RegExp(term, 'i'), `test2 missing ${term}: ${prompt}`);
    }
    assert.doesNotMatch(prompt, /unrelated street/i);
}

{
    const { api, settings, memory } = createContext();
    setCharacter(memory, settings, '诗织', 'short silver hair, blue eyes', 'school uniform');
    const result = api.compilePrompt('诗织低头检查书包，侧袋里露出一角漫画书封。', { focusCharacter: '诗织' });
    for (const term of ['book cover peeking out of school bag side pocket', 'school bag side pocket', 'searching through belongings', 'partly peeking out']) {
        assert.match(result.positive, new RegExp(term, 'i'), `test2b missing ${term}: ${result.positive}`);
    }
    assert.match(result.negative, /unrelated portrait|wrong scene/i, `test2b should guard against generic portrait: ${result.negative}`);
}

{
    const { api, settings, memory } = createContext();
    setCharacter(memory, settings, '樱', 'soft brown hair', 'school uniform');
    const result = api.compilePrompt('樱咬着嘴唇，眼眶发红，却把那封信藏到身后。', { focusCharacter: '樱' });
    for (const term of ['letter hidden behind the back', 'biting lip', 'teary eyes', 'hiding something behind back']) {
        assert.match(result.positive, new RegExp(term, 'i'), `test2c missing ${term}: ${result.positive}`);
    }
    assert.match(result.negative, /generic standing pose|wrong scene/i, `test2c should penalize generic poses: ${result.negative}`);
}

{
    const { api, settings, memory } = createContext();
    setCharacter(memory, settings, '樱', 'pink long hair', 'school uniform');
    memory.scene.location = 'school gate';
    memory.scene.lighting = 'sunlight';
    memory.characters['樱'].pose = 'sitting';
    settings.memory.world.visualStyle = '赛博朋克美学, 暗色调, 霓虹灯光, 玻璃拟态UI';
    settings.memory.world.genre = '学院, 秘密, 阴谋';
    const text = '神原樱背着书包走在前面，小皮鞋踩得啪啪响，每一步都像在跺地板。她头也不回，樱粉色的长发随着步伐一甩一甩。';
    const result = api.compilePrompt(text, { focusCharacter: '樱' });
    for (const term of ['walking ahead', 'walking away from viewer', 'not looking back', 'stomping footsteps', 'leather shoes', 'school bag', 'swaying hair', 'pink long hair']) {
        assert.match(result.positive, new RegExp(term, 'i'), `test2c2 missing selected-scene term ${term}: ${result.positive}`);
    }
    for (const stale of ['sitting', 'school gate', 'sunlight', 'cyberpunk', 'neon', '赛博朋克', '霓虹']) {
        assert.doesNotMatch(result.positive, new RegExp(stale, 'i'), `test2c2 should not leak stale memory/style ${stale}: ${result.positive}`);
    }
    assert.doesNotMatch(result.positive, /duo|two character composition/i, `test2c2 should not split full name and given name into two people: ${result.positive}`);
    assert.doesNotMatch(result.positive, /(^|, )book(,|$)/i, `test2c2 should not misread school bag as a book: ${result.positive}`);
    assert.match(result.negative, /looking back|looking at viewer|sitting/i, `test2c2 should counter wrong pose/view: ${result.negative}`);
}

{
    const { api, context, settings, memory } = createContext();
    settings.behavior.promptLanguage = 'zh';
    settings.prompt.positivePrefix = '超清, sharp focus';
    settings.memory.world.visualStyle = '赛博朋克美学, neon lights';
    settings.memory.world.rules = '学院, secret conspiracy';
    setCharacter(memory, settings, '神原樱', 'pink long hair, green eyes', 'school uniform');
    context.chat[0] = { mes: '神原樱背着书包走在前面，小皮鞋踩得啪啪响。她头也不回，樱粉色的长发随着步伐一甩一甩。' };
    const payload = await api.buildScenePreviewPayload(0, context.chat[0].mes, { focusCharacter: '神原樱' });
    assert.doesNotMatch(payload.finalPrompt, /[\u4e00-\u9fff]/, `test2c3 final prompt must be English only: ${payload.finalPrompt}`);
    assert.doesNotMatch(payload.trigger, /[\u4e00-\u9fff]/, `test2c3 Chatu8 trigger must be English only: ${payload.trigger}`);
    assert.match(payload.finalPrompt, /Kanbara Sakura|walking ahead|school bag/i, `test2c3 should keep English scene anchors: ${payload.finalPrompt}`);
}

{
    const { api, context, settings, memory } = createContext();
    setCharacter(memory, settings, '神原樱', 'pink long hair, green eyes', 'school uniform');
    memory.story.summary = '旧剧情是赛博朋克雨夜，霓虹街道和玻璃幕墙很多。';
    const longText = [
        '神原樱背着书包走在前面，小皮鞋踩得啪啪响，每一步都像在跺地板。',
        'alens没搭话，依旧保持着那个距离。',
        '走了大概五分钟，樱突然停下脚步。',
        '她盯着路边一家还没开门的甜品店橱窗，里面摆着草莓蛋糕的模型。',
        '“本小姐才不是因为想吃草莓蛋糕才停下来的。”她说完，又迈开步子往前走。',
        '拐过团子坂的路口，干驮木小学的校门已经能看见了。'
    ].join('\n');
    context.chat[0] = { mes: longText };
    const moment = api.selectBestVisualMoment(api.prepareSceneText(longText));
    assert.match(moment, /停下脚步|甜品店橱窗|草莓蛋糕/, `test2c3d should extract the drawable moment: ${moment}`);
    assert.doesNotMatch(moment, /alens没搭话|校门已经能看见/, `test2c3d should not keep non-visual tail/context: ${moment}`);
    const payload = await api.buildScenePreviewPayload(0, longText);
    assert.equal(payload.sceneMoment, longText, 'test2c3d default preview should use the full original selection');
    assert.equal(payload.sceneMomentSource, 'fullSelection', 'test2c3d default source should be fullSelection');
    const autoPayload = await api.buildScenePreviewPayload(0, longText, { sceneMoment: moment, sceneMomentSource: 'autoExtract' });
    assert.equal(autoPayload.sceneMoment, moment, 'test2c3d autoExtract should use extracted moment only when requested');
    assert.equal(payload.focusCharacter, '神原樱', 'test2c3d should prefer the full character name from the original selection');
    assert.match(autoPayload.finalPrompt, /Kanbara Sakura|strawberry cake|dessert shop window|shop window/i, `test2c3d auto prompt should focus the dessert-window shot: ${autoPayload.finalPrompt}`);
    assert.doesNotMatch(autoPayload.finalPrompt, /school gate|cyberpunk|neon|rainy/i, `test2c3d prompt should not leak old style or later location: ${autoPayload.finalPrompt}`);
    assert.ok(autoPayload.finalPrompt.length < 760, `test2c3d prompt should stay concise, got ${autoPayload.finalPrompt.length}: ${autoPayload.finalPrompt}`);
}

{
    assert.doesNotMatch(source, /name="behavior\.promptLanguage"/, 'test2c3b prompt language setting should be removed from UI');
    assert.doesNotMatch(source, /name="world\.visualStyle"/, 'test2c3b world visual style setting should be removed from UI');
    assert.doesNotMatch(source, /name="prompt\.quality"/, 'test2c3b quality prompt setting should be removed from UI');
    assert.doesNotMatch(source, /mustChooseFocus/, 'test2c3b preview should not lock insert/generate buttons behind focus selection');
    assert.doesNotMatch(source, /data-csid-preview-action="(?:insert|generate)"[^\\n]*disabled/, 'test2c3b preview action buttons should not render disabled');
}

{
    const { api } = createContext();
    const atoms = {
        scene_caption: 'Rin watches a peach at the dining table.',
        main_subject: 'Rin',
        character_count: '1girl',
        characters: [{
            name: 'Rin',
            role: 'main focus',
            appearance: 'silver hair',
            outfit: 'loose white hoodie',
            pose: 'sitting at dining table',
            action: 'staring at honey peach',
            expression: 'sleepy, shy',
            visible_props: ['spoon paused in midair'],
        }],
        location: 'home dining room',
        time_lighting: 'morning, soft natural lighting',
        main_props: ['honey peach', 'spoon'],
        composition: 'medium shot',
        mood: 'quiet slice of life',
        must_include_tags: ['Rin', 'silver hair', 'loose white hoodie', 'honey peach'],
    };
    const prompt = api.renderPromptFromVisualAtoms(atoms);
    assert.match(prompt, /^masterpiece, best quality, highres, anime illustration,/i, `test2c3e prompt prefix missing: ${prompt}`);
    assert.doesNotMatch(prompt, /[\u4e00-\u9fff]| because | while | then /i, `test2c3e prompt should be English comma tags: ${prompt}`);
    assert.ok(prompt.split(',').length >= 12, `test2c3e prompt should contain comma tags: ${prompt}`);
    const bad = api.validateImagePrompt('Rin sat at the dining table and stared at the peach for a long time while her spoon stopped in midair because she felt awkward.', { visualAtoms: atoms, sceneMoment: '凛坐在餐桌前，盯着那颗水蜜桃看了很久。' });
    assert.equal(bad.ok, false, 'test2c3e narrative prompt should be rejected');
    assert.match(bad.issues.join(','), /story_connector|novel_sentence|too_few_tags/, `test2c3e wrong issues: ${bad.issues}`);
}

{
    const { api, context, settings, memory } = createContext();
    setCharacter(memory, settings, '凛', 'silver hair', 'loose white hoodie');
    settings.api.enabled = true;
    settings.api.url = 'http://example.test/v1';
    let requestedBody = null;
    context.fetch = async (_url, request) => {
        requestedBody = JSON.parse(request.body);
        return {
            ok: true,
            async json() {
                return {
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                positive_prompt: 'BAD DIRECT PROMPT SHOULD BE IGNORED',
                                scene_caption: 'Rin watches a honey peach at the dining table.',
                                main_subject: 'Rin',
                                character_count: '1girl',
                                characters: [{
                                    name: 'Rin',
                                    role: 'main focus',
                                    appearance: 'silver hair',
                                    outfit: 'loose white hoodie',
                                    pose: 'sitting at dining table',
                                    action: 'staring at honey peach',
                                    expression: 'sleepy',
                                    visible_props: ['spoon paused in midair'],
                                }],
                                location: 'home dining room',
                                time_lighting: 'morning, soft natural lighting',
                                main_props: ['honey peach', 'spoon'],
                                composition: 'medium shot',
                                mood: 'quiet slice of life',
                                must_include_tags: ['Rin', 'silver hair', 'loose white hoodie', 'honey peach'],
                                must_avoid_tags: ['wrong scene'],
                            }),
                        },
                    }],
                };
            },
        };
    };
    context.chat[0] = { mes: '凛坐在餐桌前，盯着那颗水蜜桃看了很久，拿着勺子的手停在半空。' };
    const payload = await api.buildScenePreviewPayload(0, context.chat[0].mes, { focusCharacter: '凛' });
    assert.equal(payload.promptSource, 'api', 'test2c3f API should be main prompt source');
    assert.match(payload.finalPrompt, /Rin|silver hair|honey peach|spoon paused in midair/i, `test2c3f rendered atoms prompt missing core tags: ${payload.finalPrompt}`);
    assert.doesNotMatch(payload.finalPrompt, /BAD DIRECT PROMPT/i, 'test2c3f API direct prompt must be ignored');
    assert.ok(requestedBody.messages[1].content.includes('sceneMoment'), 'test2c3f API request should include sceneMoment');
    assert.doesNotMatch(requestedBody.messages[1].content, /rootSummary|summaryTree|recentHistory|visualEvents/, 'test2c3f API request should not include long memory trees');
}

{
    const { api, context, settings, memory } = createContext();
    setCharacter(memory, settings, '凛', 'silver hair', 'loose white hoodie');
    settings.api.enabled = true;
    settings.api.url = 'http://example.test/v1';
    context.fetch = async () => { throw new Error('network down'); };
    context.chat[0] = { mes: '凛坐在餐桌前，盯着那颗水蜜桃看了很久，拿着勺子的手停在半空。' };
    const payload = await api.buildScenePreviewPayload(0, context.chat[0].mes, { focusCharacter: '凛' });
    assert.equal(payload.promptSource, 'localFallback', 'test2c3g API failure should use localFallback');
    assert.match(payload.finalPrompt, /Rin|honey peach/i, `test2c3g fallback prompt should still be usable: ${payload.finalPrompt}`);
}

{
    const { api, settings, memory } = createContext();
    setCharacter(memory, settings, '凛', 'silver hair', 'loose white hoodie');
    setCharacter(memory, settings, '蓝', 'blue hair', 'blue cardigan');
    const cast = api.buildCharacterCastForPrompt('蓝伸手拉住凛的袖口，凛回过头看她。', '蓝伸手拉住凛的袖口，凛回过头看她。', '凛');
    assert.equal(cast.map(item => item.name).slice(0, 2).join('/'), '凛/蓝', 'test2c3h focus character should be first in cast');
    const prompt = api.renderPromptFromVisualAtoms({
        character_count: '2girls',
        characters: [
            { name: 'Rin', appearance: 'silver hair', outfit: 'loose white hoodie', action: 'looking back' },
            { name: 'Lan', appearance: 'blue hair', outfit: 'blue cardigan', action: 'grabbing sleeve cuff' },
        ],
        composition: 'two character composition',
        must_include_tags: ['2girls', 'grabbing sleeve cuff', 'looking back'],
    });
    assert.match(prompt, /2girls|Rin|Lan|grabbing sleeve cuff|looking back|clear separation between characters|distinct outfits|no merged faces|no mixed clothing/i, `test2c3h multi-character prompt incomplete: ${prompt}`);
}

{
    const { api, context } = createContext();
    context.window.getSelection = () => '正文选区';
    context.navigator.clipboard = { readText: async () => '剪贴板文本' };
    const resolved = await api.resolveSourceText('手动输入');
    assert.equal(resolved, '正文选区', 'test2c3i clipboard must not override current text selection');
}

{
    const { api, settings, memory } = createContext();
    setCharacter(memory, settings, '樱', 'pink long hair', 'school uniform');
    const school = api.compilePrompt('樱背着书包走在学校走廊里。', { focusCharacter: '樱' }).positive;
    assert.match(school, /polished school anime key visual/i, `test2c3c school profile missing: ${school}`);
    const cyberpunk = api.compilePrompt('樱站在雨夜的霓虹街道里，玻璃幕墙映出她的影子。', { focusCharacter: '樱' }).positive;
    assert.match(cyberpunk, /anime cyberpunk illustration|neon rim lighting/i, `test2c3c cyberpunk profile missing: ${cyberpunk}`);
    const fantasy = api.compilePrompt('樱举起法杖，森林里的魔法阵发出光芒。', { focusCharacter: '樱' }).positive;
    assert.match(fantasy, /fantasy anime illustration|luminous magic/i, `test2c3c fantasy profile missing: ${fantasy}`);
}

{
    const { api, context, settings, memory } = createContext();
    setCharacter(memory, settings, '神原樱', '', 'school uniform');
    const selected = '神原樱背着书包走在前面，小皮鞋踩得啪啪响。她头也不回，樱粉色的长发随着步伐一甩一甩。';
    context.chat[0] = { mes: selected, swipes: [] };
    const payload = await api.buildScenePreviewPayload(0, selected, { focusCharacter: '神原樱' });
    await api.writePromptToMessage(0, selected, { selectedText: selected, preview: payload });
    const fixed = api.ensureSettings().memory.characters['神原樱'].appearance;
    assert.match(fixed, /pink hair/i, `test2c4 should remember fixed hair color: ${fixed}`);
    assert.match(fixed, /long hair/i, `test2c4 should remember fixed hair length: ${fixed}`);
    assert.doesNotMatch(fixed, /school uniform|leather shoes|shoe/i, `test2c4 fixed appearance should not lock clothing: ${fixed}`);
    const changed = api.compilePrompt('神原樱换上黑色外套，站在走廊里。', { focusCharacter: '神原樱' }).positive;
    assert.match(changed, /pink hair|long hair/i, `test2c4 later prompt should keep fixed appearance: ${changed}`);
    assert.match(changed, /black|coat/i, `test2c4 later prompt should use changed outfit: ${changed}`);
    assert.doesNotMatch(changed, /school uniform/i, `test2c4 changed outfit should not be overwritten by stale outfit: ${changed}`);
}

{
    const { api, settings, memory } = createContext();
    setCharacter(memory, settings, '凛', 'silver hair', 'loose white hoodie');
    setCharacter(memory, settings, '蓝', 'blue hair', 'blue cardigan');
    const result = api.compilePrompt('蓝伸手拉住凛的袖口，凛回过头看她。', { focusCharacter: '凛' });
    for (const term of ['duo', 'two character composition', 'grabbing sleeve cuff', 'looking back', 'visual focus on Rin']) {
        assert.match(result.positive, new RegExp(term, 'i'), `test2d missing ${term}: ${result.positive}`);
    }
    assert.match(result.negative, /solo portrait|merged faces|mixed outfits/i, `test2d should guard multi-character images: ${result.negative}`);
}

{
    const { api, settings, memory } = createContext();
    setCharacter(memory, settings, 'alens', 'young man', 'casual clothes');
    const prompt = promptOf(api, 'alens站在甜品店橱窗前，手里拿着准备给樱的草莓大福。', 'alens');
    for (const term of ['alens', 'dessert shop', 'shop window', 'strawberry daifuku']) {
        assert.match(prompt, new RegExp(term, 'i'), `test3 missing ${term}: ${prompt}`);
    }
    assert.match(prompt, /gift for Sakura|meant for Sakura/i, `test3 missing Sakura gift intent: ${prompt}`);
}

{
    const { api, settings, memory } = createContext();
    setCharacter(memory, settings, '凛', 'silver hair', 'loose white hoodie');
    setCharacter(memory, settings, '蓝', 'blue hair', 'blue cardigan');
    const text = '蓝和凛同时坐在客厅里，凛把水蜜桃护在怀里，蓝坐在沙发另一边看书。';
    const detected = api.resolveFocusCharacter(text);
    assert.equal(detected.ambiguous, true, 'test4 should require focus choice for multi-character text');
    const prompt = promptOf(api, text, '凛');
    for (const term of ['Rin', 'silver hair', 'loose white hoodie', 'living room', 'honey peach']) {
        assert.match(prompt, new RegExp(term, 'i'), `test4 missing ${term}: ${prompt}`);
    }
    assert.doesNotMatch(prompt, /blue cardigan/i, `test4 mixed Lan outfit into Rin focus: ${prompt}`);
}

{
    const { api, context, settings, memory } = createContext();
    setCharacter(memory, settings, '樱', 'soft brown hair', 'school uniform');
    context.chat[0] = { mes: '樱站在校门口，脸红得厉害，把草莓牛奶从 alens 手里接过去。' };
    const payload = await api.buildScenePreviewPayload(0, context.chat[0].mes, { focusCharacter: '樱' });
    assert.match(payload.trigger, /^\[[\s\S]+\]$/, 'test5 should create Chatu8 bracket trigger');
    assert.equal(payload.insertTargetMessageId, 0);
    assert.match(payload.finalPrompt, /Sakura/i);
    assert.match(source, /generate-image-request/, 'test5 official Chatu8 request event should be wired in source');
    assert.match(source, /usedOfficialZhihuijiPipeline/, 'test5 debug should expose official pipeline flag');
    assert.match(source, /确认生图/, 'test5 selection popup should expose a confirm image button');
}

{
    const { api, context } = createContext();
    context.chat[0] = {
        mes: [
            '3.剧情要求：',
            '基于历史对话的交界处场景进行完整描写，引入新的剧情变量。',
            '4.详略安排：',
            '总字数控制在 800-1200 之间。正文模型禁止输出任何图片标签。',
            '5.文笔要求：',
            '必须保持角色语气，禁止输出 JSON。'
        ].join('\n'),
    };
    assert.equal(api.prepareSceneText(context.chat[0].mes), '', 'test6 scaffold should not fall back to prompt text');
    await assert.rejects(
        () => api.buildScenePreviewPayload(0, context.chat[0].mes),
        /太短|预设|提示词/,
        'test6 should reject prompt scaffold instead of generating an image prompt',
    );
}

{
    const { api, settings, memory } = createContext();
    setCharacter(memory, settings, '凛', 'silver hair', 'loose white hoodie');
    const text = [
        '剧情要求：基于历史对话继续推进，禁止输出图片标签。',
        '凛坐在餐桌前，盯着那颗水蜜桃看了很久，拿着勺子的手停在半空。',
        'Time passed: approximately 5 minutes.'
    ].join('\n');
    const cleaned = api.prepareSceneText(text);
    assert.match(cleaned, /凛坐在餐桌前/, 'test7 should keep only real narrative after scaffold');
    assert.doesNotMatch(cleaned, /剧情要求|Time passed/, 'test7 should remove scaffold and metadata lines');
    const prompt = api.compilePrompt(cleaned, { focusCharacter: '凛' }).positive;
    assert.match(prompt, /Rin/i, 'test7 should still generate from cleaned narrative');
    assert.doesNotMatch(prompt, /剧情要求|Time passed|禁止输出/i, 'test7 prompt should not contain scaffold text');
}

{
    const { api, context, settings, memory } = createContext();
    setCharacter(memory, settings, '凛', 'silver hair', 'loose white hoodie');
    const selected = '凛坐在餐桌前，盯着那颗水蜜桃看了很久，拿着勺子的手停在半空。';
    context.chat[0] = {
        mes: ['前面还有别的剧情。', selected, '后面继续说话。'].join('\n\n'),
        swipes: [],
    };
    const first = await api.writePromptToMessage(0, selected, { selectedText: selected });
    assert.equal(first.insertedAtSelection, true, 'test8 should insert after selected segment');
    assert.match(context.chat[0].mes, new RegExp(selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*\\[[\\s\\S]+\\][\\s\\S]*后面继续说话'), 'test8 trigger should be before following paragraph');
    const once = context.chat[0].mes;
    const second = await api.writePromptToMessage(0, selected, { selectedText: selected });
    assert.equal(second.insertedAtSelection, true, 'test8 repeated write should still find selected segment');
    assert.equal((context.chat[0].mes.match(/\n\n\[/g) || []).length, 1, 'test8 repeated write should not stack duplicate trigger blocks');
    assert.notEqual(context.chat[0].mes, once + '\n\n' + second.trigger, 'test8 should replace previous trigger instead of appending');
}

{
    const { api, context } = createContext();
    const full = [
        '前面还有别的剧情。',
        '凛坐在餐桌前，盯着那颗水蜜桃看了很久。',
        '她拿着勺子的手停在半空，像是在犹豫。',
        '窗外的晨光落在白色连帽衫上。',
        '后面继续说话。'
    ].join('\n');
    context.chat[0] = { mes: full };
    const startText = '凛坐在餐桌前';
    const endText = '白色连帽衫上';
    const startRange = full.indexOf(startText);
    const endRange = full.indexOf(endText);
    const capture = api.buildCaptureSelectionFromPoints(
        { messageId: 0, text: startText, sourceRange: { start: startRange, end: startRange + startText.length, exact: true } },
        { messageId: 0, text: endText, sourceRange: { start: endRange, end: endRange + endText.length, exact: true } },
    );
    assert.match(capture.text, /凛坐在餐桌前/, 'test9 capture should include start text');
    assert.match(capture.text, /勺子的手停在半空/, 'test9 capture should include middle narrative');
    assert.match(capture.text, /白色连帽衫上/, 'test9 capture should include end text');
    assert.doesNotMatch(capture.text, /前面还有别的剧情|后面继续说话/, 'test9 capture should not include outside text');
    assert.equal(capture.messageId, 0);
}

{
    const { api, context, settings, memory } = createContext();
    setCharacter(memory, settings, '凛', 'silver hair', 'loose white hoodie');
    const selected = '凛坐在餐桌前，盯着那颗水蜜桃看了很久，拿着勺子的手停在半空。';
    const full = [selected, '中间有别的剧情。', selected, '后面继续说话。'].join('\n\n');
    const secondStart = full.lastIndexOf(selected);
    context.chat[0] = { mes: full, swipes: [] };
    const result = await api.writePromptToMessage(0, selected, {
        selectedText: selected,
        sourceRange: { start: secondStart, end: secondStart + selected.length, exact: true },
    });
    assert.equal(result.insertedAtSelection, true, 'test10 should accept explicit sourceRange');
    const triggerIndex = context.chat[0].mes.indexOf(result.trigger);
    assert.ok(triggerIndex > secondStart, 'test10 trigger should be inserted after the second matching selectedText');
    assert.equal(context.chat[0].mes.indexOf(result.trigger), context.chat[0].mes.lastIndexOf(result.trigger), 'test10 should insert only one trigger');
}

console.log('prompt-chain tests passed');
