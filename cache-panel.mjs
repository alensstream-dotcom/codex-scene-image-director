import {cachePage,importLegacyCache} from './image-cache.mjs';
import {imageZip} from './image-zip.mjs';
import {recipeDescription} from './generation-recipe.mjs';
const e=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const size=n=>n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';
const download=(blob,name)=>{const url=URL.createObjectURL(blob),a=e('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
export function mountCachePanel({host,app,notify}){
    const pane=e('section',undefined,{class:'ad-cache',role:'region','aria-label':'图片缓存管理'}),toolbar=e('div',undefined,{class:'ad-cache-toolbar'}),grid=e('div',undefined,{class:'ad-cache-grid'}),status=e('p','',{role:'status','aria-live':'polite'}),pagination=e('div',undefined,{class:'ad-cache-pagination'});
    const scope=e('select',undefined,{'aria-label':'图片范围'}),person=e('select',undefined,{'aria-label':'筛选图片人物'}),search=e('input',undefined,{type:'search',placeholder:'搜索人物或日期','aria-label':'搜索缓存图片'});
    for(const[value,label]of[['all','全部图片'],['current','当前聊天'],['reference','人物参考'],['legacy','迁入的旧图片']])scope.append(e('option',label,{value}));
    let records=[],page=1,epoch=0,selectionMode=false,busy=false,preview;const selected=new Set();
    const action=(text,fn)=>{const b=e('button',text,{type:'button','aria-label':text});b.onclick=async()=>{if(busy)return;busy=true;b.disabled=true;try{await fn();}catch(error){notify(error.message,'error');status.textContent=error.message;}finally{busy=false;b.disabled=false;if(b===prev)b.disabled=page<=1;if(b===next)b.disabled=page>=filtered().pages;}};return b;};
    const filtered=()=>cachePage(records,{scope:scope.value,storyId:app.getStory()?.id||'',person:person.value,query:search.value,page});
    const selection=action('多选',()=>{selectionMode=!selectionMode;selection.textContent=selectionMode?'结束多选':'多选';if(!selectionMode)selected.clear();draw();});
    const selectAll=action('全选',()=>{selectionMode=true;selection.textContent='结束多选';for(const id of filtered().ids)selected.add(id);draw();}),selectPage=action('全选本页',()=>{selectionMode=true;selection.textContent='结束多选';for(const item of filtered().items)selected.add(item.id);draw();}),none=action('取消全选',()=>{selected.clear();draw();});
    const chosen=()=>{if(!selected.size)throw new Error('请先选择图片。');return [...selected];};
    const save=action('下载选中',async()=>{const ids=chosen(),total=records.filter(r=>selected.has(r.id)).reduce((n,r)=>n+r.bytes,0);if(total>268435456)throw new Error('这批图片超过 256 MB，请分批下载。');status.textContent='正在打包 '+ids.length+' 张图片…';const assets=[];for(const id of ids){const asset=await app.library.getAsset(id);if(asset)assets.push(asset);}if(!assets.length)throw new Error('所选图片已不存在，请刷新。');download(imageZip(assets),'剧情绘图图片_'+new Date().toISOString().slice(0,10)+'.zip');status.textContent='已打包 '+assets.length+' 张图片。';});
    const remove=action('删除选中',()=>{
        const ids=chosen(),d=e('dialog',undefined,{class:'ad-manual','aria-label':'删除缓存图片'}),body=e('div',undefined,{class:'ad-manual-body'}),footer=e('footer');
        body.append(e('h2','删除 '+ids.length+' 张缓存图片？'),e('p','会同时移除聊天中的对应图片记录。正在用作人物参考的图片会保留；智绘姬原缓存不受影响。'));
        const cancel=action('取消',()=>d.close()),confirm=action('确认删除',async()=>{const result=await app.deleteCachedAssets(ids);selected.clear();d.close();await refresh();status.textContent='已删除 '+result.deleted+' 张'+(result.protected.length?'；保留 '+result.protected.length+' 张人物参考':'')+'。';});footer.append(cancel,confirm);d.append(body,footer);document.body.append(d);d.onclose=()=>d.remove();d.showModal();
    });remove.className='ad-danger';
    const calculate=action('计算大小',()=>{const view=filtered(),chosenBytes=records.filter(r=>selected.has(r.id)).reduce((n,r)=>n+r.bytes,0);status.textContent='当前筛选 '+size(view.bytes)+'；已选 '+size(chosenBytes)+'。';}),rebuild=action('全部重算',async()=>{status.textContent='正在重算大小并补全缩略图…';const result=await app.library.rebuildAssetMetadata();await refresh();status.textContent='已重算 '+result.count+' 张图片，共 '+size(result.bytes)+'。';});
    const migrate=action('导入智绘姬历史图片',async()=>{status.textContent='正在读取旧缓存…';const result=await importLegacyCache(app.library,{onProgress:r=>{status.textContent='已迁入 '+r.added+' 张图片…';}});await refresh();status.textContent='迁入 '+result.added+' 张，已存在 '+result.existing+' 张，跳过 '+result.skipped+' 条缺失或视频记录。原缓存保留。';});
    toolbar.append(selection,selectAll,selectPage,none,save,remove,calculate,rebuild,migrate);const filters=e('div',undefined,{class:'ad-cache-filters'});filters.append(scope,person,search);
    const prev=action('上一页',()=>{page--;draw();}),next=action('下一页',()=>{page++;draw();}),pageLabel=e('span');pagination.append(prev,pageLabel,next);
    function draw(){const turn=++epoch,view=filtered();page=view.page;grid.replaceChildren();prev.disabled=page<=1;next.disabled=page>=view.pages;pageLabel.textContent=page+' / '+view.pages+' · '+view.total+' 张 · 已选 '+selected.size+' 张';
        for(const record of view.items){const card=e('article',undefined,{class:'ad-cache-card'}),open=e('button',undefined,{type:'button',class:'ad-cache-preview','aria-label':'查看缓存图片 '+record.id}),img=e('img',undefined,{alt:(record.people?.join('、')||'剧情图片')+' · '+record.created_at,loading:'lazy'}),check=e('input',undefined,{type:'checkbox','aria-label':'选择图片 '+record.id});check.hidden=!selectionMode;check.checked=selected.has(record.id);check.onchange=()=>{if(check.checked)selected.add(record.id);else selected.delete(record.id);draw();};
            card.dataset.assetId=record.id;card.classList.toggle('is-selected',selected.has(record.id));open.append(img);open.onclick=()=>{if(selectionMode){if(selected.has(record.id))selected.delete(record.id);else selected.add(record.id);draw();}else showPreview(record.id).catch(error=>notify(error.message,'error'));};
            card.append(check,open,e('time',new Date(record.created_at||0).toLocaleString(),{datetime:record.created_at||''}),e('span',(record.people?.join('、')||'图片')+' · '+size(record.bytes),{class:'ad-cache-caption'}));grid.append(card);
            if(record.thumbnail)img.src=record.thumbnail;else app.library.getAsset(record.id).then(asset=>{if(turn===epoch&&asset&&img.isConnected)img.src=asset.data;}).catch(()=>{});
        }if(!view.total)grid.append(e('p','当前筛选下还没有缓存图片。'));
    }
    async function refresh(){records=await app.library.listAssetMetadata();const current=person.value;person.replaceChildren(e('option','所有人物',{value:''}),...[...new Set(records.flatMap(r=>r.people||[]))].sort().map(name=>e('option',name,{value:name})));person.value=[...person.options].some(o=>o.value===current)?current:'';const existing=new Set(records.map(r=>r.id));for(const id of selected)if(!existing.has(id))selected.delete(id);draw();}
    async function showPreview(id){const asset=await app.library.getAsset(id);if(!asset)throw new Error('图片已不存在。');preview?.close();const d=e('dialog',undefined,{class:'ad-manual ad-cache-detail','aria-label':'缓存图片预览'}),body=e('div',undefined,{class:'ad-manual-body'}),footer=e('footer');preview=d;
        body.append(e('h2','缓存图片'),e('img',undefined,{src:asset.data,alt:'缓存原图'}),e('p',new Date(asset.created_at).toLocaleString()),e('pre',asset.prompt||'',{class:'ad-cache-prompt'}),e('pre',recipeDescription(asset.recipe,asset.genParams),{class:'ad-cache-prompt'}));
        footer.append(action('下载原图',async()=>download(await(await fetch(asset.data)).blob(),'剧情绘图_'+asset.id.slice(-10)+'.'+(asset.data.startsWith('data:image/jpeg')?'jpg':asset.data.startsWith('data:image/webp')?'webp':'png'))),action('关闭预览',()=>d.close()));d.append(body,footer);document.body.append(d);d.onclose=()=>{d.remove();if(preview===d)preview=undefined;};d.showModal();
    }
    for(const input of[scope,person])input.onchange=()=>{page=1;draw();};search.oninput=()=>{page=1;draw();};
    pane.append(e('h3','图片缓存管理'),filters,toolbar,status,grid,pagination);host.append(pane);
    return {refresh,destroy(){epoch++;preview?.close();pane.remove();}};
}
