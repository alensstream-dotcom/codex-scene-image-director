import {prepareManualScene} from './manual-scene.mjs';
import {createManualView} from './manual-view.mjs';
import {proseOf,SCENE_KEY,validateConfirmedPrompt} from './scene-planner.mjs';
import {hostChatKey} from './studio-persistence.mjs';

export function createManualController({getContext,getState,getResolver,save,notify,diagnostics,fetcher=fetch,viewFactory=createManualView}={}){
    let view,snapshot,controller,session=0,closed=true;
    function check(target){
        const ctx=getContext();
        if(closed||!target||target.session!==session||hostChatKey(ctx)!==target.chatKey||ctx.chat[target.messageId]?.mes!==target.raw||(ctx.chat[target.messageId]?.swipe_id??0)!==target.swipeId)throw new Error('聊天或正文已改变，请重新选择剧情。');
        target.signal?.throwIfAborted();return ctx;
    }
    async function prepare(){
        controller?.abort();const pending=new AbortController();controller=pending;const target={...snapshot,signal:pending.signal};
        try{
        const ctx=check(target),state=structuredClone(getState());target.castHash=JSON.stringify(state);
        const resolver=await getResolver();check(target);
        const result=await prepareManualScene(target,{chat:structuredClone(ctx.chat.slice(0,target.messageId+1)),state,resolver,fetcher,signal:target.signal});check(target);
        if(target.castHash!==JSON.stringify(getState()))throw new Error('人物记录已改变，请重新生成 tags。');
        snapshot=target;diagnostics?.({event:'manual_tags_ready',message_id:target.messageId,api_calls:1});return result;
        }finally{if(controller===pending)controller=null;}
    }
    function ensureView(){
        return view??=viewFactory({onPrepare:prepare,onClose:()=>{closed=true;controller?.abort();},onConfirm:async result=>{
            const target=snapshot;check(target);validateConfirmedPrompt(result.scene.confirmed_prompt);
            const scene={...structuredClone(result.scene),status:'draft'};
            // Reselecting the same passage updates its button instead of duplicating it.
            const old=Object.values(getContext().chatMetadata[SCENE_KEY]?.scenes || {}).find(s=>s.manual&&s.message_id===target.messageId&&s.source_hash===scene.source_hash&&s.excerpt===scene.excerpt);
            if(old)scene.id=old.id;
            await save(target,result.state,[scene]);
            diagnostics?.({event:'manual_button_saved',message_id:target.messageId});notify?.('图片按钮已生成，点击正文中的按钮开始绘图。');
        }});
    }
    return {open(target){controller?.abort();session++;closed=false;snapshot={...target,session};check(snapshot);return ensureView().open({excerpt:proseOf(target.raw.slice(target.selected.start,target.selected.end))});},close(){closed=true;controller?.abort();view?.close();},destroy(){closed=true;controller?.abort();view?.destroy();}};
}
