/** Wait until selection settles. No model call until the user chooses an action. */
export function installSelectionMenu({getSnapshot,onGenerate,notify,delay=220}={}){
    if(typeof document.createElement!=='function')return {close(){},destroy(){}};
    const menu=document.createElement('div');menu.className='ad-selection-menu';menu.hidden=true;menu.setAttribute('role','dialog');menu.setAttribute('aria-label','选择操作');
    const title=document.createElement('strong');title.textContent='选择操作';
    const generate=document.createElement('button');generate.type='button';generate.textContent='图片生成';generate.setAttribute('aria-label','图片生成');
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';
    menu.append(title,generate,cancel);document.body.append(menu);
    let timer,selecting=false,snapshot=null,capturedAt=0,selectionRect=null,dismissed='';
    const close=()=>{clearTimeout(timer);menu.hidden=true;};
    function schedule(){
        clearTimeout(timer);if(selecting||document.querySelector('dialog[open]'))return close();
        const selected=window.getSelection();
        if(selected?.rangeCount&&!selected.isCollapsed){
            try{const next=getSnapshot();if(!next)return close();snapshot=next;capturedAt=Date.now();selectionRect=selected.getRangeAt(0).getBoundingClientRect();}catch{return close();}
        }else if(!snapshot||Date.now()-capturedAt>1500)return close();
        timer=setTimeout(()=>{
            try{
                if(!snapshot||!selectionRect){close();return;}
                const token=snapshot.chatKey+':'+snapshot.messageId+':'+snapshot.selected.start+':'+snapshot.selected.end;
                if(token===dismissed)return;
                const rect=selectionRect;
                menu.hidden=false;
                const width=menu.offsetWidth,height=menu.offsetHeight;
                const viewport=window.visualViewport,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,vw=viewport?.width||window.innerWidth,vh=viewport?.height||window.innerHeight;
                menu.style.left=Math.max(left+8,Math.min(left+vw-width-8,rect.right-width/2))+'px';
                menu.style.top=Math.max(top+8,Math.min(top+vh-height-80,rect.bottom+12))+'px';
            }catch(error){close();}
        },delay);
    }
    const down=e=>{if(menu.contains(e.target))return;if(e.target.closest?.('#chat .mes_text'))selecting=e.pointerType!=='touch';close();};
    const up=()=>{selecting=false;schedule();};
    const key=e=>{if(e.key==='Escape'){if(snapshot)dismissed=snapshot.chatKey+':'+snapshot.messageId+':'+snapshot.selected.start+':'+snapshot.selected.end;close();}else schedule();};
    const selectionAction=e=>{
        if(!e.target.closest?.('#chat .mes_text')||window.getSelection()?.isCollapsed)return;
        try{if(!getSnapshot())return;}catch{return;}
        // Native chatu8 also opens its action menu on double-click/triple-tap.
        // A valid prose selection belongs to this menu; other native triggers remain.
        e.stopImmediatePropagation();selecting=false;schedule();
    };
    menu.addEventListener('pointerdown',e=>e.preventDefault());
    generate.addEventListener('click',()=>{const target=snapshot;close();try{onGenerate(target);}catch(error){notify?.(error.message,'warning');}});
    cancel.addEventListener('click',()=>{if(snapshot)dismissed=snapshot.chatKey+':'+snapshot.messageId+':'+snapshot.selected.start+':'+snapshot.selected.end;close();});
    document.addEventListener('pointerdown',down);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',up);document.addEventListener('touchend',up,{passive:true});document.addEventListener('selectionchange',schedule);document.addEventListener('keyup',key);document.addEventListener('dblclick',selectionAction,true);document.addEventListener('touchend',selectionAction,{capture:true,passive:true});
    return {close(){close();snapshot=null;},getSnapshot:()=>Date.now()-capturedAt<30000?snapshot:null,destroy(){close();menu.remove();document.removeEventListener('pointerdown',down);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);document.removeEventListener('touchend',up);document.removeEventListener('selectionchange',schedule);document.removeEventListener('keyup',key);document.removeEventListener('dblclick',selectionAction,true);document.removeEventListener('touchend',selectionAction,true);}};
}
