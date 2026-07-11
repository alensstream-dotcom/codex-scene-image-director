import {
    chat,
    eventSource,
    event_types,
    saveChatConditional,
    saveSettingsDebounced,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import {
    applyMissingPrompts,
    assertPromptRepairResponse,
    assertWholeTurnResponse,
    extractImagePrompts,
    findSelectedParagraph,
    insertPromptAfterParagraph,
    makeCacheKey,
    paragraphRanges,
    parseStrictJson,
    reinforcePromptLocal,
    replacePromptAt,
    stableHash,
    validateTurn,
} from './lib/rescue-core.mjs';

const EXT_ID = 'codex_scene_image_director';
const EXT_NAME = '世界书生图救援器';
const EXT_VERSION = '1.0.0';
const SETTINGS_SELECTOR = '#janima_rescue_settings';
const VERIFIED_ZHIHUIJI_SELECTOR = '.st-chatu8-image-button';

const DEFAULT_SETTINGS = {
    version: 3,
    enabled: true,
    autoCheck: true,
    showStatus: true,
    showToolbar: true,
    selectionFill: true,
    api: {
        enabled: false,
        url: '',
        key: '',
        model: '',
        timeoutMs: 10000,
        characterDna: '',
    },
    chatu8: {
        enabled: true,
        startTag: '[',
        endTag: ']',
        rescanTimeoutMs: 3500,
        buttonWaitMs: 3500,
    },
    legacy: {
        autonomousDirector: false,
        longTermImageMemory: false,
        prism: false,
        fastAccurateModes: false,
    },
};

const runtime = {
    cache: new Map(),
    debugByMessage: new Map(),
    ignored: new Set(),
    writing: new Set(),
    selection: null,
    selectionTimer: null,
};

function mergeDefaults(base, incoming) {
    const result = { ...base };
    for (const [key, value] of Object.entries(incoming || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object') {
            result[key] = mergeDefaults(base[key], value);
        } else if (key in base) {
            result[key] = value;
        }
    }
    return result;
}

function settings() {
    const existing = extension_settings[EXT_ID];
    if (!existing || Number(existing.version) < 3) {
        const api = existing?.api || {};
        const chatu8 = existing?.chatu8 || {};
        extension_settings[EXT_ID] = mergeDefaults(DEFAULT_SETTINGS, {
            api: { enabled: false, url: api.url || '', key: api.key || '', model: api.model || '', timeoutMs: api.timeoutMs || 10000 },
            chatu8: { enabled: true, startTag: chatu8.startTag || '[', endTag: chatu8.endTag || ']' },
        });
    } else {
        extension_settings[EXT_ID] = mergeDefaults(DEFAULT_SETTINGS, existing);
    }
    return extension_settings[EXT_ID];
}

function toast(type, message) {
    if (globalThis.toastr?.[type]) globalThis.toastr[type](message, EXT_NAME);
    else console[type === 'error' ? 'error' : 'log'](`[${EXT_NAME}] ${message}`);
}

function getMessageText(messageId) {
    const message = chat?.[Number(messageId)];
    return String(message?.mes || message?.message || '');
}

function isAssistantMessage(messageId) {
    const message = chat?.[Number(messageId)];
    return Boolean(message && !message.is_user && !message.is_system);
}

function messageElement(messageId) {
    const id = Number(messageId);
    return document.querySelector(`.mes[mesid="${id}"]`)
        || document.querySelector(`.mes[data-mes-id="${id}"]`)
        || [...document.querySelectorAll('.mes')][id]
        || null;
}

function setDebug(messageId, patch) {
    const current = runtime.debugByMessage.get(Number(messageId)) || {};
    runtime.debugByMessage.set(Number(messageId), { ...current, ...patch, messageId: Number(messageId), extensionVersion: EXT_VERSION });
}

function baseDebug(messageId, validation, promptIndex = null) {
    const prompt = promptIndex === null ? null : validation.prompts[promptIndex];
    return {
        messageId: Number(messageId),
        declaredImageCount: validation.declaredImageCount,
        detectedPromptCount: validation.detectedPromptCount,
        promptIndex,
        originalPrompt: prompt?.prompt || '',
        repairedPrompt: '',
        issues: prompt?.issues || validation.issues,
        repairMode: '',
        cacheHit: false,
        insertParagraphIndex: prompt?.paragraphIndex ?? null,
        zhihuijiButtonFound: false,
        zhihuijiRoute: '',
        generationRequested: false,
        generationStatus: '',
    };
}

function statusText(validation) {
    if (validation.declaredImageCount === null) return '未发现 IMG_COUNT 标记';
    const mismatch = validation.issues.find(issue => issue.code === 'count_mismatch');
    if (mismatch) return `应有 ${validation.declaredImageCount} 张，实际 ${validation.detectedPromptCount} 张`;
    const errors = validation.issues.filter(issue => issue.severity === 'error').length;
    const warnings = validation.issues.filter(issue => issue.severity === 'warning').length;
    if (!errors && !warnings) return `生图检查：${validation.detectedPromptCount}/${validation.declaredImageCount}，格式正常`;
    return `生图检查：${validation.detectedPromptCount}/${validation.declaredImageCount}，${errors} 个错误，${warnings} 个提醒`;
}

function button(label, action, messageId, promptIndex = '') {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'menu_button janima-rescue-button';
    node.textContent = label;
    node.dataset.action = action;
    node.dataset.messageId = String(messageId);
    if (promptIndex !== '') node.dataset.promptIndex = String(promptIndex);
    return node;
}

function renderMessageCheck(messageId) {
    if (!settings().enabled || !isAssistantMessage(messageId) || runtime.ignored.has(Number(messageId))) return;
    const host = messageElement(messageId);
    if (!host) return;
    host.querySelectorAll(':scope > .janima-rescue-panel').forEach(node => node.remove());
    const text = getMessageText(messageId);
    const validation = validateTurn(text);
    const previousDebug = runtime.debugByMessage.get(Number(messageId));
    const currentHash = stableHash(text);
    setDebug(messageId, {
        ...baseDebug(messageId, validation),
        ...(previousDebug?.messageContentHash === currentHash ? previousDebug : {}),
        declaredImageCount: validation.declaredImageCount,
        detectedPromptCount: validation.detectedPromptCount,
        messageContentHash: currentHash,
    });

    const panel = document.createElement('section');
    panel.className = `janima-rescue-panel${validation.ok ? ' is-ok' : ' has-issues'}`;
    panel.dataset.messageId = String(messageId);

    if (settings().showStatus) {
        const status = document.createElement('div');
        status.className = 'janima-rescue-status';
        status.textContent = statusText(validation);
        panel.append(status);
        if (!validation.ok) {
            const actions = document.createElement('div');
            actions.className = 'janima-rescue-actions';
            if (validation.declaredImageCount !== null && validation.detectedPromptCount < validation.declaredImageCount) {
                actions.append(button('修复本轮', 'repair-turn', messageId));
            } else if (validation.declaredImageCount === null) {
                actions.append(button('检查本轮', 'recheck', messageId));
            }
            actions.append(button('忽略', 'ignore', messageId));
            panel.append(actions);
        }
    }

    if (settings().showToolbar) {
        validation.prompts.forEach((prompt, index) => {
            const row = document.createElement('div');
            row.className = 'janima-rescue-prompt-row';
            const label = document.createElement('span');
            label.className = 'janima-rescue-prompt-label';
            label.textContent = `Prompt ${index + 1}${prompt.issues.length ? ` · ${prompt.issues.map(issue => issue.message).join('、')}` : ''}`;
            row.append(label);
            const actions = document.createElement('div');
            actions.className = 'janima-rescue-actions';
            actions.append(
                button('本地补强', 'local', messageId, index),
                button('修复此 Prompt', 'repair-prompt', messageId, index),
                button('重新识别按钮', 'rescan', messageId, index),
                button('立即生图', 'generate', messageId, index),
                button('复制 Prompt', 'copy-prompt', messageId, index),
                button('复制 Debug', 'copy-debug', messageId, index),
            );
            row.append(actions);
            panel.append(row);
        });
    }
    host.append(panel);
}

function scheduleCheck(messageId, delay = 80) {
    const id = Number(messageId);
    if (!Number.isInteger(id) || runtime.writing.has(id)) return;
    setTimeout(() => renderMessageCheck(id), delay);
}

async function writeMessage(messageId, nextText, source) {
    const id = Number(messageId);
    const message = chat?.[id];
    if (!message) throw new Error('消息不存在');
    runtime.writing.add(id);
    message.mes = nextText;
    try {
        await saveChatConditional?.();
        await eventSource.emit(event_types.MESSAGE_UPDATED, id, source || EXT_ID);
    } finally {
        runtime.writing.delete(id);
    }
    scheduleCheck(id, 120);
}

function currentPrompt(messageId, promptIndex) {
    const text = getMessageText(messageId);
    const validation = validateTurn(text);
    const prompt = validation.prompts[Number(promptIndex)];
    if (!prompt) throw new Error('Prompt 已变化或不存在，请重新检查');
    return { text, validation, prompt };
}

function promptStoryContext(text, prompt) {
    const paragraphs = paragraphRanges(text);
    const isPromptParagraph = item => extractImagePrompts(item.text).length > 0 || /^<!--\s*IMG_COUNT/.test(item.text.trim());
    let sceneIndex = prompt.paragraphIndex - 1;
    while (sceneIndex >= 0 && isPromptParagraph(paragraphs[sceneIndex])) sceneIndex--;
    return {
        before: paragraphs[sceneIndex - 1]?.text || '',
        current: paragraphs[sceneIndex]?.text || '',
        after: paragraphs[sceneIndex + 1]?.text && !isPromptParagraph(paragraphs[sceneIndex + 1]) ? paragraphs[sceneIndex + 1].text : '',
        paragraphIndex: sceneIndex,
    };
}

function endpoint(url) {
    const clean = String(url || '').trim().replace(/\/$/, '');
    if (!clean) throw new Error('请先填写 API URL');
    return /\/chat\/completions$/i.test(clean) ? clean : `${clean}/chat/completions`;
}

async function callRepairApi(systemPrompt, payload) {
    const config = settings().api;
    if (!config.enabled) throw new Error('AI 修复未启用');
    if (!config.model) throw new Error('请先填写模型名称');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(config.timeoutMs || 10000)));
    try {
        const response = await fetch(endpoint(config.url), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}),
            },
            body: JSON.stringify({
                model: config.model,
                temperature: 0,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: JSON.stringify(payload) },
                ],
            }),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`API ${response.status}: ${(await response.text()).slice(0, 240)}`);
        const json = await response.json();
        const content = json?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error('API 响应缺少 message.content');
        return parseStrictJson(content);
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error('AI 请求超时，原 Prompt 已保留');
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function repairOnePrompt(messageId, promptIndex) {
    const { text, validation, prompt } = currentPrompt(messageId, promptIndex);
    const context = promptStoryContext(text, prompt);
    const key = makeCacheKey({ messageId, messageContent: text, originalPrompt: prompt.prompt, repairMode: 'ai' });
    let repaired = runtime.cache.get(key);
    const cacheHit = Boolean(repaired);
    if (!repaired) {
        repaired = assertPromptRepairResponse(await callRepairApi(
            'You repair an existing Stable Diffusion/Anima tag prompt. Preserve its subject, characters, action, and location. Fix only explicit count, current clothing/action, invented people/interactions, and concise tag grammar. Return strict JSON with prompt_tags, negative_tags, changes, confidence. Never return prose or markdown.',
            {
                original_worldbook_prompt: prompt.prompt,
                previous_paragraph: context.before,
                scene_paragraph: context.current,
                next_paragraph: context.after,
                relevant_character_dna: settings().api.characterDna || '',
            },
        ));
        runtime.cache.set(key, repaired);
    }
    const replacement = `[${repaired.prompt_tags.join(', ')}]`;
    await writeMessage(messageId, replacePromptAt(text, prompt, replacement), 'janima-rescue-ai-prompt');
    setDebug(messageId, {
        ...baseDebug(messageId, validation, Number(promptIndex)),
        repairedPrompt: replacement,
        repairMode: 'ai',
        cacheHit,
        changes: repaired.changes,
        negativeTags: repaired.negative_tags,
        messageContentHash: stableHash(getMessageText(messageId)),
    });
    toast('success', cacheHit ? '已使用缓存修复 Prompt' : 'Prompt 修复完成');
}

async function repairWholeTurn(messageId) {
    const text = getMessageText(messageId);
    const validation = validateTurn(text);
    if (validation.declaredImageCount === null) throw new Error('缺少 IMG_COUNT，无法判断应补数量');
    const missingCount = validation.declaredImageCount - validation.detectedPromptCount;
    if (missingCount <= 0) throw new Error('本轮没有缺失 Prompt');
    const key = makeCacheKey({ messageId, messageContent: text, originalPrompt: validation.prompts.map(item => item.prompt).join('\n'), repairMode: 'wholeTurn' });
    let repaired = runtime.cache.get(key);
    const cacheHit = Boolean(repaired);
    if (!repaired) {
        repaired = assertWholeTurnResponse(await callRepairApi(
            'You fill only missing image prompts in one assistant turn. Never rewrite story text or existing prompts. Return strict JSON {"missing_prompts":[{"after_paragraph_index":0,"anchor_text":"","prompt_tags":[]}]} using short English image tags. The array length must equal missing_count.',
            {
                assistant_reply: text,
                existing_prompts: validation.prompts.map(item => item.prompt),
                declared_img_count: validation.declaredImageCount,
                missing_count: missingCount,
                relevant_character_dna: settings().api.characterDna || '',
            },
        ));
        if (repaired.missing_prompts.length !== missingCount) throw new Error(`AI 返回 ${repaired.missing_prompts.length} 张，预期 ${missingCount} 张`);
        runtime.cache.set(key, repaired);
    }
    const nextText = applyMissingPrompts(text, repaired.missing_prompts);
    await writeMessage(messageId, nextText, 'janima-rescue-whole-turn');
    setDebug(messageId, {
        ...baseDebug(messageId, validation),
        repairMode: 'wholeTurn',
        cacheHit,
        insertParagraphIndex: repaired.missing_prompts.map(item => item.after_paragraph_index),
        messageContentHash: stableHash(getMessageText(messageId)),
    });
    toast('success', `已在对应段落补入 ${missingCount} 张图`);
}

function verifiedZhihuijiButtons(messageId) {
    const host = messageElement(messageId);
    if (!host || !settings().chatu8.enabled) return [];
    return [...host.querySelectorAll(VERIFIED_ZHIHUIJI_SELECTOR)].filter(node => node instanceof HTMLElement);
}

async function waitForZhihuijiButton(messageId, promptIndex) {
    const timeout = Math.max(250, Number(settings().chatu8.buttonWaitMs || 3500));
    const started = Date.now();
    do {
        const buttons = verifiedZhihuijiButtons(messageId);
        if (buttons[Number(promptIndex)]) return buttons[Number(promptIndex)];
        await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() - started < timeout);
    return null;
}

async function rescanZhihuiji(messageId, promptIndex) {
    await eventSource.emit(event_types.MESSAGE_UPDATED, Number(messageId), 'janima-rescue-rescan');
    const buttonNode = await waitForZhihuijiButton(messageId, promptIndex);
    setDebug(messageId, {
        zhihuijiButtonFound: Boolean(buttonNode),
        zhihuijiRoute: buttonNode ? VERIFIED_ZHIHUIJI_SELECTOR : 'not-found',
        generationStatus: buttonNode ? 'button-ready' : 'button-not-found',
    });
    if (!buttonNode) throw new Error('智绘姬真实按钮未出现，请检查智绘姬标记和启用状态');
    toast('success', '已找到智绘姬真实生图按钮');
    return buttonNode;
}

async function generateWithZhihuiji(messageId, promptIndex) {
    const buttonNode = verifiedZhihuijiButtons(messageId)[Number(promptIndex)] || await rescanZhihuiji(messageId, promptIndex);
    if (buttonNode.dataset.loading === 'true') throw new Error('智绘姬正在处理此 Prompt');
    buttonNode.click();
    setDebug(messageId, {
        zhihuijiButtonFound: true,
        zhihuijiRoute: `${VERIFIED_ZHIHUIJI_SELECTOR} -> HTMLElement.click()`,
        generationRequested: true,
        generationStatus: buttonNode.dataset.loading === 'true' ? 'loading' : 'clicked',
    });
    toast('success', '已点击智绘姬真实生图按钮');
}

async function copyText(text, success) {
    await navigator.clipboard.writeText(String(text));
    toast('success', success);
}

async function localReinforce(messageId, promptIndex) {
    const { text, validation, prompt } = currentPrompt(messageId, promptIndex);
    const replacement = reinforcePromptLocal(prompt.prompt);
    await writeMessage(messageId, replacePromptAt(text, prompt, replacement), 'janima-rescue-local');
    setDebug(messageId, {
        ...baseDebug(messageId, validation, Number(promptIndex)),
        repairedPrompt: replacement,
        repairMode: 'local',
        cacheHit: false,
        messageContentHash: stableHash(getMessageText(messageId)),
    });
    toast('success', '已完成确定性本地补强');
}

async function handlePanelAction(event) {
    const control = event.target.closest('[data-action][data-message-id]');
    if (!control) return;
    const messageId = Number(control.dataset.messageId);
    const promptIndex = Number(control.dataset.promptIndex || 0);
    try {
        switch (control.dataset.action) {
            case 'ignore':
                runtime.ignored.add(messageId);
                control.closest('.janima-rescue-panel')?.remove();
                break;
            case 'recheck': renderMessageCheck(messageId); break;
            case 'local': await localReinforce(messageId, promptIndex); break;
            case 'repair-prompt': await repairOnePrompt(messageId, promptIndex); break;
            case 'repair-turn': await repairWholeTurn(messageId); break;
            case 'rescan': await rescanZhihuiji(messageId, promptIndex); break;
            case 'generate': await generateWithZhihuiji(messageId, promptIndex); break;
            case 'copy-prompt': {
                const { prompt } = currentPrompt(messageId, promptIndex);
                await copyText(`[${prompt.prompt}]`, 'Prompt 已复制');
                break;
            }
            case 'copy-debug': {
                const current = currentPrompt(messageId, promptIndex);
                const debug = { ...baseDebug(messageId, current.validation, promptIndex), ...(runtime.debugByMessage.get(messageId) || {}) };
                await copyText(JSON.stringify(debug, null, 2), 'Debug 已复制');
                break;
            }
        }
    } catch (error) {
        setDebug(messageId, { error: error.message, generationStatus: 'error' });
        toast('error', error.message);
    }
}

function selectionFromPage() {
    const selection = window.getSelection?.();
    const selectedText = selection?.toString().trim();
    if (!selectedText || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const host = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer.closest?.('.mes')
        : range.commonAncestorContainer.parentElement?.closest?.('.mes');
    if (!host) return null;
    const rawId = host.getAttribute('mesid') || host.dataset.mesId;
    const messageId = Number(rawId || [...document.querySelectorAll('.mes')].indexOf(host));
    if (!isAssistantMessage(messageId)) return null;
    const paragraphIndex = findSelectedParagraph(getMessageText(messageId), selectedText);
    if (paragraphIndex < 0) return null;
    const rect = range.getBoundingClientRect();
    return { messageId, selectedText, paragraphIndex, x: Math.min(window.innerWidth - 180, Math.max(8, rect.left)), y: Math.max(8, rect.bottom + 8), at: Date.now() };
}

function hideSelectionMenu() {
    document.querySelectorAll('.janima-rescue-selection-menu').forEach(node => node.remove());
}

function showSelectionMenu(capture) {
    hideSelectionMenu();
    const menu = document.createElement('div');
    menu.className = 'janima-rescue-selection-menu';
    menu.style.left = `${capture.x}px`;
    menu.style.top = `${capture.y}px`;
    const add = button('补一张图', 'manual-fill', capture.messageId);
    add.dataset.paragraphIndex = String(capture.paragraphIndex);
    const cancel = button('取消', 'selection-cancel', capture.messageId);
    menu.append(add, cancel);
    document.body.append(menu);
}

function captureSelection() {
    if (!settings().enabled || !settings().selectionFill) return;
    const capture = selectionFromPage();
    if (!capture) return;
    runtime.selection = capture;
    clearTimeout(runtime.selectionTimer);
    runtime.selectionTimer = setTimeout(() => { runtime.selection = null; hideSelectionMenu(); }, 30000);
    showSelectionMenu(capture);
}

async function manualFill(capture) {
    const text = getMessageText(capture.messageId);
    const paragraphs = paragraphRanges(text);
    const existing = extractImagePrompts(text);
    const key = makeCacheKey({ messageId: capture.messageId, messageContent: text, originalPrompt: capture.selectedText, repairMode: 'manualFill' });
    let result = runtime.cache.get(key);
    const cacheHit = Boolean(result);
    if (!result) {
        result = assertPromptRepairResponse(await callRepairApi(
            'Create one concise Stable Diffusion/Anima prompt for the selected story paragraph. Return strict JSON with prompt_tags, negative_tags, changes, confidence. Use English comma-separated image tags, no prose, no invented people or actions.',
            {
                selected_paragraph: capture.selectedText,
                previous_paragraph: paragraphs[capture.paragraphIndex - 1]?.text || '',
                next_paragraph: paragraphs[capture.paragraphIndex + 1]?.text || '',
                relevant_character_dna: settings().api.characterDna || '',
                recent_worldbook_prompt_as_format_reference: existing.at(-1)?.prompt || '',
            },
        ));
        runtime.cache.set(key, result);
    }
    const wrapped = `[${result.prompt_tags.join(', ')}]`;
    if (!window.confirm(`补入这张图？\n\n${wrapped}`)) return;
    await writeMessage(capture.messageId, insertPromptAfterParagraph(text, capture.paragraphIndex, wrapped), 'janima-rescue-manual-fill');
    setDebug(capture.messageId, {
        repairMode: 'manualFill',
        cacheHit,
        insertParagraphIndex: capture.paragraphIndex,
        repairedPrompt: wrapped,
        messageContentHash: stableHash(getMessageText(capture.messageId)),
    });
    toast('success', '已把 Prompt 插入选中段落下方');
}

async function handleSelectionAction(event) {
    const control = event.target.closest('.janima-rescue-selection-menu [data-action]');
    if (!control) return;
    const action = control.dataset.action;
    const capture = runtime.selection;
    hideSelectionMenu();
    if (action === 'selection-cancel' || !capture) return;
    try { await manualFill(capture); }
    catch (error) { toast('error', error.message); }
}

function settingsHtml() {
    return `
        <div id="janima_rescue_settings" class="janima-rescue-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>世界书生图救援器 <small>v${EXT_VERSION}</small></b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <p class="notes">世界书负责正常生图；这里仅做本地检查与用户点击后的救援。默认聊天不会调用额外 LLM。</p>
                    <h4>基础设置</h4>
                    ${checkRow('enabled', '启用救援插件')}
                    ${checkRow('autoCheck', '自动检查最新回复')}
                    ${checkRow('showStatus', '显示消息状态条')}
                    ${checkRow('showToolbar', '显示 Prompt 工具栏')}
                    ${checkRow('selectionFill', '显示选区“补一张图”')}
                    <h4>API 设置</h4>
                    ${checkRow('api.enabled', '启用 AI 修复（只在点击修复/补图时调用）')}
                    ${fieldRow('api.url', 'API URL', 'https://example.com/v1')}
                    ${fieldRow('api.key', 'API Key', '', 'password')}
                    ${fieldRow('api.model', '模型', 'model-name')}
                    ${fieldRow('api.timeoutMs', 'Timeout (ms)', '10000', 'number')}
                    <label>当前相关角色 DNA<textarea class="text_pole" name="api.characterDna" rows="4" placeholder="只填写当前相关角色的固定外貌与当前服装"></textarea></label>
                    <h4>智绘姬设置</h4>
                    ${checkRow('chatu8.enabled', '启用智绘姬适配')}
                    ${fieldRow('chatu8.startTag', '开始标记', '[')}
                    ${fieldRow('chatu8.endTag', '结束标记', ']')}
                    ${fieldRow('chatu8.rescanTimeoutMs', '重新识别超时 (ms)', '3500', 'number')}
                    ${fieldRow('chatu8.buttonWaitMs', '生成按钮等待时间 (ms)', '3500', 'number')}
                    <details><summary>Legacy（只读迁移提示）</summary><p class="notes">旧自主生成器、长期图片记忆、PRISM、Fast/Accurate 模式均已从默认入口移除并保持关闭。完整 0.7.0 代码保留在 tag <code>pre-rescue-rebuild-0.7.0</code> 与 master 分支。</p></details>
                </div>
            </div>
        </div>`;
}

function checkRow(name, label) {
    return `<label class="checkbox_label"><input type="checkbox" name="${name}"><span>${label}</span></label>`;
}

function fieldRow(name, label, placeholder, type = 'text') {
    return `<label>${label}<input class="text_pole" type="${type}" name="${name}" placeholder="${placeholder}"></label>`;
}

function getPath(object, path) {
    return path.split('.').reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
    const keys = path.split('.');
    const final = keys.pop();
    const parent = keys.reduce((target, key) => target[key], object);
    parent[final] = value;
}

function syncSettingsUi() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    const config = settings();
    root?.querySelectorAll('[name]').forEach(input => {
        const value = getPath(config, input.name);
        if (input.type === 'checkbox') input.checked = Boolean(value);
        else input.value = value ?? '';
    });
}

function bindSettings() {
    const root = document.querySelector(SETTINGS_SELECTOR);
    root?.addEventListener('change', event => {
        const input = event.target.closest('[name]');
        if (!input) return;
        let value = input.type === 'checkbox' ? input.checked : input.value;
        if (input.type === 'number') value = Number(value);
        setPath(settings(), input.name, value);
        saveSettingsDebounced();
        if (['enabled', 'showStatus', 'showToolbar'].includes(input.name)) {
            document.querySelectorAll('.janima-rescue-panel').forEach(node => node.remove());
            if (settings().enabled) scanLatestAssistant();
        }
    });
}

function scanLatestAssistant() {
    for (let index = (chat?.length || 0) - 1; index >= 0; index--) {
        if (isAssistantMessage(index)) { scheduleCheck(index); return; }
    }
}

function bindEvents() {
    const onMessage = messageId => {
        if (settings().autoCheck) scheduleCheck(messageId, 120);
    };
    [event_types.MESSAGE_RECEIVED, event_types.MESSAGE_UPDATED, event_types.MESSAGE_SWIPED]
        .filter(Boolean)
        .forEach(type => eventSource.on(type, onMessage));
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(scanLatestAssistant, 200));
    document.addEventListener('click', handlePanelAction);
    document.addEventListener('click', handleSelectionAction);
    document.addEventListener('mouseup', () => setTimeout(captureSelection, 0));
    document.addEventListener('touchend', () => setTimeout(captureSelection, 120), { passive: true });
}

jQuery(async () => {
    settings();
    const container = document.querySelector('#extensions_settings') || document.querySelector('#extensions_settings2');
    if (container && !document.querySelector(SETTINGS_SELECTOR)) container.insertAdjacentHTML('beforeend', settingsHtml());
    syncSettingsUi();
    bindSettings();
    bindEvents();
    scanLatestAssistant();
    console.info(`[${EXT_NAME}] v${EXT_VERSION} loaded; default LLM requests: 0; verified Zhihuiji route: ${VERIFIED_ZHIHUIJI_SELECTOR}`);
});
