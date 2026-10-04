/** A small review dialog: explanation above, editable native tags below. */
export function createManualView({host=document.body,onPrepare,onConfirm,onClose}={}){
    const dialog=document.createElement('dialog');dialog.className='ad-manual';dialog.setAttribute('aria-label','选段图片生成');host.append(dialog);
    let epoch=0,busy=false,result=null;
    const element=(tag,text,attrs={})=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
    const button=(text,fn,primary=false)=>{const b=element('button',text,{type:'button',class:primary?'ad-primary':''});b.addEventListener('click',fn);return b;};
    const heading=element('header');heading.append(element('h2','图片生成'));
    const cancel=button('取消',()=>dialog.close()),source=element('blockquote','',{class:'ad-manual-source'});
    const sourceDetails=element('details');sourceDetails.append(element('summary','选中的剧情'),source);
    const body=element('div','',{class:'ad-manual-body'}),summary=element('p','正在整理选中的剧情。',{class:'ad-manual-summary'});
    const tags=element('textarea',undefined,{rows:'9','aria-label':'最终 tags',spellcheck:'false',placeholder:'生成后的图片 tags 会显示在这里，可直接修改。'});
    const label=element('label','最终 tags',{class:'ad-manual-tags'});label.append(tags);
    const note=element('p','修改后以 tags 为准。确定后在选段末尾生成图片按钮。',{class:'ad-manual-note'});
    const status=element('p','',{role:'status','aria-live':'polite',class:'ad-manual-status'});
    async function perform(fn,{confirm=false}={}){
        if(busy)return;const turn=epoch;busy=true;status.setAttribute('role','status');status.textContent=confirm?'正在保存图片按钮。':'正在整理这段剧情。';sync();
        try{
            const update=await fn();if(turn!==epoch)return;
            if(confirm){dialog.close();return;}
            result=update;summary.textContent=update.scene.summary;tags.value=update.scene.confirmed_prompt;status.textContent='检查动作与场景，可以修改 tags 后确定。';
        }catch(error){if(turn===epoch){status.setAttribute('role','alert');status.textContent=String(error.message || error);if(!result)summary.textContent='选段整理未完成。检查下方提示后点击重新生成。';}}
        finally{if(turn===epoch){busy=false;sync();}}
    }
    const correction=element('textarea',undefined,{rows:'2','aria-label':'纠正要求（可选）',placeholder:'可选：说明需要纠正的动作或场景。人物外貌会保留。'});
    const regenerate=button('重新生成',()=>perform(()=>onPrepare(correction.value)));
    const confirm=button('确定生成',()=>perform(()=>onConfirm({...result,scene:{...structuredClone(result.scene),confirmed_prompt:tags.value,tags_user_edited:!!result.scene.tags_user_edited||tags.value!==result.scene.confirmed_prompt}}),{confirm:true}),true);
    function sync(){regenerate.disabled=busy;confirm.disabled=busy||!result||!tags.value.trim();tags.disabled=busy;dialog.setAttribute('aria-busy',String(busy));}
    tags.addEventListener('input',sync);
    const actions=element('footer');actions.append(cancel,regenerate,confirm);
    body.append(sourceDetails,element('h3','将绘制的动作与场景'),summary,label,element('label','纠正要求（可选）'),correction,note,status);dialog.append(heading,body,actions);
    dialog.addEventListener('close',()=>{epoch++;busy=false;onClose?.();dialog.remove();});
    return {dialog,open(snapshot,initialResult){epoch++;busy=false;result=initialResult||null;correction.value='';source.textContent=snapshot.excerpt;summary.textContent=result?.scene.summary||'正在整理选中的剧情。';tags.value=result?.scene.confirmed_prompt||'';status.textContent=result?'修改 tags 后确认即可重画。':'';sync();if(!dialog.isConnected)host.append(dialog);if(!dialog.open)dialog.showModal();return result?Promise.resolve(result):perform(()=>onPrepare(''));},close(){dialog.close();},destroy(){dialog.remove();}};
}
