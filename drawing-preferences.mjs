import {artistTags} from './character-tools.mjs';
export const ARTIST_FORMAT='animadex-artists-v1';
const pastedText=value=>String(value).replace(/[\u200b\u2060\ufeff]/g,'').trim();
const cleanName=value=>{if(typeof value!=='string')throw new Error('请填写 120 字以内的画师名称。');value=pastedText(value);if(!value||value.length>120||/[\x00-\x1f<>]/.test(value))throw new Error('请填写 120 字以内的画师名称。');return value;};
export function normalizeArtist(value){
    if(typeof value==='string'){value=pastedText(value);value={name:value.replace(/^@/,''),tags:[value.startsWith('@')?value:'@'+value]};}
    if(!value||typeof value!=='object')throw new Error('画师预设格式错误。');
    const tags=artistTags(value.tags||[String(value.tag||value.name||'').replace(/^@?/,'@')]);
    if(!tags.length)throw new Error('画师预设至少需要一个 @画师标签。');
    return {name:cleanName(value.name||tags.join(', ')),tags};
}
export function parseArtistImport(input){
    let values;if(typeof input==='string'){const text=pastedText(input);if(!text)throw new Error('请填写画师名称或导入 JSON。');
        if(/^[\[{]/.test(text)){try{input=JSON.parse(text);}catch{throw new Error('画师 JSON 无法解析。');}}
        else values=text.split(/[\n,，]+|\s+(?=@)/).map(v=>v.trim()).filter(Boolean);}
    if(!values)values=Array.isArray(input)?input:input?.format===ARTIST_FORMAT?input.artists:null;
    if(!Array.isArray(values)||!values.length||values.length>200)throw new Error('请导入画师列表，每次最多 200 个。');
    const result=values.map(normalizeArtist),keys=new Set();return result.filter(r=>{const key=r.tags.join(',');if(keys.has(key))return false;keys.add(key);return true;});
}
export function withDefaultArtists(prompt,values=[],previous=[]){
    const tags=artistTags(values),old=new Set(artistTags(previous));if(!tags.length&&!old.size)return prompt;
    const parts=String(prompt).split(';'),tokens=parts[0].split(',').map(v=>v.trim());
    const isArtist=t=>t.startsWith('@')&&!/^@(style|character):/i.test(t);
    parts[0]=[...tokens.filter(t=>!(isArtist(t)&&(tags.length||old.has(t)))),...tags].join(', ');
    return parts.join(';');
}
