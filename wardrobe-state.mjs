/** Explicit absence is a value. Missing data is not absence. */
const STATES=new Set(['worn','removed','open','partly_open','rolled','loose','held','draped']);
const clean=v=>{if(typeof v!=='string'||v.length>700||/[;{}@$<>\x00-\x1f]/.test(v))throw new Error('衣装标签含有无效格式。');return v.trim();};
export function applyOutfit(previous,change){
    if(change===undefined||change?.mode==='keep')return structuredClone(previous||{version:2,known:false,items:[]});
    if(!change||!['snapshot','patch'].includes(change.mode)||!Array.isArray(change.items)||change.items.length>24)throw new Error('衣装需要完整快照或逐件变化记录。');
    const items=change.mode==='snapshot'?new Map():new Map((previous?.items||[]).map(x=>[x.id,structuredClone(x)]));
    for(const item of change.items){
        if(!item||typeof item.id!=='string'||!item.id.trim()||item.id.length>80||!STATES.has(item.state)||!Array.isArray(item.tags)||item.tags.length>30)throw new Error('衣装单件状态不完整。');
        const old=items.get(item.id),tags=item.tags.map(clean).filter(Boolean),state_tags=(item.state_tags||[]).map(clean).filter(Boolean);
        if(!tags.length&&item.state!=='removed'&&!old)throw new Error('新衣物缺少款式标签。');
        items.set(item.id,{id:item.id,name:String(item.name||old?.name||item.id).slice(0,100),state:item.state,tags:tags.length?tags:old?.tags||[],state_tags,condition_tags:(item.condition_tags||[]).map(clean).filter(Boolean)});
    }
    return {version:2,known:true,items:[...items.values()]};
}
export function outfitTags(outfit){return [...new Set((outfit?.items||[]).filter(x=>x.state!=='removed').flatMap(x=>{
    if(x.state==='held')return ['holding '+x.tags.join(' ')+' '+(x.state_tags||[]).join(', '),...(x.condition_tags||[])];
    if(x.state==='draped')return [x.tags.join(' ')+' '+((x.state_tags||[]).join(', ')||'draped'),...(x.condition_tags||[])];
    return [...x.tags,...(x.state_tags||[]),...(x.condition_tags||[])];
}))];}
export const outfitText=outfit=>outfitTags(outfit).join(', ');
export function legacyOutfit(wardrobe){return wardrobe?.version===2?structuredClone(wardrobe):{version:2,known:!!wardrobe,items:wardrobe?[{id:'legacy-outfit',name:'已保存衣装',state:'worn',tags:[wardrobe.description,...(wardrobe.tags||[])].filter(Boolean),state_tags:[],condition_tags:[]}]:[]};}

