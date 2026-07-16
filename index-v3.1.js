import {
    chat,
    characters,
    saveSettingsDebounced,
    this_chid,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { buildSceneLock, findBestDomAnchor } from './lib/scene-lock-v3.mjs';

const EXT_ID = 'codex_scene_image_director';
const VERSION = '3.1.0';
const SCHOOL_POSITIVE_RE = /(?:^|,\s*)(?:[^,]*(?:school uniform|academy uniform|student uniform|blazer|necktie|school cape|military uniform|epaulettes|red cape)[^,]*)(?=,|$)/gi;
const ANCIENT_RE = /(?:古代|江湖|武林|修仙|仙门|师姐|师妹|师父|木剑|真剑|剑法|古琴|亭|竹林|hanfu|wuxia|xianxia|ancient china)/i;
const SCHOOL_RE = /(?:学院|学校|校园|教室|校服|school|academy|classroom|school uniform)/i;

function pluginSettings() {
    const value = extension_settings[EXT_ID] ||= {};
    value.manualCharacterLock ??= '';
    value.manualOutfitLock ??= '';
    value.sceneLockEnabled ??= true;
    return value;
}

function currentCard() {
    const character = characters?.[Number(this_chid)];
    if (!character) return { name: '', visual: '' };
    return {
        name: String(character.name || character.data?.name || '').trim(),
        visual: [character.description, character.data?.description]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .slice(0, 2200),
    };
}

function latestAssistantStory() {
    for (let index = (chat?.length || 0) - 1; index >= 0; index--) {
        if (!chat[index]?.is_user && !chat[index]?.is_system) return String(chat[index]?.mes || '');
    }
    return '';
}

function uniqueTags(value = '') {
    const seen = new Set();
    const result = [];
    for (const raw of String(value || '').split(/[,，]\s*/)) {
        const tag = raw.trim();
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        result.push(tag);
    }
    return result.join(', ');
}

function inspectRecords() {
    try {
        return globalThis.JANIMA_AUTO_CG?.inspectLatest?.() || [];
    } catch {
        return [];
    }
}

function recordForPrompt(positive = '') {
    const records = inspectRecords();
    return records.find(record => String(record.prompt || '') === String(positive || ''))
        || records.find(record => String(positive || '').includes(String(record.scenePrompt || '').slice(0, 100)))
        || records.find(record => ['queued', 'submitting', 'generating'].includes(record.status))
        || records.at(-1)
        || null;
}

function sanitizePositive(positive, story) {
    if (SCHOOL_RE.test(story)) return uniqueTags(positive);
    return uniqueTags(String(positive || '').replace(SCHOOL_POSITIVE_RE, '').replace(/,{2,}/g, ','));
}

function patchWorkflowBody(body) {
    const graph = body?.prompt;
    if (!graph || typeof graph !== 'object') return body;
    const positiveNode = Object.values(graph).find(node => node?.class_type === 'CLIPTextEncode' && /positive/i.test(node?._meta?.title || ''));
    const negativeNode = Object.values(graph).find(node => node?.class_type === 'CLIPTextEncode' && /negative/i.test(node?._meta?.title || ''));
    if (!positiveNode?.inputs || !negativeNode?.inputs) return body;

    const settings = pluginSettings();
    if (!settings.sceneLockEnabled) return body;
    const story = latestAssistantStory();
    const record = recordForPrompt(positiveNode.inputs.text);
    const paragraphIndex = Number(record?.paragraphIndex ?? 0);
    const lock = buildSceneLock({
        story,
        paragraphIndex,
        card: currentCard(),
        manualCharacterLock: settings.manualCharacterLock,
        manualOutfitLock: settings.manualOutfitLock,
    });

    const originalPositive = sanitizePositive(positiveNode.inputs.text, story);
    const hardEraLock = ANCIENT_RE.test(story)
        ? 'ancient Chinese fantasy scene, period-accurate hanfu or robes exactly as described, absolutely no school uniform, no academy uniform, no blazer, no necktie, no western military coat'
        : 'clothing and location exactly matching the selected visible story paragraph';
    positiveNode.inputs.text = uniqueTags(`${lock.positive}, ${hardEraLock}, ${originalPositive}`);
    negativeNode.inputs.text = uniqueTags(`${negativeNode.inputs.text || ''}, ${lock.negative}`);
    return body;
}

const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async function janimaSceneLockFetch(input, init = {}) {
    try {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (/\/prompt(?:\?|$)/.test(url) && String(init?.method || 'GET').toUpperCase() === 'POST' && typeof init.body === 'string') {
            const body = JSON.parse(init.body);
            init = { ...init, body: JSON.stringify(patchWorkflowBody(body)) };
        }
    } catch (error) {
        console.warn('[JANIMA V3.1] scene-lock fetch patch skipped', error);
    }
    return originalFetch(input, init);
};

function semanticBlocks(root) {
    const candidates = [...root.querySelectorAll('p, blockquote, li')]
        .filter(node => !node.closest('.janima-autocg-slot'))
        .filter(node => String(node.textContent || '').trim());
    if (candidates.length) return candidates;
    return [...root.children].filter(node => !node.matches('.janima-autocg-slot') && String(node.textContent || '').trim());
}

let relocating = false;
function relocateSlots() {
    if (relocating) return;
    relocating = true;
    try {
        document.querySelectorAll('#chat .mes .mes_text').forEach(root => {
            const blocks = semanticBlocks(root);
            if (!blocks.length) return;
            const slots = [...root.querySelectorAll(':scope > .janima-autocg-slot, .janima-autocg-slot')];
            const lastByAnchor = new Map();
            for (const slot of slots) {
                const quoteText = slot.querySelector('.janima-autocg-quote')?.textContent || '';
                const quote = quoteText.replace(/^取材[：:]\s*/, '').trim();
                if (!quote) continue;
                const matched = findBestDomAnchor(blocks, quote, blocks.length - 1);
                if (!matched || matched.contains(slot)) continue;
                const key = blocks.indexOf(matched);
                const anchor = lastByAnchor.get(key) || matched;
                if (slot.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', slot);
                lastByAnchor.set(key, slot);
            }
        });
    } finally {
        relocating = false;
    }
}

function injectSettings() {
    const root = document.querySelector('#janima_autocg_settings .inline-drawer-content');
    if (!root || root.querySelector('[data-v31-scene-lock]')) return;
    const settings = pluginSettings();
    const section = document.createElement('div');
    section.dataset.v31SceneLock = 'true';
    section.innerHTML = `
      <hr>
      <b>V3.1 人物与服装锁</b>
      <label class="checkbox_label"><input type="checkbox" data-lock-name="sceneLockEnabled">启用剧情、时代、人物与服装强制锁</label>
      <label>角色固定描述（留空自动读取正文/角色卡）<textarea class="text_pole" data-lock-name="manualCharacterLock" rows="3" placeholder="adult woman, long black hair, golden eyes, oval face"></textarea></label>
      <label>当前服装强制描述（留空自动读取当前剧情）<textarea class="text_pole" data-lock-name="manualOutfitLock" rows="3" placeholder="white hanfu, pale blue sash, silver hairpin"></textarea></label>
      <small>非校园剧情会自动排除学院装、校服、西式制服、领带和无关服装。手动填写时使用英文短标签，优先级最高。</small>`;
    root.insertBefore(section, root.querySelector('details') || null);
    section.querySelectorAll('[data-lock-name]').forEach(input => {
        const name = input.dataset.lockName;
        if (input.type === 'checkbox') input.checked = Boolean(settings[name]);
        else input.value = settings[name] || '';
        input.addEventListener('change', () => {
            settings[name] = input.type === 'checkbox' ? input.checked : input.value.trim();
            saveSettingsDebounced?.();
        });
    });
}

await import('./index-v3.js');

document.documentElement.dataset.janimaAutocgVersion = VERSION;
const observer = new MutationObserver(() => {
    queueMicrotask(() => {
        injectSettings();
        relocateSlots();
    });
});
observer.observe(document.querySelector('#chat') || document.body, { childList: true, subtree: true });
setInterval(() => {
    injectSettings();
    relocateSlots();
}, 1200);

console.info('[JANIMA Galgame 自动CG] v3.1.0 scene-lock layer loaded');
