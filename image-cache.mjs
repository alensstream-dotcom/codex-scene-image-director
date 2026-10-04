export const imageBytes=data=>{const base64=String(data||'').split(',')[1]||'';return Math.max(0,Math.floor(base64.length*3/4)-(base64.endsWith('==')?2:base64.endsWith('=')?1:0));};
export function assetMetadata(asset){return {id:asset.id,story_id:asset.story_id||'',scene_id:asset.scene_id||'',purpose:asset.purpose||(/^profile_/.test(asset.scene_id||'')?'reference':'generated'),created_at:asset.created_at||'',bytes:imageBytes(asset.data),people:(asset.scene_snapshot?.actors||[]).map(a=>a.person),thumbnail:asset.thumbnail||'',legacy_uuid:asset.legacy_uuid||'',legacy_uuids:asset.legacy_uuids||[],content_hash:asset.content_hash||''};}
export async function imageContentHash(data){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(data).replace(/\s/g,'')));return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function consolidateLegacyCopies(library){
    const records=await library.listAssetMetadata(),byHash=new Map(),deleting=[];
    // Prefer existing chat/reference assets. Only remove redundant imported copies.
    records.sort((a,b)=>Number(!!a.legacy_uuid)-Number(!!b.legacy_uuid));
    for(const record of records){let asset;if(!record.content_hash){asset=await library.getAsset(record.id);if(!asset)continue;await library.saveAsset(asset);record.content_hash=asset.content_hash;}
        const canonical=byHash.get(record.content_hash);if(canonical&&record.legacy_uuid){const target=await library.getAsset(canonical.id);target.legacy_uuids=[...new Set([...(target.legacy_uuids||[]),record.legacy_uuid,...record.legacy_uuids||[]])];await library.saveAsset(target);deleting.push(record.id);}else if(!canonical)byHash.set(record.content_hash,record);
    }
    return deleting.length?await library.deleteAssets(deleting):{deleted:0,protected:[]};
}
export function cachePage(records,{scope='all',storyId='',person='',query='',page=1,pageSize=15}={}){
    const found=records.filter(r=>(scope!=='current'||r.story_id===storyId)&&(scope!=='reference'||r.purpose==='reference')&&(scope!=='legacy'||r.legacy_uuid||r.legacy_uuids?.length)&&(!person||r.people?.includes(person))&&(!query||[r.created_at,...r.people||[]].join(' ').toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
    const pages=Math.max(1,Math.ceil(found.length/pageSize)),current=Math.max(1,Math.min(pages,page));return {items:found.slice((current-1)*pageSize,current*pageSize),ids:found.map(r=>r.id),total:found.length,bytes:found.reduce((n,r)=>n+(r.bytes||0),0),page:current,pages};
}
export async function imageThumbnail(data){
    try{const image=await createImageBitmap(await(await fetch(data)).blob()),scale=Math.min(1,240/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);image.close();return canvas.toDataURL('image/webp',.75);}catch{return '';}
}
export async function importLegacyCache(library,{factory=globalThis.indexedDB,onProgress=()=>{}}={}){
    if(!factory)return {added:0,existing:0,skipped:0};
    if(factory.databases&&!(await factory.databases()).some(d=>d.name==='chatu8_gallery'))return {added:0,existing:0,skipped:0};
    const db=await new Promise((resolve,reject)=>{const r=factory.open('chatu8_gallery');r.onupgradeneeded=()=>r.transaction.abort();r.onerror=()=>r.error?.name==='AbortError'?resolve(null):reject(r.error);r.onsuccess=()=>resolve(r.result);});
    if(!db)return {added:0,existing:0,skipped:0};
    try{
        if(!db.objectStoreNames.contains('tupianhuancun'))return {added:0,existing:0,skipped:0};
        const get=id=>new Promise((resolve,reject)=>{const tx=db.transaction('tupianhuancun','readonly'),r=tx.objectStore('tupianhuancun').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        const record=await get('tupianshuju');let metadata;try{metadata=JSON.parse(record?.shuju||'{}');}catch{throw new Error('旧图片缓存的索引无法读取。原库未改动。');}
        await consolidateLegacyCopies(library);
        const records=await library.listAssetMetadata(),byHash=new Map(records.filter(r=>r.content_hash).map(r=>[r.content_hash,r.id]));
        const images=Object.values(metadata).flatMap(entry=>(entry.images||[]).map(img=>({...img,prompt:entry.change||''}))),known=new Set(records.flatMap(a=>[a.legacy_uuid,...a.legacy_uuids||[]]).filter(Boolean));let added=0,existing=0,skipped=0;
        for(const img of images){
            if(img.isVideo||!img.uuid){skipped++;continue;}if(known.has(img.uuid)){existing++;continue;}
            const stored=await get(img.uuid);let bytes;
            if(stored?.data instanceof ArrayBuffer)bytes=new Uint8Array(stored.data);else if(ArrayBuffer.isView(stored?.data))bytes=new Uint8Array(stored.data.buffer,stored.data.byteOffset,stored.data.byteLength);else if(stored?.data instanceof Blob)bytes=new Uint8Array(await stored.data.arrayBuffer());else{skipped++;continue;}
            const mime=bytes[0]===137&&bytes[1]===80?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':null;if(!mime){skipped++;continue;}
            let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));const data='data:'+mime+';base64,'+btoa(text),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('legacy:'+img.uuid));
            const contentHash=await imageContentHash(data),sameId=byHash.get(contentHash);if(sameId){const same=await library.getAsset(sameId);same.legacy_uuids=[...new Set([...(same.legacy_uuids||[]),img.uuid])];await library.saveAsset(same);known.add(img.uuid);existing++;continue;}
            const id='img_'+[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''),genParams=Object.fromEntries(['model','seed','width','height','steps','cfgScale','sampler','scheduler','resolvedPrompt','negativePrompt'].filter(k=>img.genParams?.[k]!==undefined).map(k=>[k,img.genParams[k]]));
            await library.saveAsset({id,data,content_hash:contentHash,thumbnail:await imageThumbnail(data),legacy_uuid:img.uuid,purpose:'legacy',prompt:img.prompt,genParams,created_at:new Date(Number(img.date)||Date.now()).toISOString()});known.add(img.uuid);byHash.set(contentHash,id);added++;onProgress({added,existing,skipped,total:images.length});
        }return {added,existing,skipped};
    }finally{db.close();}
}
