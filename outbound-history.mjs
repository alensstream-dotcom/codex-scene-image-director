/** Internal drawing IDs belong to the local UI, never to the model's history. */
export function cleanAssistantHistory(text){
    return String(text).replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
        .replace(/image###\s*ADSCENE\s*\{[^{}]*\}\s*END\s*;?\s*###/g,'');
}
export function filterDrawingHistory(event){
    if(!Array.isArray(event?.chat))return 0;let changed=0;
    for(const message of event.chat){
        if(message?.role!=='assistant')continue;
        if(typeof message.content==='string'){
            const next=cleanAssistantHistory(message.content);if(next!==message.content){message.content=next;changed++;}
        }else if(Array.isArray(message.content))for(const part of message.content){
            if(part?.type!=='text'||typeof part.text!=='string')continue;
            const next=cleanAssistantHistory(part.text);if(next!==part.text){part.text=next;changed++;}
        }
    }
    return changed;
}
