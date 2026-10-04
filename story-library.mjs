/** This extension owns its database; no character/outfit data is read from another extension. */
export const LIBRARY_DB='animadex-story-library-v2';
import {assetMetadata,imageThumbnail,imageContentHash} from './image-cache.mjs';
const STORES=['stories','assets','outfits'];
export function createLibrary({indexedDB:factory=globalThis.indexedDB}={}){
    let opened;
    const open=()=>opened??=new Promise((resolve,reject)=>{
        if(!factory)return reject(new Error('当前酒馆不支持本地人物存储。'));
        const r=factory.open(LIBRARY_DB,2);
        r.onupgradeneeded=()=>{for(const name of [...STORES,'asset_meta'])if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name,{keyPath:'id'});
            const meta=r.transaction.objectStore('asset_meta'),cursor=r.transaction.objectStore('assets').openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(c){meta.put(assetMetadata(c.value));c.continue();}};};
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
    async function saveAsset(asset){asset.content_hash=await imageContentHash(asset.data);const db=await open();await new Promise((resolve,reject)=>{const tx=db.transaction(['assets','asset_meta'],'readwrite');tx.objectStore('assets').put(structuredClone(asset));tx.objectStore('asset_meta').put(assetMetadata(asset));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});return asset;}
    async function deleteAssets(ids){const selected=new Set(ids),db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(['stories','assets','asset_meta'],'readwrite'),os=tx.objectStore('stories'),request=os.getAll();let result;
        tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        request.onsuccess=()=>{const stories=request.result,protectedIds=new Set();
            const refs=p=>{for(const id of p?.reference_ids||[])protectedIds.add(id);};
            const snapshots=s=>{for(const actor of s.actors||[])refs(actor.person_snapshot);for(const old of s.history||[])snapshots(old);};
            for(const story of stories){for(const p of Object.values(story.cast?.people||{}))refs(p);for(const s of Object.values(story.scenes||{}))snapshots(s);}
            const deleting=new Set([...selected].filter(id=>!protectedIds.has(id)));
            const clean=s=>{let changed=false;for(const field of ['images','archived_images'])if(s[field]?.some(id=>deleting.has(id))){s[field]=s[field].filter(id=>!deleting.has(id));changed=true;}if(deleting.has(s.selected_image)){s.selected_image=s.images?.at(-1);changed=true;}for(const old of s.history||[])if(clean(old))changed=true;return changed;};
            for(const story of stories){let changed=false;for(const s of Object.values(story.scenes||{}))if(clean(s))changed=true;for(const p of Object.values(story.cast?.people||{}))if(deleting.has(p.saved_from)){delete p.saved_from;changed=true;}if(changed){story.revision++;story.updated_at=new Date().toISOString();os.put(story);}}
            for(const id of deleting){tx.objectStore('assets').delete(id);tx.objectStore('asset_meta').delete(id);}result={deleted:deleting.size,protected:[...selected].filter(id=>protectedIds.has(id))};
        };});}
    async function rebuildAssetMetadata(){const stories=await list('stories'),storyIds=new Map();for(const s of stories)for(const scene of Object.values(s.scenes||{}))storyIds.set(scene.id,s.id);const db=await open();const ids=await transaction('assets','readonly',(os,set)=>{const r=os.getAllKeys();r.onsuccess=()=>set(r.result);});let bytes=0;
        for(const id of ids){const asset=await get('assets',id);asset.story_id||=storyIds.get(asset.scene_id)||'';asset.thumbnail||=await imageThumbnail(asset.data);bytes+=assetMetadata(asset).bytes;await saveAsset(asset);}return {count:ids.length,bytes};}
    return {getStory:id=>get('stories',id),saveStory,getAsset:id=>get('assets',id),saveAsset,listStories:()=>list('stories'),listAssetMetadata:()=>list('asset_meta'),deleteAssets,rebuildAssetMetadata,
        async export(){return {format:LIBRARY_DB,version:2,stories:await list('stories'),assets:await list('assets'),outfits:await list('outfits')};},
        async import(data){if(data?.format!==LIBRARY_DB||data.version!==2||!Array.isArray(data.stories)||!Array.isArray(data.assets))throw new Error('请选择本插件导出的备份。');
            if(data.outfits!==undefined&&!Array.isArray(data.outfits))throw new Error('备份衣装格式不正确。');for(const item of data.outfits||[])if(typeof item?.id!=='string')throw new Error('备份衣装记录不正确。');
            for(const item of data.assets){if(!/^img_[0-9a-f]{64}$/.test(item.id||'')||!/^data:image\/(png|jpeg|webp);base64,/.test(item.data||''))throw new Error('备份图片格式不正确。');}
            for(const item of data.stories){if(typeof item.id!=='string'||!item.cast?.people||!item.scenes||item.version!==2)throw new Error('备份人物记录不正确。');}
            // Validate the entire backup before starting one atomic database transaction.
            const db=await open();await new Promise((resolve,reject)=>{const tx=db.transaction([...STORES,'asset_meta'],'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('导入已取消。'));
                try{for(const store of STORES)for(const item of data[store]||[])tx.objectStore(store).put(structuredClone(item));for(const item of data.assets)tx.objectStore('asset_meta').put(assetMetadata(item));}catch(error){tx.abort();reject(error);}});
        },close:async()=>{(await open()).close();opened=undefined;}};
}
export function newStory(id,legacy){const scope=legacy?.scope||crypto.randomUUID();return {id,version:2,revision:0,cast:{version:1,scope,people:structuredClone(legacy?.people||{})},scenes:{},events:{},processed:{}};}

