/** The host's shared save queue plus immutable target prevents cross-chat writes. */
export const hostChatKey=ctx=>`${ctx.groupId??ctx.characterId??''}::${ctx.getCurrentChatId?.()??ctx.chatId??''}`;
export function createStudioPersistence({getContext,enqueue,saveCharacter,saveGroup}) {
    return function persist({expectedKey,messageId,expectedRaw,patchMetadata={},nextMessage}) {
        return enqueue(async()=>{
            const ctx=getContext();
            if(hostChatKey(ctx)!==expectedKey||(messageId!==undefined&&ctx.chat[messageId]?.mes!==expectedRaw))throw new Error('聊天或正文已改变；未保存本次结果。');
            const target=ctx.groupId?{group:true,id:ctx.chatId}:{...ctx.characters?.[ctx.characterId],fileName:ctx.chatId};
            if(!target.id&&!target.fileName)throw new Error('当前没有可保存的聊天文件。');
            const metadata=ctx.chatMetadata;
            const oldFields=Object.fromEntries(Object.keys(patchMetadata).map(k=>[k,{present:Object.hasOwn(metadata,k),value:metadata[k]}]));
            const message=messageId===undefined?null:ctx.chat[messageId];
            const oldMes=message?.mes,swipe=message?.swipe_id??0,oldSwipe=message?.swipes?.[swipe];
            Object.assign(metadata,structuredClone(patchMetadata));
            if(nextMessage!==undefined){message.mes=nextMessage;if(message.swipes?.[swipe]!==undefined)message.swipes[swipe]=nextMessage;}
            const savedMetadata=structuredClone(metadata);delete savedMetadata.lastInContextMessageId;
            const payload=[{user_name:'unused',character_name:'unused',chat_metadata:savedMetadata},...structuredClone(ctx.chat)];
            try{
                if(target.group)await saveGroup({id:target.id,payload});
                else await saveCharacter({characterName:target.name,avatarUrl:target.avatar,fileName:target.fileName,payload});
            }catch(error){
                // Roll back the original objects only; a newly opened chat is never touched.
                for(const [k,old]of Object.entries(oldFields))if(JSON.stringify(metadata[k])===JSON.stringify(patchMetadata[k])){if(old.present)metadata[k]=old.value;else delete metadata[k];}
                if(message&&nextMessage!==undefined&&message.mes===nextMessage){message.mes=oldMes;if(message.swipes?.[swipe]!==undefined)message.swipes[swipe]=oldSwipe;}
                throw new Error('聊天保存失败，本次修改已恢复；请检查酒馆保存状态后重试。');
            }
            return {sameChat:hostChatKey(getContext())===expectedKey};
        });
    };
}
