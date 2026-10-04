import {createStoryApp} from './story-app.mjs';
import {mountLibraryPanel} from './library-panel.mjs';
import {installPlanningFilter} from './display-filter.mjs';
import {installWorkflowUpgrade} from './model-profiles.mjs';
import {installArtistBundle} from './artist-bundle.mjs';
import {filterDrawingHistory} from './outbound-history.mjs';
import {installAvsCompatibility} from './avs-compatibility.mjs';
import {ensureApiProfiles} from './api-profiles.mjs';
import {createComfyRenderer} from './comfy-transport.mjs';
import {ensureHostEventCompatibility} from './host-compat.mjs';
import {ensureRenderSettings} from './render-settings.mjs';
export async function initV2({getContext,getTools,persist,setting,notify,diagnostics,configure,installBook,worldbooks,flushBooks=async()=>{}}){
    const ctx=getContext(),events=ctx.eventSource,types=ctx.eventTypes;let app,readyPromise;
    ensureHostEventCompatibility(events);
    async function ready(){if(readyPromise)return readyPromise;readyPromise=(async()=>{
        const s=setting();s.automatic??=true;s.automatic_render??=true;s.automatic_max_images??=1;s.standard_comfy_history??=true;s.studioVersion='2.2.2';
        const native=ctx.extensionSettings['st-chatu8']||{},renderSettings=ensureRenderSettings(s,native);
        ensureApiProfiles(s,native);
        installPlanningFilter(ctx.extensionSettings);await installWorkflowUpgrade(s,renderSettings,configure);if(!renderSettings.worker)await configure(s.mainProfile);
        try{const result=installAvsCompatibility(window.TavernHelper,s);if(result.changed)diagnostics({event:'avs_compatibility_installed',scripts:result.changed});}
        catch(error){notify('AVS 兼容修复未完成：'+error.message,'warning');}
        try{await worldbooks?.initialize();}catch(error){s.worldbook_library??={version:1,active:null,books:[]};s.worldbook_read_error=true;notify('生图世界书读取失败，规则注入已停用：'+error.message,'warning');}
        app=createStoryApp({getContext,getTools,persist,setting,notify,diagnostics,renderImage:createComfyRenderer({getSettings:()=>setting().render_settings})});installArtistBundle(app,s);await app.load();app.bind();mountLibraryPanel({app,setting,notify,configure,installBook,worldbooks,saveSettings:()=>ctx.saveSettingsDebounced()});
        app.worldbooks=worldbooks;window.AnimadexStoryApp=app;await app.processLatest();ctx.saveSettingsDebounced();diagnostics({event:'extension_ready',version:'2.2.2',independent_library:true,independent_transport:true,standalone:true,automatic_flash_calls:0});
    })().catch(error=>{readyPromise=undefined;notify(error.message,'error');diagnostics({event:'init_failed',error:error.message});});return readyPromise;}
    events.makeFirst('generate-image-request',async request=>{if(app)await app.bridge(request);else if(/ADSCENE|ADCAP/.test(request.prompt||'')){request.animadexAbort='人物库还未加载，请稍后重试。';request.change='';}});
    events.on('generate-image-response',data=>app?.returned(data));
    if(types.CHAT_COMPLETION_PROMPT_READY)events.on(types.CHAT_COMPLETION_PROMPT_READY,event=>{if(setting().enabled!==false)filterDrawingHistory(event);});
    for(const type of [types.CHAT_CHANGED,types.CHAT_LOADED].filter(Boolean))events.on(type,async()=>{if(!app)return;app.cancel();try{await app.load();await app.processLatest();}catch(error){notify(error.message,'error');}});
    const completed=()=>setTimeout(()=>app?.processLatest({fresh:true}).catch(error=>notify('自动插图未准备：'+error.message,'warning')),0);
    if(types.GENERATION_ENDED)events.on(types.GENERATION_ENDED,completed);
    if(types.MESSAGE_RECEIVED)events.on(types.MESSAGE_RECEIVED,()=>{app?.refresh();completed();});
    if(types.WORLDINFO_UPDATED)events.on(types.WORLDINFO_UPDATED,(name,data)=>worldbooks?.accept(name,data));
    if(types.WORLDINFO_ENTRIES_LOADED)events.on(types.WORLDINFO_ENTRIES_LOADED,rows=>worldbooks?.filter(rows));
    if(types.GENERATION_AFTER_COMMANDS)events.on(types.GENERATION_AFTER_COMMANDS,async type=>{app?.beginGeneration(type);try{await flushBooks();await worldbooks?.refresh();delete setting().worldbook_read_error;}catch(error){setting().worldbook_read_error=true;notify('世界书未能读取，本轮生图规则已停止注入：'+error.message,'warning');}app?.anchors();});
    for(const type of [types.MESSAGE_EDITED,types.MESSAGE_SWIPED,types.MESSAGE_DELETED,types.GENERATION_STOPPED].filter(Boolean))events.on(type,id=>{app?.cancel();app?.refresh();if(type===types.MESSAGE_EDITED||type===types.MESSAGE_SWIPED){const messageId=Number.isInteger(id)?id:getContext().chat.length-1;app?.processMessage(messageId).catch(error=>notify(error.message,'warning'));}});
    events.on(types.APP_READY,ready);
}
