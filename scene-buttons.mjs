import {scenePrompt,readSceneControl,sourceHash} from './scene-planner.mjs';
/** Replace only validated persisted scene markers. Never rebuild a message's HTML. */
export function mountSceneButtons(row,{message,scenes={},onGenerate,onError=()=>{}}){
    const text=row.querySelector('.mes_text');if(!text||!message||message.is_user||message.is_system)return;
    const valid=new Map();
    for(const m of String(message.mes||'').matchAll(/image###(ADSCENE[\s\S]*?)###/g)){const c=readSceneControl(m[1]),s=scenes[c?.id];if(s&&s.message_id===Number(row.getAttribute('mesid'))&&s.swipe_id===(message.swipe_id??0)&&s.source_hash===sourceHash(message.mes)&&s.revision===c.revision)valid.set(s.id,s);}
    for(const block of text.querySelectorAll('.ad-scene-block'))if(!valid.has(block.dataset.adScene))block.remove();
    for(const[id,scene]of valid){
        let block=[...text.querySelectorAll('.ad-scene-block')].find(b=>b.dataset.adScene===id);
        if(!block){
            // Adopt existing rendered anchors during migration, then own their controls.
            const old=[...text.querySelectorAll('button[data-link]')].find(b=>readSceneControl(b.dataset.link)?.id===id);
            block=document.createElement('span');block.className='ad-scene-block';block.dataset.adScene=id;
            if(old){const media=old.nextElementSibling;if(media?.matches('span[data-request-id]'))media.remove();old.replaceWith(block);}
            else{
                const anchor=[...text.querySelectorAll('.ad-scene-anchor')].find(a=>a.dataset.adScene===id);
                if(anchor)anchor.replaceWith(block);
                else{
                    const marker='image###'+scenePrompt(id,scene.revision)+'###',walker=document.createTreeWalker(text,NodeFilter.SHOW_TEXT);let node,found;
                    while(node=walker.nextNode())if(!node.parentElement.closest('.ad-scene-block,script,style,textarea')&&node.data.includes(marker)){found=node;break;}
                    if(found){const at=found.data.indexOf(marker),tail=found.splitText(at);tail.deleteData(0,marker.length);tail.before(block);}
                    else text.append(block);
                }
            }
            const button=document.createElement('button');button.type='button';button.className='ad-render-button';button.textContent='生成图片';
            const media=document.createElement('span');media.dataset.requestId='ad-scene-'+id;block.append(button,media);
            button.onclick=()=>{try{onGenerate(id);}catch(error){onError(error);}};
        }
        const button=block.querySelector('button');button.dataset.link=scenePrompt(id,scene.revision);button.textContent=scene.images?.length?'再生成一张':'生成图片';
        const media=block.querySelector('span[data-request-id]');
        if(scene.images?.length&&!scene.hide_images&&!media.querySelector('img')){const img=document.createElement('img');img.className='ad-owned-image';img.alt='已保存的剧情图片';img.dataset.adScene=id;media.append(img);}
        if(scene.hide_images||!scene.images?.length)media.replaceChildren();
    }
}
