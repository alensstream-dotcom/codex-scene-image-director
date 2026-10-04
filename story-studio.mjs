import { createStudio } from './studio-view.mjs';
import { planScenes, locateExcerpt, sourceHash, proseOf, proseRange, insertSceneButtons, readSceneControl, scenePrompt, compileScene, SCENE_KEY } from './scene-planner.mjs';
import { prepareScenes, commitState, sceneIsCurrent, sceneRevision, CAST_KEY } from './scene-session.mjs';
import { hostChatKey as key } from './studio-persistence.mjs';
import {createManualController} from './manual-controller.mjs';
import {installSelectionMenu} from './selection-menu.mjs';
import {prepareManualScene} from './manual-scene.mjs';

/** Host adapter. Every asynchronous mutation checks the original chat and message. */
export function installStoryStudio({getContext,getResolver,persist,setting,diagnostics,notify,fetcher=fetch,viewFactory=createStudio,manualViewFactory}={}) {
    let view,active,task=null,captured=null;
    const jobs=new Map(),controllers=new Set();
    const options=()=>setting().studio??={enabled:true,auto:true,autoGenerate:false,maxScenes:3};
    const currentState=()=>getContext().chatMetadata[CAST_KEY]??={version:1,scope:crypto.randomUUID(),people:{}};
    function people(state=currentState()){return Object.values(state.people || {}).filter(p=>p.scope===state.scope);}
    function check(snapshot){
        const ctx=getContext();
        if(key(ctx)!==snapshot.chatKey||ctx.chat[snapshot.messageId]?.mes!==snapshot.raw||(ctx.chat[snapshot.messageId]?.swipe_id??0)!==snapshot.swipeId)throw new Error('聊天或正文已改变；本次准备已取消，请重新选择。');
        snapshot.signal?.throwIfAborted();return ctx;
    }
    async function prepare(snapshot){
        const ctx=check(snapshot),resolver=await getResolver();check(snapshot);snapshot.castHash=JSON.stringify(currentState());
        const plan=await planScenes(snapshot.raw,{selected:snapshot.selected,maxScenes:options().maxScenes,signal:snapshot.signal,fetcher});check(snapshot);
        const result=await prepareScenes(plan.scenes,{chat:structuredClone(ctx.chat.slice(0,snapshot.messageId+1)),messageId:snapshot.messageId,state:currentState(),resolver,signal:snapshot.signal,fetcher,historical:snapshot.messageId<ctx.chat.length-1});check(snapshot);
        diagnostics({event:'scene_plan_ready',message_id:snapshot.messageId,count:result.scenes.length});
        return result;
    }
    async function save(snapshot,staged,requested){
        const ctx=check(snapshot);
        if(snapshot.castHash&&snapshot.castHash!==JSON.stringify(currentState()))throw new Error('人物记录在准备期间改变；请重新准备镜头后保存。');
        const scenes=requested.filter(s=>!s.excluded);
        if(!scenes.length)throw new Error('没有可以保存的插图。');
        const oldMes=ctx.chat[snapshot.messageId].mes,previous=currentState();
        const store=structuredClone(ctx.chatMetadata[SCENE_KEY] || {version:1,scenes:{},messages:{}});
        const existing=Object.values(store.scenes).filter(s=>s.message_id===snapshot.messageId&&s.source_hash===sourceHash(snapshot.raw));
        // Exact same scene locations are not duplicated by repeated completion events.
        const fresh=scenes.filter(s=>!existing.some(e=>e.id!==s.id&&e.anchor===s.anchor&&e.excerpt===s.excerpt));
        if(!fresh.length)throw new Error('这段剧情已经有插图按钮。可以在本条插图中重新生成。');
        let next=oldMes;
        const inserted=[],saved=[],replacements=[];
        for(const input of fresh){
            const scene=structuredClone(input),old=store.scenes[scene.id];
            if(scene.manual)scene.style=scene.confirmed_prompt?.match(/@style:(painterly|mikko|bluearchive|rdbt|pc98)\b/)?.[1] || 'painterly';
            if(!sceneIsCurrent(scene,ctx.chat[snapshot.messageId]))throw new Error('原文已修改；请重新准备镜头。');
            if(old){
                if(input.status==='saved'){saved.push(scene);continue;}
                const prior=structuredClone(old);delete prior.history;
                scene.history=[...(old.history || []),prior];scene.revision=(old.revision || 1)+1;
                const button='image###'+scenePrompt(old.id,old.revision)+'###';
                if(!oldMes.includes(button))throw new Error('原插图按钮已改变，请重新打开本条插图。');
                replacements.push([button,'image###'+scenePrompt(scene.id,scene.revision)+'###']);
            }else{scene.revision=1;inserted.push(scene);}
            compileScene(scene,staged);
            scene.status='saved';delete scene.compiled_preview;store.scenes[scene.id]=scene;saved.push(scene);
        }
        const state=commitState(previous,staged,{historical:snapshot.messageId<ctx.chat.length-1,scenes:saved});
        next=insertSceneButtons(next,inserted);
        for(const [before,after]of replacements)next=next.replace(before,after);
        store.messages[snapshot.messageId]={source_hash:sourceHash(next),scene_ids:[...new Set([...existing.map(s=>s.id),...fresh.map(s=>s.id)])]};
        const committed=await persist({expectedKey:snapshot.chatKey,messageId:snapshot.messageId,expectedRaw:snapshot.raw,patchMetadata:{[CAST_KEY]:state,[SCENE_KEY]:store},nextMessage:next});
        if(!committed.sameChat)throw new Error('已保存到原聊天；当前已切换，请重新打开对应聊天。');
        getContext().updateMessageBlock?.(snapshot.messageId,getContext().chat[snapshot.messageId]);
        snapshot.raw=next;snapshot.selected=null;snapshot.castHash=JSON.stringify(currentState());
        diagnostics({event:'scenes_saved',message_id:snapshot.messageId,count:fresh.length});
        mountTools();return {status:'插图按钮已保存。点击“生成图片”开始绘图。',scenes:saved,people:people()};
    }
    async function generate(scene){
        if(!scene||scene.status!=='saved')throw new Error('请先保存插图按钮。');
        const ctx=getContext(),stored=ctx.chatMetadata[SCENE_KEY]?.scenes[scene.id];
        if(!stored||!sceneIsCurrent(stored,ctx.chat[stored.message_id]))throw new Error('原文已改变；请重新准备镜头。');
        // The normal native event path supplies cache/rendering and workflow selection.
        const request={id:'studio_'+crypto.randomUUID(),prompt:scenePrompt(stored.id,stored.revision),width:704,height:1152};
        await ctx.eventSource.emit('generate-image-request',request);
        if(request.animadexAbort)throw new Error(request.animadexAbort);
        if(request.animadexResult?.success===false)throw new Error(request.animadexResult.error || '绘图失败，请检查 ComfyUI 队列。');
        return {status:request.animadexResult?.success?'图片已生成，在对应剧情处查看。':'绘图请求已提交，可以关闭窗口继续剧情。'};
    }
    function ensureView(){
        if(view)return view;
        view=viewFactory({
            onPlan:async model=>{
                task?.abort();const controller=new AbortController();task=controller;controllers.add(controller);
                try{
                    const snapshot={...active,signal:controller.signal},selectedScene=model?.scenes?.[model.active];let result;
                    if(selectedScene?.manual){snapshot.selected=locateExcerpt(snapshot.raw,selectedScene.excerpt);snapshot.castHash=JSON.stringify(currentState());check(snapshot);const prepared=await prepareManualScene(snapshot,{chat:structuredClone(getContext().chat.slice(0,snapshot.messageId+1)),state:currentState(),resolver:await getResolver(),fetcher,signal:controller.signal});check(snapshot);prepared.scene.id=selectedScene.id;result={state:prepared.state,scenes:[prepared.scene]};}
                    else result=await prepare(snapshot);
                    active={...snapshot,staged:result.state};return {scenes:result.scenes,people:people(result.state),active:0,status:'镜头已准备。检查当时衣装和动作后保存。'};
                }
                finally{controllers.delete(controller);if(task===controller)task=null;}
            },
            onSave:model=>save(active,active.staged || currentState(),model.scenes),
            onGenerate:generate,
            onPersonSave:async person=>{
                const snapshot=active;check(snapshot);
                if(person.scope!==currentState().scope)throw new Error('已切换聊天，请重新打开人物管理。');
                if(snapshot.castHash!==JSON.stringify(currentState()))throw new Error('人物记录已改变，请重新打开人物管理。');
                const strings=[...(person.chosen_appearance_tags||[]),person.face_description,person.wardrobe?.description];
                if(strings.some(v=>typeof v!=='string'||v.length>1400||/[;{}@$<>]/.test(v)))throw new Error('外貌或衣装包含控制字符，请使用普通描述。');
                const ctx=getContext(),state=structuredClone(currentState()),staged=structuredClone(snapshot.staged || state);
                const entry=Object.entries(staged.people).find(([,p])=>p.person===person.person&&p.scope===state.scope);
                if(!entry)throw new Error('当前聊天中没有该人物。');
                if(JSON.stringify(person.chosen_appearance_tags)!==JSON.stringify(entry[1].chosen_appearance_tags)||person.face_description!==entry[1].face_description){person.exact_id=false;delete person.native_prompt_fields;}
                if(!['painterly','mikko','bluearchive','rdbt','pc98'].includes(person.style))throw new Error('请选择列表中的画风。');
                state.people[entry[0]]=structuredClone(person);
                staged.people[entry[0]]=structuredClone(person);
                const result=await persist({expectedKey:key(ctx),patchMetadata:{[CAST_KEY]:state}});if(!result.sameChat)throw new Error('人物已保存到原聊天，请重新打开人物管理。');
                if(active===snapshot)active={...snapshot,castHash:JSON.stringify(currentState()),staged};return {people:people(staged),status:person.person+'已保存；旧图当时衣装保留。'};
            },
            onSettings:updates=>{Object.assign(options(),updates);getContext().saveSettingsDebounced();},
            onClose:()=>{task?.abort();}
        });return view;
    }
    function open(messageId,{selected=null,tab='scene'}={}){
        const ctx=getContext(),message=ctx.chat[messageId];if(!message||message.is_user)throw new Error('请选择一条助手剧情消息。');
        if(selected)return openSelection({chatKey:key(ctx),messageId,raw:String(message.mes || ''),swipeId:message.swipe_id??0,selected});
        manual.close();selectionMenu.close();
        task?.abort();const raw=String(message.mes || '');active={chatKey:key(ctx),messageId,raw,swipeId:message.swipe_id??0,selected,castHash:JSON.stringify(currentState())};
        const scenes=Object.values(ctx.chatMetadata[SCENE_KEY]?.scenes || {}).filter(s=>s.message_id===messageId&&sceneIsCurrent(s,message));
        ensureView().open({tab,source:selected?proseOf(raw.slice(selected.start,selected.end)):proseOf(raw),messageId,selected:!!selected,scenes:selected?[]:structuredClone(scenes),people:people(),active:0,status:'先检查对应剧情，再准备或重画插图。',error:false,...options()});
    }
    function capture(){
        const selection=window.getSelection();if(!selection?.rangeCount||selection.isCollapsed)return;
        const range=selection.getRangeAt(0),start=(range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement)?.closest?.('.mes[mesid]'),end=(range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement)?.closest?.('.mes[mesid]');
        if(!start||start!==end||!start.querySelector('.mes_text')?.contains(range.commonAncestorContainer)){captured=null;return;}
        const messageId=Number(start.getAttribute('mesid')),quote=selection.toString().trim();if(!quote)return;
        const ctx=getContext(),message=ctx.chat[messageId];if(!message||message.is_user||message.is_system){captured=null;return;}
        const raw=String(message.mes || '');
        const prefixRange=range.cloneRange();prefixRange.selectNodeContents(start.querySelector('.mes_text'));prefixRange.setEnd(range.startContainer,range.startOffset);
        let selected;try{selected=locateExcerpt(raw,quote,{prefix:prefixRange.toString().slice(-160)});}catch{captured=null;return;}
        if(!proseRange(raw,selected.start,selected.end)){captured=null;return;}
        captured={messageId,quote,key:key(ctx),chatKey:key(ctx),raw,swipeId:message.swipe_id??0,selected};
    }
    function mountTools(){
        for(const node of document.querySelectorAll('.mes[mesid]')){
            const id=Number(node.getAttribute('mesid')),mounted=node.querySelector('.ad-message-tools');
            if(mounted?.dataset.messageId===String(id))continue;
            mounted?.remove();if(!getContext().chat[id]||getContext().chat[id].is_user)continue;
            if(!node.querySelector('.mes_text'))continue;
            const row=document.createElement('div');row.className='ad-message-tools';row.dataset.messageId=String(id);
            for(const [name,handler]of [['选段生图',()=>{
                capture();if(!captured||captured.messageId!==id||captured.key!==key(getContext()))throw new Error('请先在本条剧情中选中一段文字。');
                openSelection(captured);
            }],['本条插图',()=>open(id,{tab:'reply'})],['人物与衣装',()=>open(id,{tab:'people'})]]){
                const b=document.createElement('button');b.type='button';b.textContent=name;
                b.addEventListener('pointerdown',capture);b.addEventListener('click',()=>{try{handler();}catch(error){notify(error.message,'warning');}});row.append(b);
            }
            (node.querySelector('.mes_text') || node).after(row);
        }
    }
    const autoSeen=new Set();
    let autoRunning=false;
    async function autoPlan(){
        mountTools();if(!options().enabled||!options().auto||autoRunning||task)return;
        const ctx=getContext(),id=ctx.chat.length-1,message=ctx.chat[id];if(!message||message.is_user||message.is_system)return;
        const raw=String(message.mes || '');
        if(raw.includes('image###'))return; // Preserve native/user buttons. Never produce a second parallel set.
        if(ctx.streamingProcessor?.isFinished===false)return;
        const token=key(ctx)+':'+id+':'+(message.swipe_id??0)+':'+sourceHash(raw);if(autoSeen.has(token))return;autoSeen.add(token);
        const controller=new AbortController(),snapshot={chatKey:key(ctx),messageId:id,raw,swipeId:message.swipe_id??0,selected:null,signal:controller.signal};controllers.add(controller);autoRunning=true;
        let buttonsSaved=false;
        try{
            const result=await prepare(snapshot),saved=await save(snapshot,result.state,result.scenes);buttonsSaved=true;
            if(options().autoGenerate){for(const scene of saved.scenes){check(snapshot);await generate(scene);}}
            notify(options().autoGenerate?'本条剧情插图已生成。':'已准备 '+saved.scenes.length+' 个剧情插图按钮。');
        }
        catch(error){autoSeen.delete(token);diagnostics({event:'scene_auto_failed',message_id:id,error:String(error.message)});if(!controller.signal.aborted)notify((buttonsSaved?'自动绘图未完成，插图按钮已保留：':'自动插图未保存：')+error.message+' 可用选段生图重试。','warning');}
        finally{controllers.delete(controller);autoRunning=false;}
    }
    function bridge(request){
        if(!String(request.prompt || '').includes('ADSCENE'))return false;
        const ctx=getContext(),control=readSceneControl(request.prompt),scene=sceneRevision(ctx.chatMetadata[SCENE_KEY]?.scenes[control?.id],control?.revision),expectedKey=key(ctx);
        const validate=()=>{
            const now=getContext();if(key(now)!==expectedKey)return '已切换聊天，本次绘图停止。';
            if(!setting().enabled||!options().enabled)return '剧情绘图已停用，请启用后重画。';
            if(!scene||!sceneIsCurrent(scene,now.chat[scene.message_id]))return '场景记录缺失或原文已修改；请重新准备本条插图。';
            if(!String(now.chat[scene.message_id]?.mes || '').includes(scenePrompt(scene.id,scene.revision)))return '本条插图按钮已改变，请重新打开本条插图。';
            return '';
        };
        request.animadexValidate=validate;
        try{
            const reason=validate();if(reason)throw new Error(reason);
            request.change=compileScene(scene,currentState());request.castPrepared=true;request.animadexSceneReady=true;request.animadexStyle=scene.style;
            jobs.set(request.id,{scene:scene.id,key:expectedKey,messageId:scene.message_id,request,started:performance.now()});
        }catch(error){request.animadexAbort=String(error.message);request.change='';notify(request.animadexAbort,'error');}
        return true;
    }
    function returned(data){
        const job=jobs.get(data.id);if(!job)return;jobs.delete(data.id);job.request.animadexResult={success:data.success===true,error:data.error};const ctx=getContext();
        diagnostics({event:'scene_image_returned',success:data.success===true,scene_id:job.scene,elapsed_s:Math.round((performance.now()-job.started)/100)/10});
        if(key(ctx)!==job.key)return;
        ctx.updateMessageBlock?.(job.messageId,ctx.chat[job.messageId]);
        if(active?.chatKey===job.key&&active?.messageId===job.messageId)view?.update({status:data.success?'图片已生成。':'绘图失败，请检查智绘姬连接和 ComfyUI 队列。',error:!data.success});
    }
    const manual=createManualController({getContext,getState:currentState,getResolver,save,notify,diagnostics,fetcher,...(manualViewFactory?{viewFactory:manualViewFactory}:{})});
    function openSelection(snapshot){task?.abort();view?.close();selectionMenu.close();check(snapshot);return manual.open(snapshot);}
    const selectionMenu=installSelectionMenu({getSnapshot:()=>{captured=null;if(!setting().enabled||!options().enabled)return null;capture();return captured;},onGenerate:openSelection,notify});
    document.addEventListener('pointerup',()=>{try{capture();}catch{captured=null;}});
    const observer=new MutationObserver(()=>mountTools());
    const chat=document.querySelector('#chat');if(chat)observer.observe(chat,{childList:true,subtree:true,attributes:true,attributeFilter:['mesid']});
    mountTools();
    const cancel=()=>{for(const c of controllers)c.abort();task?.abort();task=null;view?.close();manual.close();selectionMenu.close();captured=null;mountTools();};
    return {bridge,autoPlan,returned,open,openSelection,refresh:mountTools,onChatChanged:cancel,onMessageChanged:cancel,options};
}
