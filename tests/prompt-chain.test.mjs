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
};
`;

function createContext() {
    const context = {
        console,
        structuredClone,
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
    const payload = api.buildScenePreviewPayload(0, context.chat[0].mes, { focusCharacter: '樱' });
    assert.match(payload.trigger, /^\[[\s\S]+\]$/, 'test5 should create Chatu8 bracket trigger');
    assert.equal(payload.insertTargetMessageId, 0);
    assert.match(payload.finalPrompt, /Sakura/i);
    assert.match(source, /generate-image-request/, 'test5 official Chatu8 request event should be wired in source');
    assert.match(source, /usedOfficialZhihuijiPipeline/, 'test5 debug should expose official pipeline flag');
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
    assert.throws(
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
