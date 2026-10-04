/** Offline Animadex retrieval for a future SillyTavern extension.
 * Uses the preclassified data; no tag sorting, model call, or third-party library at runtime.
 * Browser: loadCatalog(baseUrl); Node: createCatalog({characters,outfits,taxonomy,index}).
 */
import {catalogFacets} from './narrative-appearance.mjs';
const norm=s=>String(s).toLowerCase().replaceAll('_',' ').replace(/\s+/g,' ').trim();
const arr=v=>Array.isArray(v)?v:[v];
const uniq=vs=>[...new Set(vs)];
const colorZh={'黑':'black','黑色':'black','白':'white','白色':'white','蓝':'blue','蓝色':'blue','红':'red','红色':'red','绿':'green','绿色':'green','粉':'pink','粉色':'pink','紫':'purple','紫色':'purple','棕':'brown','棕色':'brown','褐色':'brown','灰':'grey','灰色':'grey','银':'silver','银色':'silver','金':'blonde','金色':'blonde','黄':'yellow','黄色':'yellow','橙':'orange','橙色':'orange','青':'aqua','青色':'aqua','浅蓝':'light blue','浅蓝色':'light blue','浅棕':'light brown','浅棕色':'light brown'};
const fieldZh={'性别':'gender','发色':'hair_color','发长':'hair_length','发型':'hair_style','瞳色':'eye_color','肤色':'skin','体型':'build','胸型':'bust','种族':'species','耳朵':'ears','服装风格':'style','颜色':'color'};
const weights={hair_color:4,hair_length:3,hair_style:3,eye_color:4,skin:3,build:2,bust:1,species:4,ears:3,horns:3,wings:3,style:4,color:2,gender:4};
const lengths=['very short','short','medium','long','very long','absurdly long'];
const characterFacets=new Set(['gender','height','age_group','age_evidence','species','hair_color','hair_length','hair_pattern','hair_style','bangs','eye_color','eye_features','skin','build','bust','ears','horns','tail','wings','face','marks','anatomy','facial_hair']);
const allowed=new Set(['kind','required','preferred','required_tags','preferred_tags','exclude_tags','exclude_ids','archetypes','preferred_archetypes','limit','seed','include_limited','include_partial','allow_underwear','allow_swimwear','include_accessories','include_trigger','score_window','temperature','text','order','strict_appearance']);
function seeded(seed){
  let state=2166136261;
  for(const b of new TextEncoder().encode(String(seed))) state=Math.imul(state^b,16777619)>>>0;
  return ()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
const intersects=(a,b)=>a.some(v=>b.includes(v));
const sortIds=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;

export async function loadCatalog(baseUrl,{fetcher=fetch,loadOutfits=true,excludedIds=()=>[]}={}){
  const base=baseUrl.replace(/\/$/,'');
  const read=async p=>{const r=await fetcher(`${base}/${p}`,{cache:'no-store'});if(!r.ok)throw new Error(`Animadex ${p}: HTTP ${r.status}`);return r.json();};
  const [characters,outfits,taxonomy,index]=await Promise.all([read('data/characters.browser.json'),loadOutfits?read('data/outfits.browser.json'):[],read('data/taxonomy.json'),read('indexes/character-index.json')]);
  return createCatalog({characters,outfits,taxonomy,index,excludedIds});
}

export function createCatalog({characters,outfits=[],taxonomy,index,excludedIds=()=>[]}){
  characters=characters.map(r=>({...r,facets:catalogFacets(r)}));
  const info=taxonomy.tags,aliases=new Map(),archetypeAliases=new Map();
  for(const [t,i] of Object.entries(info))for(const alias of [t,...i.raw_variants,...i.aliases_zh]){const n=norm(alias);if(!aliases.has(n))aliases.set(n,[]);aliases.get(n).push(t);}
  for(const [id,a] of Object.entries(taxonomy.archetypes)){archetypeAliases.set(id,id);archetypeAliases.set(norm(a.label_zh),id);}
  const byId=new Map(characters.map(r=>[r.id,r]));
  const outfitById=new Map(outfits.map(r=>[r.id,r]));
  function tag(v){const n=norm(v);if(info[n])return n;const found=uniq(aliases.get(n)||[]);if(found.length===1)return found[0];throw new Error(found.length?`中文标签有多个对应值，请使用英文：${v}`:`资料库不存在这个标签：${v}`);}
  function value(f,v){
    let n=norm(v);
    if(['hair_color','eye_color','color'].includes(f)){
      for(const suffix of ['头发','眼睛','色头发','色眼睛','发','瞳','眼'])if(n.endsWith(suffix)&&colorZh[n.slice(0,-suffix.length)]){n=n.slice(0,-suffix.length);break;}
      n=(colorZh[n]||n).replace('gray','grey');
      if(['eye_color','color'].includes(f)&&n==='blonde')n=f==='eye_color'?'yellow':'gold';
      for(const suffix of [' hair',' eyes'])if(n.endsWith(suffix))n=n.slice(0,-suffix.length);
      return n;
    }
    if(f==='gender')return ({'女':'female','女性':'female','男':'male','男性':'male','未定':'ambiguous','性别不明':'ambiguous','1girl':'female','1boy':'male','1other':'ambiguous'})[n]||n;
    if(f==='height')return ({'高挑':'tall','高个子':'tall','tall female':'tall','娇小':'short','petite':'short','中等':'average'})[n]||n;
    if(f==='age_group')return ({'小女孩':'child','儿童':'child','少女':'young','少妇':'mature','成熟':'mature'})[n]||n;
    if(f==='hair_length'){n=({'极短发':'very short','短发':'short','中长发':'medium','长发':'long','超长发':'very long','极长发':'absurdly long'})[n]||n;return n.endsWith(' hair')?n.slice(0,-5):n;}
    if(f==='style')return archetypeAliases.get(n)||n;
    try{return info[tag(n)].value;}catch{return n;}
  }
  function normalizeQuery(q){
    for(const k of Object.keys(q))if(!allowed.has(k))throw new Error(`未知查询字段：${k}`);
    const kind=q.kind||'character';if(!['character','outfit'].includes(kind))throw new Error('kind 必须是 character 或 outfit');
    const out={...q,kind,required:{},preferred:{}};
    for(const field of ['required','preferred']){
      if(q[field]&&(typeof q[field]!=='object'||Array.isArray(q[field])))throw new Error(`${field} 必须是对象`);
      for(const [f,vs] of Object.entries(q[field]||{})){
        const facet=fieldZh[f]||f;
        if(!(kind==='character'?characterFacets:new Set(['color','style','slot','gender'])).has(facet))throw new Error(`${kind} 不支持条件 ${facet}`);
        out[field][facet]=uniq(arr(vs).map(v=>value(facet,v)));if(!out[field][facet].length)throw new Error(`${facet} 条件不能为空数组`);
      }
    }
    for(const field of ['required_tags','preferred_tags','exclude_tags'])out[field]=uniq(arr(q[field]||[]).map(tag));
    for(const field of ['archetypes','preferred_archetypes'])out[field]=arr(q[field]||[]).map(v=>{const aid=archetypeAliases.get(norm(v));if(!aid)throw new Error(`未知形象类别：${v}`);return aid;});
    out.limit=Math.min(100,Math.max(1,Math.trunc(Number(q.limit??8))));out.seed=String(q.seed??'animadex-default');
    out.score_window=Number(q.score_window??6);out.temperature=Number(q.temperature??4);
    if(out.score_window<0||out.temperature<=0||!Number.isFinite(out.temperature)||!Number.isFinite(out.score_window)||!Number.isFinite(out.limit))throw new Error('非法采样参数');
    return out;
  }
  function facets(r,kind){return kind==='character'?r.facets:{color:r.colors,style:r.styles,slot:Object.keys(r.slots),gender:r.gender_evidence};}
  function aids(r,kind){return kind==='character'?r.archetypes.map(a=>a.id):r.styles;}
  function prepareCharacter(r,q){
    let tags=uniq([...r.appearance_tags,...r.tags.filter(t=>info[t].facet==='species'&&t!=='no humans')]);const decisions=[];
    for(const facet of ['hair_color','eye_color','hair_length','bust']){
      const vals=r.facets[facet]||[];if(!vals.length)continue;
      const choices=[...(q.required[facet]||[]),...q.required_tags.filter(t=>info[t].facet===facet).map(t=>info[t].value),...(q.preferred[facet]||[]),...q.preferred_tags.filter(t=>info[t].facet===facet).map(t=>info[t].value)];
      let desired=choices.find(v=>vals.includes(v));
      const multi=(facet==='hair_color'&&(r.facets.hair_pattern||[]).length>0)||(facet==='eye_color'&&intersects(r.tags,['heterochromia','multicolored eyes','two-tone eyes','gradient eyes']));
      if(multi&&desired===undefined){decisions.push({facet,kept:vals,reason:'explicit_multicolor_evidence'});continue;}
      if(desired===undefined)desired=facet==='hair_length'?[...vals].sort((a,b)=>lengths.indexOf(b)-lengths.indexOf(a))[0]:vals[0];
      const removed=tags.filter(t=>info[t].facet===facet&&info[t].value!==desired);tags=tags.filter(t=>!removed.includes(t));
      decisions.push({facet,kept:[desired],removed_tags:removed,reason:choices.includes(desired)?'query_value':facet==='hair_length'?'most_specific_length':'first_source_value'});
    }
    const animalTypes='cat|dog|fox|wolf|rabbit|horse|tiger|bear|cow|mouse|sheep|lion|goat|deer|squirrel|raccoon|bat|dragon';
    for(const [facet,part,multiTag] of [['ears','ears','extra ears'],['tail','tail','multiple tails']]){
      const typeRe=new RegExp(`(${animalTypes}) ${part}$`),choiceRe=new RegExp(`^(?:.+ )?(?:${animalTypes}) ${part}$`);
      const choices=tags.filter(t=>choiceRe.test(t)),types=new Set(choices.map(t=>t.match(typeRe)[1]));if(types.size<2)continue;
      const requested=[...q.required_tags.filter(t=>choices.includes(t)),...(q.required[facet]||[]).filter(t=>choices.includes(t))],preferred=(q.preferred[facet]||[]).filter(t=>choices.includes(t));
      if(requested.length>1||(tags.includes(multiTag)&&!requested.length))continue;
      const selected=[...requested,...preferred,...choices][0],chosenType=selected.match(typeRe)[1],keepRe=new RegExp(`\\b${chosenType} ${part}$`),removed=choices.filter(t=>!keepRe.test(t));tags=tags.filter(t=>!removed.includes(t));
      decisions.push({facet,kept:[selected],removed_tags:removed,reason:requested.length||preferred.length?'query_value':'first_source_animal_type'});
    }
    const gender=[...(q.required.gender||[]),...(r.facets.gender||[])].find(v=>(r.facets.gender||[]).includes(v));const gt={female:'1girl',male:'1boy',ambiguous:'1other'}[gender];if(gt)tags.unshift(gt);
    const mutable=q.include_accessories?r.accessory_tags:r.accessory_tags.filter(t=>/^(?:hair|.* hair|.*hair) (?:ribbon|rings|clip|flower|ornament|bow)|^hairband$/.test(t));
    const face=tags.filter(t=>['eye_color','eye_features','face','facial_hair'].includes(info[t].facet));const general=tags.filter(t=>!face.includes(t));
    const appearance=uniq([...tags,...mutable]);
    return {appearance_tags:appearance,appearance_prompt:[...(q.include_trigger?[r.trigger]:[]),...appearance].join(', '),prototype_trigger:r.trigger,trigger_included:!!q.include_trigger,resolved_facets:decisions,
      outfit_tags_separate:r.outfit_tags,accessory_tags_separate:r.accessory_tags,
      chatu8_fields:{characterTraits:[...(q.include_trigger?[r.trigger]:[]),...general].join(', '),facialFeatures:[...face,...mutable].join(', '),upperBodySFW:'',fullBodySFW:''},
      binding:{prototype_id:r.id,chosen_appearance_tags:appearance,trigger_included:!!q.include_trigger,seed:q.seed,persist_for_same_story_character:true}};
  }
  function prepareOutfit(r,q){
    let tags=r.tags.filter(t=>info[t].facet!=='condition');if(q.include_accessories===false)tags=tags.filter(t=>info[t].section!=='accessory');
    const decisions=[];
    for(const a of r.quality.color_alternatives){const selected=(q.required.color||[]).find(c=>a.values.includes(c))||a.values[0];const removed=a.values.filter(c=>c!==selected).map(c=>`${c} ${a.garment}`);tags=tags.filter(t=>!removed.includes(t));decisions.push({...a,kept:selected,removed_tags:removed});}
    const lower=new Set(['bottom','legwear','footwear']);const upper=tags.filter(t=>info[t].section==='outfit'&&!lower.has(info[t].facet));const bottom=tags.filter(t=>lower.has(info[t].facet));const accessories=tags.filter(t=>info[t].section==='accessory');
    return {outfit_tags:tags,outfit_prompt:tags.join(', '),slots:Object.fromEntries(Object.entries(r.slots).map(([s,ts])=>[s,ts.filter(t=>tags.includes(t))])),resolved_colors:decisions,source_character_ids:r.source_character_ids,
      chatu8_fields:{upperBodySFW:[...upper,...accessories].join(', '),fullBodySFW:bottom.join(', ')},binding:{outfit_id:r.id,chosen_outfit_tags:tags,seed:q.seed}};
  }
  function rankCandidates(query){
    const q=normalizeQuery(query),kind=q.kind;let pool=kind==='character'?characters:outfits;
    // Use prebuilt postings to narrow character candidates before reading records.
    if(kind==='character'&&index){
      let ids=null;
      const intersect=vs=>{const s=new Set(vs);ids=ids===null?s:new Set([...ids].filter(i=>s.has(i)));};
      for(const [f,vs] of Object.entries(q.required))intersect(uniq(vs.flatMap(v=>index.facet[f]?.[v]||[])));
      for(const t of q.required_tags)intersect(index.tag[t]||[]);
      for(const a of q.archetypes)intersect(index.archetype[a]||[]);
      if(ids!==null)pool=[...ids].map(i=>byId.get(index.id_order[i])).filter(Boolean);
    }
    const excluded=new Set([...arr(q.exclude_ids||[]),...(kind==='character'?excludedIds():[])]);
    pool=pool.filter(r=>{
      if(excluded.has(r.id))return false;
      if(kind==='character'&&r.profile?.review_eligible===false)return false;
      if(q.text&&!norm(q.text).split(/[,，]/).map(w=>w.trim()).filter(Boolean).every(w=>norm([r.id,r.name,r.series,r.trigger,...r.tags].join(' ')).includes(w)))return false;
      if(kind==='character'&&!q.include_limited&&!r.quality.eligible_default)return false;
      if(kind==='outfit'&&((!q.include_partial&&!r.quality.has_core)||(!q.allow_underwear&&r.quality.contains_underwear)||(!q.allow_swimwear&&r.quality.contains_swimwear)||(!q.include_limited&&r.quality.color_alternatives.length)))return false;
      const fs=facets(r,kind),as=aids(r,kind);
      if(q.strict_appearance&&kind==='character'&&Object.entries(q.required).some(([f,vs])=>['hair_color','hair_length','eye_color','bust'].includes(f)&&(fs[f]||[]).some(v=>!vs.includes(v))))return false;
      return Object.entries(q.required).every(([f,vs])=>intersects(vs,fs[f]||[]))&&q.required_tags.every(t=>r.tags.includes(t))&&!q.exclude_tags.some(t=>r.tags.includes(t))&&q.archetypes.every(a=>as.includes(a));
    }).sort(sortIds);
    const ranked=pool.map(r=>{
      const fs=facets(r,kind),as=aids(r,kind),matches=[];let score=0;
      for(const [f,vs] of Object.entries(q.preferred)){const found=uniq(vs.filter(v=>(fs[f]||[]).includes(v))).sort();if(found.length){score+=weights[f]||2;matches.push({facet:f,values:found});}}
      for(const t of q.preferred_tags)if(r.tags.includes(t)){score+=2;matches.push({tag:t});}
      for(const a of q.preferred_archetypes)if(as.includes(a)){score+=3;matches.push({archetype:a});}
      if(kind==='character')score-=Math.min(2,0.25*(r.quality.alternatives||[]).length);
      return {r,score,matches};
    });
    return {q,kind,pool,ranked};
  }
  function retrieve(query){
    const {q,kind,pool,ranked}=rankCandidates(query);
    const best=ranked.length?Math.max(...ranked.map(x=>x.score)):0,remaining=ranked.filter(x=>x.score>=best-q.score_window),poolCount=remaining.length,random=seeded(q.seed),results=[];
    if(q.order==='popularity')remaining.sort((a,b)=>(b.r.source_count||0)-(a.r.source_count||0)||b.score-a.score||sortIds(a.r,b.r));
    while(remaining.length&&results.length<q.limit){
      const ws=remaining.map(x=>Math.exp((x.score-best)/q.temperature));let draw=random()*ws.reduce((a,b)=>a+b,0),pos=0;
      for(let i=0;i<ws.length;i++){draw-=ws[i];if(draw<=0){pos=i;break;}}
      const {r,score,matches}=remaining.splice(q.order==='popularity'?0:pos,1)[0];
      results.push({id:r.id,name:r.name??null,series:r.series??null,score:Number(score.toFixed(3)),matched_preferences:matches,quality:r.quality,prepared:kind==='character'?prepareCharacter(r,q):prepareOutfit(r,q),provenance_ids:kind==='character'?[r.id]:r.source_character_ids});
    }
    return {status:results.length?'ok':'no_match',kind,candidate_count:pool.length,sampling_pool_count:poolCount,query:q,results,relaxed_constraints:[],note:'硬条件之间取交集，同一字段多个值取并集。无匹配时不自动放宽条件。'};
  }
  /** Every hard match is reachable; similarity precedes popularity and no sampling window hides rows. */
  function matches(query,{offset=0,limit=24}={}){
    const {q,kind,ranked}=rankCandidates(query);
    const requirements={...q.required};for(const t of q.required_tags){const m=info[t];if(m&&['hair_color','eye_color','hair_length'].includes(m.facet))requirements[m.facet]=[...(requirements[m.facet]||[]),m.value];}
    for(const row of ranked){row.ambiguity=0;for(const f of ['hair_color','eye_color','hair_length']){const requested=requirements[f],actual=row.r.facets?.[f]||[];if(!requested)continue;const compatible=f==='hair_length'?v=>requested.some(w=>v.includes('long')&&w.includes('long')||v===w):v=>requested.includes(v);row.ambiguity+=actual.filter(v=>!compatible(v)).length;}}
    ranked.sort((a,b)=>a.ambiguity-b.ambiguity||b.score-a.score||(b.r.source_count||0)-(a.r.source_count||0)||sortIds(a.r,b.r));
    const start=Math.max(0,Math.trunc(Number(offset)||0)),size=Math.max(1,Math.min(60,Math.trunc(Number(limit)||24)));
    return {query:q,total:ranked.length,offset:start,limit:size,has_more:start+size<ranked.length,results:ranked.slice(start,start+size).map(({r,score,matches,ambiguity})=>({id:r.id,name:r.name,series:r.series,score,source_ambiguity:ambiguity,matched_preferences:matches,prepared:kind==='character'?prepareCharacter(r,q):prepareOutfit(r,q)}))};
  }
  function browse({text='',required={},tags=[],offset=0,limit=24,sort='popularity',deleted=false,all=false}={}){
    const q=normalizeQuery({kind:'character',required:{...required,gender:'female'},required_tags:tags,include_limited:true}),excluded=new Set(excludedIds()),words=norm(text).split(/[,，]/).map(v=>v.trim()).filter(Boolean);
    const pool=characters.filter(r=>r.facets.gender?.includes('female')&&r.profile?.review_eligible!==false&&(deleted?excluded.has(r.id):!excluded.has(r.id))&&(all||deleted||r.quality.eligible_default)&&Object.entries(q.required).every(([f,vs])=>intersects(vs,r.facets[f]||[]))&&q.required_tags.every(t=>r.tags.includes(t))&&words.every(w=>norm([r.id,r.name,r.series,r.trigger,...r.tags].join(' ')).includes(w)));
    pool.sort(sort==='name'?(a,b)=>String(a.name||a.id).localeCompare(String(b.name||b.id)): (a,b)=>(b.source_count||0)-(a.source_count||0)||sortIds(a,b));
    const size=Math.max(1,Math.min(60,Math.trunc(Number(limit)||24))),start=Math.max(0,Math.trunc(Number(offset)||0));
    return {total:pool.length,offset:start,limit:size,records:pool.slice(start,start+size).map(r=>({id:r.id,name:r.name||r.id,series:r.series||'',tags:r.source_tag_string||[r.trigger,...r.tags].join(', '),preview:r.preview_url||null,preview_full:r.preview_full_url||r.preview_url||null,popularity:r.source_count||0,facets:r.facets,deleted:excluded.has(r.id)}))};
  }
  function browseFacets(){const fields=['hair_color','hair_length','eye_color','species','ears'],pool=characters.filter(r=>r.facets.gender?.includes('female')&&r.profile?.review_eligible!==false),out={};for(const f of fields){const counts=new Map();for(const r of pool)for(const v of r.facets[f]||[])counts.set(v,(counts.get(v)||0)+1);out[f]=[...counts].sort((a,b)=>b[1]-a[1]).map(([value,count])=>({value,count}));}return out;}
  const canonicalTag=t=>{try{return tag(t);}catch{return null;}};
  const appearanceTerms=Object.entries(info).filter(([,i])=>characterFacets.has(i.facet)).map(([tag,i])=>({tag,...i}));
  return {retrieve,matches,hasMatch:(id,query)=>rankCandidates(query).ranked.some(x=>x.r.id===id),normalizeQuery,browse,browseFacets,canonicalTag,appearanceTerms:()=>appearanceTerms,isExcluded:id=>excludedIds().includes(id),search:(text,{query={},limit=60}={})=>retrieve({...query,text,limit}),tagInfo:t=>info[canonicalTag(t)]||null,get:(id,kind='character')=>(kind==='character'?byId:outfitById).get(id)||null,stats:{characters:characters.length,default_characters:characters.filter(r=>r.quality.eligible_default).length,outfits:outfits.length,tags:Object.keys(info).length}};
}
