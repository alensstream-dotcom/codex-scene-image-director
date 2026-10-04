import { getContext } from '../../../st-context.js';
import { extension_prompt_types, enqueueChatSave } from '../../../../script.js';
import { saveCharacterChatPayload, saveGroupChatPayload } from '../../../chat-payload-transport.js';
import { saveWorldInfo, updateWorldInfoList, updateWorldInfoSettings, selected_world_info } from '../../../world-info.js';
import { loadCatalog } from './catalog.mjs';
import { createIdentityResolver, readIdentityControls } from './identity.mjs';
import { bootstrapWardrobes, wardrobeText } from './wardrobe.mjs';
import { applyNativeEdits, syncNativeManagers, characterIdFor, outfitFor } from './native-manager.mjs';
import { nativePrompt, hasNativeTriggers, hasUnresolvedNativeRoles } from './native-prompt.mjs';
import { installPlanningFilter, PLANNING_REGEX, PLANNING_TAIL_REGEX } from './display-filter.mjs';
import { enhanceWithFlash, discoverWithFlash } from './flash-assistant.mjs';
import { repairInterleavedFormat } from './prompt-format.mjs';
import { installMissingNativeAIProfiles } from './native-ai-profiles.mjs';
import { installStoryStudio } from './story-studio.mjs';
import { createStudioPersistence, hostChatKey } from './studio-persistence.mjs';
import { migrateStudioState } from './studio-migration.mjs';
import { initV2 } from './v2-entry.mjs';
import { applyMainProfile, installWorkflowUpgrade } from './model-profiles.mjs';

const KEY = 'animadex_story_cast';
const META = 'animadex_cast_v1';
const BOOK = 'Animadex_剧情绘图_v2_使用指南';
const BASE = new URL('.', import.meta.url).href.replace(/\/$/, '');
let initialized = false, loading, resolver, catalog, panel, mutationChain = Promise.resolve();
let taxonomyInfo;
let studio;
const studioEnabled=()=>setting().studio?.enabled!==false;
const persist=createStudioPersistence({getContext,enqueue:enqueueChatSave,saveCharacter:saveCharacterChatPayload,saveGroup:saveGroupChatPayload});
const pending = new Map();
const scanned = new Set();
const configKeys = ['worker', 'workerid', 'MODEL_NAME', 'comfyuiCLIPName', 'comfyui_vae', 'comfyuiUrl', 'comfyui_steps', 'cfg_comfyui', 'comfyui_width', 'comfyui_height', 'comfyuisamplerName', 'comfyui_scheduler', 'yusheid_comfyui', 'UCP_comfyui','AQT_comfyui'];
const setting = () => (getContext().extensionSettings[KEY] ??= { enabled: true, diagnostics: [] });
const notify = (text, level = 'info') => window.toastr?.[level]?.(text, 'Animadex 形象库');
const read = async path => {
    const r = await fetch(`${BASE}/${path}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
};
function diagnostics(event) {
    const s = setting();
    s.diagnostics = [...(s.diagnostics || []), { time: new Date().toISOString(), ...event }].slice(-30);
    getContext().saveSettingsDebounced();
    renderStatus();
}
async function ensureCatalog() {
    if (!loading) loading = Promise.all([loadCatalog(BASE,{excludedIds:()=>setting().catalog_excluded_ids||[]}), read('data/taxonomy.json')]).then(([c, taxonomy]) => {
        catalog = c;
        taxonomyInfo = taxonomy.tags;
        resolver = createIdentityResolver(c, { taxonomy });
        diagnostics({ event: 'catalog_ready', ...c.stats });
        return c;
    }).catch(error => { loading = undefined; throw error; });
    return loading;
}
async function repairActivePromptFormat() {
    const manager=getContext().getPresetManager?.('openai');
    if (!manager) return;
    const name=manager.getSelectedPresetName();
    if (!name) return;
    if (!getContext().chatCompletionSettings) return;
    const {getChatCompletionPreset}=await import('../../../openai.js');
    const {preset,changed}=repairInterleavedFormat(getChatCompletionPreset(getContext().chatCompletionSettings));
    if (!changed) return;
    const fixedName=name+'·正文格式修复';
    await manager.savePreset(fixedName,preset);
    setting().formatFix={version:'1.0.4',previousPreset:name,selectedPreset:fixedName};
    diagnostics({event:'prompt_format_repaired',changed_blocks:changed,preset:fixedName});
}
function chatKey(ctx) { return `${ctx.groupId ?? ctx.characterId ?? 'no-character'}::${ctx.getCurrentChatId?.() ?? ctx.chatId ?? 'no-chat'}`; }
function stateFor(ctx) {
    const value = ctx.chatMetadata[META];
    return value && value.version === 1 ? value : { version: 1, scope: crypto.randomUUID(), people: {} };
}
function refreshAnchors() {
    const ctx = getContext();
    if (!setting().enabled) { ctx.setExtensionPrompt(KEY, '', extension_prompt_types.IN_CHAT, 0, false); return; }
    const state = ctx.chatMetadata[META];
    const people = Object.values(state?.people || {});
    if(studioEnabled()){
        const text='【剧情插图由本地工作台独立准备】只输出正常剧情与原有状态栏，不输出插图规划、思考占位符、image 按钮或控制 JSON。人物固定外貌不要随镜头重抽；明确换装请在正文说明。\n'+people.map(p=>`${p.person}：固定外貌 ${[...(p.chosen_appearance_tags || []),p.age_description,p.face_description].filter(Boolean).join(', ')}；最近保存衣装 ${wardrobeText(p.wardrobe) || '未规定'}。`).join('\n');
        ctx.setExtensionPrompt(KEY,text,extension_prompt_types.IN_CHAT,0,false);renderStatus();return;
    }
    const native=ctx.extensionSettings['st-chatu8'] || {};
    const anchors = people.length ? '【当前聊天人物：引用智绘姬原生角色与绑定衣装】\n' + people.map(p => {
        const id=characterIdFor(p,state.scope), role=native.characterPresets?.[id], outfit=native.outfitPresets?.[outfitFor(p.person,state.scope)];
        return `${p.person}: 角色触发 name=${JSON.stringify(role?.nameEN || p.person)}; 衣装触发 name=${JSON.stringify(outfit?.nameEN || '')}; style=${p.style || 'painterly'}`;
    }).join('\n') + '\n已保存的人物不要重新抽取形象，不另写发色、发型、眼色和衣装。使用原生 $JSON$ 触发放在 Character N Prompt 中，角色 JSON 包含 angle、upperBody、lowerBody；服装 JSON 不包含 angle。Scene Composition 写镜头、背景和光照。只有剧情明确换装时才以 ADEX clothing.action=change 更新当前衣装。只输出剧情正文和 image###…;### 按钮块，不输出插图规划或判断过程。' : '';
    ctx.setExtensionPrompt(KEY, anchors, extension_prompt_types.IN_CHAT, 0, false);
    renderStatus();
}
function syncNativeCharacters(state, focusPerson) {
    if(studioEnabled())return {stateChanged:false};
    const target = getContext().extensionSettings['st-chatu8'];
    if (!target) return;
    const s = setting();
    s.nativeLinks ??= {};
    const result = syncNativeManagers(state, target, s.nativeLinks, taxonomyInfo || {});
    const focus = result.selected.find(value => value.person === focusPerson) || result.selected.at(-1);
    window.AnimadexChatuManager?.refresh?.(focus ? { characterId:focus.character, outfitId:focus.outfit } : {});
    getContext().saveSettingsDebounced();
    return result;
}
async function restoreChatWardrobes() {
    const ctx = getContext(), key = chatKey(ctx), state = ctx.chatMetadata[META] || (studioEnabled()?stateFor(ctx):null);
    if (!state?.people) { refreshAnchors(); return; }
    if(studioEnabled()&&state.studio_migration?.version===1){refreshAnchors();return;}
    await ensureCatalog();
    if (chatKey(getContext()) !== key) return;
    const hydrated = bootstrapWardrobes(state, ctx.chat, readIdentityControls);
    const s = setting();
    s.nativeLinks ??= {};
    if(studioEnabled()){
        const migrated=migrateStudioState(hydrated.state,ctx.extensionSettings['st-chatu8'] || {},s.nativeLinks);
        if(hydrated.changed||migrated.changed)await persist({expectedKey:hostChatKey(ctx),patchMetadata:{[META]:migrated.state}});
        refreshAnchors();return;
    }
    s.visualVersionByScope ??= {};
    let styleUpgraded=false;
    if (s.visualVersionByScope[hydrated.state.scope] !== '1.0.3') {
        for (const p of Object.values(hydrated.state.people || {})) if (p.scope===hydrated.state.scope && p.style==='mikko') { p.style='painterly'; styleUpgraded=true; }
        s.visualVersionByScope[hydrated.state.scope]='1.0.3';
    }
    const edited = applyNativeEdits(hydrated.state, ctx.extensionSettings['st-chatu8'] || {}, s.nativeLinks);
    if (hydrated.changed || edited.changed || styleUpgraded) { ctx.chatMetadata[META] = edited.state; await ctx.saveMetadata(); }
    const synced=syncNativeCharacters(edited.state);
    if (synced?.stateChanged) {ctx.chatMetadata[META]=edited.state;await ctx.saveMetadata();}
    refreshAnchors();
}
function fingerprint(text) {
    let h=2166136261;
    for (const c of text) h=Math.imul(h^c.charCodeAt(0),16777619);
    return (h>>>0).toString(16)+':'+text.length;
}
async function registerLatestReply() {
    if (!setting().enabled) return;
    if(studioEnabled()){studio?.refresh();return;}
    const ctx=getContext(), key=chatKey(ctx), message=ctx.chat?.at(-1);
    if (!message || message.is_user || message.is_system) return;
    // Ignore planning copies. Process only real image button blocks, not prose
    // references to all people elsewhere in the conversation.
    const text=String(message.mes || '').replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(PLANNING_TAIL_REGEX,'').replace(PLANNING_REGEX,'');
    for (const block of text.matchAll(/image###([\s\S]*?);###/g)) {
        if (chatKey(getContext())!==key) return;
        const token=key+':'+fingerprint(block[1]);
        if (scanned.has(token) || (!block[1].includes('ADEX')&&hasNativeTriggers(block[1])&&!hasUnresolvedNativeRoles(block[1],ctx.extensionSettings['st-chatu8'] || {}))) continue;
        const request={id:'auto-'+fingerprint(block[1]),prompt:block[1],registrationOnly:true};
        try {
            await prepareImage(request);
            if (request.castPrepared) scanned.add(token);
        } catch(error) { diagnostics({event:'auto_register_failed',error:String(error.message || error)}); }
    }
}
function scheduleRestore({scan=false}={}) {
    const key=chatKey(getContext());
    const task=mutationChain.then(async()=>{if (chatKey(getContext())!==key) return;await restoreChatWardrobes();if (scan) await registerLatestReply();});
    mutationChain=task.catch(error=>diagnostics({event:'manager_sync_failed',error:String(error.message || error)}));
    return mutationChain;
}
async function configureWorkflow(profile,{activate=true}={}) {
    const ctx = getContext(), s = setting(), target = ctx.extensionSettings['st-chatu8'];
    if (!target) throw new Error('未发现智绘姬，未修改工作流');
    const chosen=typeof profile==='string'?profile:(s.mainProfile||'silvermoon_quality');
    const {config,workflow}=applyMainProfile(await read('workflow-config.json'),await read('workflow-api.json'),chosen);
    if(!activate){target.workers??={};target.workers[config.name]??=JSON.stringify(workflow,null,2);ctx.saveSettingsDebounced();return;}
    if (!s.previousComfy) s.previousComfy = Object.fromEntries(configKeys.map(k => [k, structuredClone(target[k] ?? null)]));
    if (!Object.hasOwn(s.previousComfy,'UCP_comfyui')) s.previousComfy.UCP_comfyui=structuredClone(target.UCP_comfyui??'');
    if (!Object.hasOwn(s.previousComfy,'AQT_comfyui')) s.previousComfy.AQT_comfyui=structuredClone(target.AQT_comfyui??'');
    if(chosen==='harem')config.settings.UCP_comfyui=s.previousComfy.UCP_comfyui??'';
    if(chosen==='harem')config.settings.AQT_comfyui=s.previousComfy.AQT_comfyui??'';
    // A separate named workflow preserves every existing workflow/prompt preset.
    const text = JSON.stringify(workflow, null, 2);
    target.workers ??= {};
    target.workers[config.name] = text;
    target.worker = text;
    target.workerid = config.name;
    Object.assign(target, config.settings);
    if (config.promptPreset) {
        const { name, ...values } = config.promptPreset;
        target.yushe ??= {};
        target.yushe[name] = values;
        target.yusheid_comfyui = name;
    }
    s.configuredVersion = config.version;
    s.mainProfile=chosen;
    diagnostics({ event: 'workflow_configured', worker: config.name, main_model: config.settings.MODEL_NAME, steps: config.settings.comfyui_steps });
    ctx.saveSettingsDebounced();
}
async function installBook() {
    const book = await read('worldbook.json');
    await saveWorldInfo(BOOK, book, true);
    await updateWorldInfoList();
    updateWorldInfoSettings({}, [...new Set([...selected_world_info.filter(name=>!['Animadex_剧情形象抽取_v1','Animadex_剧情绘图_v2','自动生图世界书'].includes(name)), BOOK])]);
    setting().bookInstalled = true;
    setting().bookVersion = (await read('workflow-config.json')).version;
    diagnostics({ event: 'worldbook_installed', book: BOOK });
}
async function prepareImage(request) {
    if(studio?.bridge(request))return;
    if(String(request.prompt || '').includes('ADSCENE')){request.animadexAbort='剧情绘图尚未就绪，请稍后重试。';request.change='';return;}
    if (!setting().enabled || request.isVideo || request.activeMode === 'video') return;
    let source = String(request.change || request.prompt || '');
    if (!source.includes('ADEX')&&hasNativeTriggers(source)&&!hasUnresolvedNativeRoles(source,getContext().extensionSettings['st-chatu8'] || {})) {
        await restoreChatWardrobes();
        const ctx=getContext(),converted=nativePrompt(source,stateFor(ctx),ctx.extensionSettings['st-chatu8']);
        request.change=converted.text;request.castPrepared=converted.people.length>0;
        const people=Object.values(stateFor(ctx).people).filter(p=>converted.people.includes(p.person)).map(p=>({person:p.person,prototype_id:p.prototype_id,style:p.style,wardrobe_retained:!!p.wardrobe}));
        const evidence={event:'image_prepared',id:request.id,integration_version:setting().configuredVersion,people,native_role_triggers:converted.people.length,native_enable_list:ctx.extensionSettings['st-chatu8'].characterEnablePresetId,marker_removed:true,native_existing:true};
        if (!request.registrationOnly) pending.set(request.id,{started:performance.now(),evidence});
        diagnostics(evidence);return;
    }
    const ctx = getContext(), originalChatKey = chatKey(ctx), initial = stateFor(ctx);
    await ensureCatalog();
    const hydrated = bootstrapWardrobes(initial, ctx.chat, readIdentityControls);
    const s = setting();
    s.nativeLinks ??= {};
    const edited = studioEnabled()?{state:hydrated.state,changed:false}:applyNativeEdits(hydrated.state, ctx.extensionSettings['st-chatu8'] || {}, s.nativeLinks);
    const before = edited.state;
    let visual={};
    if (s.flashEnabled !== false) {
        try {
            const discovered=!source.includes('ADEX') ? await discoverWithFlash(source,ctx.chat) : null;
            if (discovered) source=discovered.text;
            const hasBound=readIdentityControls(source).some(m=>Object.values(before.people).some(p=>p.scope===before.scope&&p.person===m.spec.person));
            const enhanced=discovered&&!hasBound?discovered:await enhanceWithFlash(source,before,ctx.chat);
            source = enhanced.text;
            visual=enhanced.visual || {};
            diagnostics({event:'flash_extracted', id:request.id, people:enhanced.count, model:enhanced.meta?.model, elapsed_s:enhanced.meta?.seconds});
        } catch (error) {
            diagnostics({event:'flash_fallback', id:request.id, error:String(error.message || error)});
        }
    }
    if (!source.includes('ADEX')) {
        diagnostics({event:'cast_unidentified',id:request.id});
        if (!request.registrationOnly) notify('本图没有明确人物标记，独立抽取也未确定姓名；已保留原提示词。','warning');
        return;
    }
    const result = resolver.resolvePrompt(source, before, { scope: before.scope });
    result.state={...before,...result.state};
    result.state.scope = before.scope;
    if (chatKey(getContext())!==originalChatKey) throw new Error('请求准备期间切换了聊天，未使用另一聊天的角色预设。');
    const synced=syncNativeCharacters(result.state,result.bindings.at(-1)?.person);
    if (result.changed || hydrated.changed || edited.changed || synced?.stateChanged) {
        result.state.scope = before.scope;
        if (chatKey(getContext()) === originalChatKey) {
            ctx.chatMetadata[META] = result.state;
            await ctx.saveMetadata();
        }
        else result.warnings.push('请求准备期间切换了聊天：本次形象未写入另一聊天。');
    }
    refreshAnchors();
    if (chatKey(getContext()) !== originalChatKey) throw new Error('请求准备期间切换了聊天，未使用另一聊天的角色预设。');
    const converted=nativePrompt(source,result.state,ctx.extensionSettings['st-chatu8'],{visual});
    // Native cache/button key remains the untouched request.prompt. Its own
    // generation handler expands the role and outfit references in change.
    request.change=studioEnabled()?result.text:converted.native?converted.text:result.text;
    request.change=request.change.replace(/\bADEX[\s\S]*?END\b/g,'');
    request.castPrepared=result.bindings.length>0;
    refreshAnchors();
    const evidence = {
        id: request.id,
        event: request.registrationOnly?'cast_registered':'image_prepared',
        integration_version: setting().configuredVersion,
        people: result.bindings.map(b => ({ person: b.person, prototype_id: b.prototype_id, style: b.style, exact_id: b.exact_id, outfit_id: b.outfit_id, wardrobe_retained:!!b.wardrobe })),
        warnings: result.warnings,
        marker_removed: !request.change.includes('ADEX'),
        native_role_triggers:converted.people.length,
        native_enable_list:ctx.extensionSettings['st-chatu8'].characterEnablePresetId,
    };
    if (!request.registrationOnly) pending.set(request.id, { started: performance.now(), evidence });
    diagnostics(evidence);
    if (result.warnings.length&&!request.registrationOnly) notify(result.warnings.map(w => typeof w === 'string' ? w : w.message).join('；'), 'warning');
}
async function imageBridge(request) {
    const task = mutationChain.then(() => prepareImage(request));
    mutationChain = task.catch(() => undefined);
    try { await task; }
    catch (error) {
        // EventEmitter catches exceptions and still calls native listeners. Remove
        // control syntax on failure, report it, and preserve the scene itself.
        request.change = String(request.change || request.prompt || '').replace(/\bADEX[\s\S]*?END\b/g, '');
        diagnostics({ event: 'prepare_failed', id: request.id, error: String(error.message || error) });
        notify('形象库处理失败，本次沿用剧情提示词：' + String(error.message || error), 'error');
    }
}
function imageResult(data) {
    studio?.returned(data);
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    diagnostics({ event: 'image_returned', id: data.id, success: data.success === true, elapsed_s: Math.round((performance.now() - item.started) / 100) / 10, has_image: !!data.imageData });
}
function renderStatus() {
    if (!panel) return;
    const s = setting(), ctx = getContext();
    panel.querySelector('[data-status]').textContent = catalog ? `${catalog.stats.characters.toLocaleString()} 个形象 / ${catalog.stats.outfits.toLocaleString()} 套服装，离线检索已就绪` : '形象库已安装；第一次抽取时加载，无需辅助 AI 整理标签。';
    const list = panel.querySelector('[data-people]');
    list.replaceChildren();
    for (const person of Object.values(ctx.chatMetadata[META]?.people || {})) {
        const li = document.createElement('li');
        li.textContent = `${person.person} → ${person.prototype_id || '按剧情外貌'} · ${person.style || 'painterly'} · 当前衣装：${wardrobeText(person.wardrobe) || '未指定'}`;
        list.append(li);
    }
    const last = s.diagnostics?.at(-1);
    panel.querySelector('[data-last]').textContent = last ? `最近状态：${last.event}${last.elapsed_s ? ` / ${last.elapsed_s}s` : ''}${last.success === false ? ' / 未成功' : ''}` : '等待第一次生图验证';
}
function mountPanel() {
    const parent = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!parent || panel) return;
    panel = document.createElement('details');
    panel.className = 'animadex-cast-panel';
    panel.innerHTML = '<summary>剧情绘图工作台</summary><p data-status></p><p>每条剧情旁可选段生图、检查本条插图、管理人物与衣装。自动准备插图按钮不占 GPU。</p><ul data-people></ul><p data-last></p><button type="button" class="menu_button" data-open>打开剧情绘图</button><button type="button" class="menu_button" data-load>加载形象库</button><button type="button" class="menu_button" data-apply>使用已实测主工作流</button><button type="button" class="menu_button" data-book>更新剧情插图说明</button>';
    panel.querySelector('[data-open]').addEventListener('click',()=>{try{studio?.open(getContext().chat.length-1,{tab:'reply'});}catch(error){notify(error.message,'warning');}});
    parent.append(panel);
    for (const [selector, operation] of [['[data-load]', ensureCatalog], ['[data-apply]', configureWorkflow], ['[data-book]', installBook]]) {
        panel.querySelector(selector).addEventListener('click', async event => {
            event.currentTarget.disabled = true;
            try { await operation(); renderStatus(); notify('已完成'); }
            catch (error) { notify(String(error.message || error), 'error'); }
            finally { event.currentTarget.disabled = false; }
        });
    }
    renderStatus();
}
export async function init() {
    // The v2 entry is initialized below. Never register the obsolete studio hooks.
    return;
    if (initialized) return;
    initialized = true;
    const ctx = getContext(), events = ctx.eventSource, types = ctx.eventTypes;
    events.makeFirst('generate-image-request', imageBridge);
    events.on('generate-image-response', imageResult);
    for (const name of [types.CHAT_CHANGED, types.CHAT_LOADED].filter(Boolean)) events.on(name,()=>{studio?.onChatChanged();return scheduleRestore({scan:true});});
    if (types.GENERATION_AFTER_COMMANDS) events.on(types.GENERATION_AFTER_COMMANDS,()=>scheduleRestore());
    if(types.MESSAGE_RECEIVED)events.on(types.MESSAGE_RECEIVED,()=>{studio?.refresh();if(!studioEnabled())return scheduleRestore({scan:true});});
    if(types.GENERATION_ENDED)events.on(types.GENERATION_ENDED,()=>{if(studioEnabled()){setTimeout(()=>{if(setting().enabled)studio?.autoPlan();},0);}else return scheduleRestore({scan:true});});
    for(const name of [types.MESSAGE_EDITED,types.MESSAGE_SWIPED,types.MESSAGE_DELETED,types.GENERATION_STOPPED].filter(Boolean))events.on(name,()=>studio?.onMessageChanged());
    window.addEventListener?.('animadex-chatu8-manager-saved', () => {
        if(!studioEnabled())scheduleRestore();
    });
    const ready = async () => {
        mountPanel();
        try {
            const config = await read('workflow-config.json');
            if(studioEnabled()&&window.AnimadexSceneTransportVersion!=='1')throw new Error('剧情绘图发送保护尚未加载，请重新打开酒馆。');
            if(studioEnabled()){
                const native=ctx.extensionSettings['st-chatu8'];
                setting().previousNativeAutomation??=Object.fromEntries(['autoLLMImageGen','enablePregen','zidongdianji','zidongdianji2'].map(k=>[k,native?.[k]??null]));
                if(native)Object.assign(native,{autoLLMImageGen:'false',enablePregen:'false',zidongdianji:'false',zidongdianji2:'false'});
            }
            const displayChanged = installPlanningFilter(ctx.extensionSettings);
            await repairActivePromptFormat();
            ctx.saveSettingsDebounced();
            await installWorkflowUpgrade(setting(),ctx.extensionSettings['st-chatu8']||{},configureWorkflow);
            if (setting().studioBookVersion !== '1.1.0'&&studioEnabled()){await installBook();setting().studioBookVersion='1.1.0';}
            else if(!studioEnabled()&&setting().bookVersion!==config.version)await installBook();
            const nativeAI=installMissingNativeAIProfiles(ctx.extensionSettings['st-chatu8']);
            if (nativeAI.changed) diagnostics({event:'native_ai_contexts_repaired',...nativeAI});
            await restoreChatWardrobes();
            if(studioEnabled())studio=installStoryStudio({getContext,getResolver:async()=>{await ensureCatalog();return resolver;},persist,setting,diagnostics,notify});
            await registerLatestReply();
            if (displayChanged) await ctx.reloadCurrentChat?.();
            setting().studioVersion='1.2.0';
            diagnostics({ event: 'extension_ready', version: '1.2.0', transport_guard:window.AnimadexSceneTransportVersion || null });
        } catch (error) { diagnostics({ event: 'init_failed', error: String(error.message || error) }); notify(String(error.message || error), 'error'); }
    };
    // APP_READY is an auto-fired event in the supported Tauri/ST host.
    events.on(types.APP_READY, ready);
}
await initV2({getContext,getTools:async()=>{await ensureCatalog();return {catalog,resolver,taxonomy:taxonomyInfo};},persist,setting,notify,diagnostics,configure:configureWorkflow,installBook});
