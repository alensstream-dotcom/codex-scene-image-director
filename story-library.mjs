/** This extension owns its database; no character/outfit data is read from another extension. */
export const LIBRARY_DB='animadex-story-library-v2';
const STORES=['stories','assets','outfits'];
export function createLibrary({indexedDB:factory=globalThis.indexedDB}={}){
    let opened;
    const open=()=>opened??=new Promise((resolve,reject)=>{
        if(!factory)return reject(new Error('当前酒馆不支持本地人物存储。'));
        const r=factory.open(LIBRARY_DB,1);
        r.onupgradeneeded=()=>{for(const name of STORES)if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name,{keyPath:'id'});};
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
    async function transaction(store,mode,operation){const db=await open();return new Promise((resolve,reject)=>{
        const tx=db.transaction(store,mode),os=tx.objectStore(store);let value;
        tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('本地保存取消。'));
        operation(os,v=>{value=v;},tx);
    });}
    const get=(store,id)=>transaction(store,'readonly',(os,set)=>{const r=os.get(id);r.onsuccess=()=>set(r.result);});
    const list=store=>transaction(store,'readonly',(os,set)=>{const r=os.getAll();r.onsuccess=()=>set(r.result);});
    const put=(store,value)=>transaction(store,'readwrite',(os,set)=>{os.put(structuredClone(value));set(value);});
    async function saveStory(story,expected=story.revision??0){return transaction('stories','readwrite',(os,set,tx)=>{
        const r=os.get(story.id);r.onsuccess=()=>{if((r.result?.revision??0)!==expected){tx.abort();return;}
            const next={...structuredClone(story),revision:expected+1,updated_at:new Date().toISOString()};os.put(next);set(next);};
    });}
    return {getStory:id=>get('stories',id),saveStory,getAsset:id=>get('assets',id),saveAsset:asset=>put('assets',asset),listStories:()=>list('stories'),
        async export(){return {format:LIBRARY_DB,version:2,stories:await list('stories'),assets:await list('assets'),outfits:await list('outfits')};},
        async import(data){if(data?.format!==LIBRARY_DB||data.version!==2||!Array.isArray(data.stories)||!Array.isArray(data.assets))throw new Error('请选择本插件导出的备份。');
            if(data.outfits!==undefined&&!Array.isArray(data.outfits))throw new Error('备份衣装格式不正确。');for(const item of data.outfits||[])if(typeof item?.id!=='string')throw new Error('备份衣装记录不正确。');
            for(const item of data.assets){if(!/^img_[0-9a-f]{64}$/.test(item.id||'')||!/^data:image\/(png|jpeg|webp);base64,/.test(item.data||''))throw new Error('备份图片格式不正确。');}
            for(const item of data.stories){if(typeof item.id!=='string'||!item.cast?.people||!item.scenes||item.version!==2)throw new Error('备份人物记录不正确。');}
            // Validate the entire backup before starting one atomic database transaction.
            const db=await open();await new Promise((resolve,reject)=>{const tx=db.transaction(STORES,'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('导入已取消。'));
                try{for(const store of STORES)for(const item of data[store]||[])tx.objectStore(store).put(structuredClone(item));}catch(error){tx.abort();reject(error);}});
        },close:async()=>{(await open()).close();opened=undefined;}};
}
export function newStory(id,legacy){const scope=legacy?.scope||crypto.randomUUID();return {id,version:2,revision:0,cast:{version:1,scope,people:structuredClone(legacy?.people||{})},scenes:{},events:{},processed:{}};}

