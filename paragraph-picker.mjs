import {proseOf,locateExcerpt,proseRange} from './scene-planner.mjs';

/** Remove hidden protocol before listing paragraphs; offsets still point into the original reply. */
export function paragraphChoices(raw){
    const choices=[];let after=0;
    for(const part of proseOf(raw).split(/\n\s*\n/)){
        const text=part.replace(/<[^>]*>/g,'').trim();if(!text)continue;
        try{let exact=raw.indexOf(text,after);while(exact>=0&&!proseRange(raw,exact,exact+text.length))exact=raw.indexOf(text,exact+text.length);const location=exact>=0?{start:exact,end:exact+text.length}:locateExcerpt(raw,text);if(!proseRange(raw,location.start,location.end))continue;choices.push({...location,text});after=location.end;}catch{}
    }
    return choices;
}
export function openParagraphPicker(snapshot,{onChoose,onClose}={}){
    const d=document.createElement('dialog');d.className='ad-manual ad-paragraph-picker';d.setAttribute('aria-label','选择绘图段落');
    const head=document.createElement('header'),title=document.createElement('h2');title.textContent='选择绘图段落';head.append(title);
    const body=document.createElement('div');body.className='ad-manual-body';const note=document.createElement('p');note.textContent='点选这条回复中的剧情段落。选择后才会整理图片 tags。';body.append(note);
    const choices=paragraphChoices(snapshot.raw);let busy=false;
    for(const choice of choices){const b=document.createElement('button');b.type='button';b.className='ad-paragraph-choice';b.textContent=choice.text;b.onclick=async()=>{if(busy)return;busy=true;d.close();await onChoose({...snapshot,selected:{start:choice.start,end:choice.end},excerpt:snapshot.raw.slice(choice.start,choice.end)});};body.append(b);}
    if(!choices.length){const empty=document.createElement('p');empty.textContent='没有可识别的剧情段落，请在正文中直接选中文字。';body.append(empty);}
    const footer=document.createElement('footer'),cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.onclick=()=>d.close();footer.append(cancel);d.append(head,body,footer);d.onclose=()=>{onClose?.();d.remove();};document.body.append(d);d.showModal();return {close:()=>d.close()};
}
