import {createStoryApp} from './story-app.mjs';
import {mountLibraryPanel} from './library-panel.mjs';
import {installPlanningFilter} from './display-filter.mjs';
import {installWorkflowUpgrade} from './model-profiles.mjs';
import {installArtistBundle} from './artist-bundle.mjs';
import {filterDrawingHistory} from './outbound-history.mjs';
import {installAvsCompatibility} from './avs-compatibility.mjs';
export async function initV2({getContext,getTools,persist,setting,notify,diagnostics,configure,installBook}){
    const ctx=getContext(),events=ctx.eventSource,types=ctx.eventTypes;let app,readyPromise;
    async function ready(){if(readyPromise)return readyPromise;readyPromise=(async()=>{
        const s=setting();s.automatic??=true;s.automatic_render??=true;s.automatic_max_images??=1;s.standard_comfy_history??=true;s.studioVersion='2.1.9';
        if(window.AnimadexLibraryTransportVersion!=='2')throw new Error('新版图片传输还未加载，请重开酒馆。');
        const native=ctx.extensionSettings['st-chatu8'];if(!native)throw new Error('请先启用智绘姬。');
        s.previousNativeAutomation??=Object.fromEntries(['autoLLMImageGen','enablePregen','zidongdianji','zidongdianji2'].map(k=>[k,native[k]??null]));
        Object.assign(native,{autoLLMImageGen:'false',enablePregen:'false',zidongdianji:'false',zidongdianji2:'false'});
        installPlanningFilter(ctx.extensionSettings);await installWorkflowUpgrade(s,native,configure);
        try{const result=installAvsCompatibility(window.TavernHelper,s);if(result.changed)diagnostics({event:'avs_compatibility_installed',scripts:result.changed});}
        catch(error){notify('AVS 兼容修复未完成：'+error.message,'warning');}
        if(s.automaticBookVersion!=='2.1.4'){try{await installBook();s.automaticBookVersion='2.1.4';}catch(error){notify('世界书安装失败，插件仍会注入自动插图格式：'+error.message,'warning');}}
        app=createStoryApp({getContext,getTools,persist,setting,notify,diagnostics});installArtistBundle(app,s);await app.load();app.bind();mountLibraryPanel({app,setting,notify,configure,installBook,saveSettings:()=>ctx.saveSettingsDebounced()});
        window.AnimadexStoryApp=app;await app.processLatest();ctx.saveSettingsDebounced();diagnostics({event:'extension_ready',version:'2.1.9',independent_library:true,automatic_flash_calls:0});
    })().catch(error=>{readyPromise=undefined;notify(error.message,'error');diagnostics({event:'init_failed',error:error.message});});return readyPromise;}
    events.makeFirst('generate-image-request',async request=>{if(app)await app.bridge(request);else if(/ADSCENE|ADCAP/.test(request.prompt||'')){request.animadexAbort='人物库还未加载，请稍后重试。';request.change='';}});
    events.on('generate-image-response',data=>app?.returned(data));
    if(types.CHAT_COMPLETION_PROMPT_READY)events.on(types.CHAT_COMPLETION_PROMPT_READY,event=>{if(setting().enabled!==false)filterDrawingHistory(event);});
    for(const type of [types.CHAT_CHANGED,types.CHAT_LOADED].filter(Boolean))events.on(type,async()=>{if(!app)return;app.cancel();try{await app.load();await app.processLatest();}catch(error){notify(error.message,'error');}});
    const completed=()=>setTimeout(()=>app?.processLatest({fresh:true}).catch(error=>notify('自动插图未准备：'+error.message,'warning')),0);
    if(types.GENERATION_ENDED)events.on(types.GENERATION_ENDED,completed);
    if(types.MESSAGE_RECEIVED)events.on(types.MESSAGE_RECEIVED,()=>{app?.refresh();completed();});
    if(types.GENERATION_AFTER_COMMANDS)events.on(types.GENERATION_AFTER_COMMANDS,type=>{app?.beginGeneration(type);app?.anchors();});
    for(const type of [types.MESSAGE_EDITED,types.MESSAGE_SWIPED,types.MESSAGE_DELETED,types.GENERATION_STOPPED].filter(Boolean))events.on(type,id=>{app?.cancel();app?.refresh();if(type===types.MESSAGE_EDITED||type===types.MESSAGE_SWIPED){const messageId=Number.isInteger(id)?id:getContext().chat.length-1;app?.processMessage(messageId).catch(error=>notify(error.message,'warning'));}});
    events.on(types.APP_READY,ready);
}
