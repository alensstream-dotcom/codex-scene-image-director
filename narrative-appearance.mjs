/** Narrative facts are the identity contract; a database prototype is only a candidate. */
export const APPEARANCE_FIELDS=['bust','height','eye_color','hair_color','hair_length','hair_style','age_group'];
export const APPEARANCE_LABELS={bust:'胸型',height:'身高',eye_color:'瞳色',hair_color:'发色',hair_length:'发长',hair_style:'发型',age_group:'年龄层'};
const physical=new Set(['gender',...APPEARANCE_FIELDS]);
const colors={黑:'black',乌黑:'black',白:'white',棕:'brown',褐:'brown',金:'blonde',黄:'blonde',红:'red',蓝:'blue',绿:'green',紫:'purple',粉:'pink',灰:'grey',银:'silver',青:'aqua'};
const norm=v=>String(v||'').normalize('NFKC').toLowerCase().replaceAll('_',' ').replace(/\s+/g,' ').trim();
const unique=a=>[...new Set(a)],termCache=new WeakMap();
const termsFor=catalog=>{if(!catalog)return [];if(!termCache.has(catalog))termCache.set(catalog,(catalog.appearanceTerms?.()||[]).filter(m=>physical.has(m.facet)));return termCache.get(catalog);};
export function ageGroup(age){
    const n=Number(String(age).match(/\d{1,3}/)?.[0]);
    if(n>0&&n<=110)return n<13?'child':n<30?'young':'mature';
    const s=norm(age);return /child|儿童|小女孩|幼女/.test(s)?'child':/mature|middle|少妇|成熟|中年/.test(s)?'mature':/teen|young|少女|青少年/.test(s)?'young':'';
}
export function heightGroup(value){const n=Number(value);return n>=100&&n<=230?(n<=155?'short':n>=170?'tall':'average'):'';}
function namedSegments(person,text,names=[]){
    const own=[person.person,...(person.aliases||[])].filter(Boolean),others=names.filter(n=>!own.includes(n));
    return String(text||'').split(/[。！？!?\n]|\.(?=\s|$)/).flatMap(s=>{
        const positions=own.map(n=>({n,at:s.indexOf(n)})).filter(x=>x.at>=0).sort((a,b)=>a.at-b.at);if(!positions.length)return [];
        const {n,at}=positions[0],tail=s.slice(at+n.length);
        if(/^\s*(?:看见|看着|见到|望向|听见|告诉|问|说|的(?:母亲|父亲|姐姐|妹妹|朋友)|saw\b|said\b|asked\b|looks? at\b)/i.test(tail))return [];
        const stop=others.map(v=>tail.indexOf(v)).filter(i=>i>=0).sort((a,b)=>a-b)[0];return [tail.slice(0,stop??600)];
    });
}
export function narrativeAppearance(person,text,catalog,names=[]){
    const traits={},sources={},warnings=[];let age='',height_cm=null;
    const add=(field,value,segment,change=false)=>{if(!value)return;if(!traits[field]||change){traits[field]=[value];sources[field]='剧情明确描述';}else if(!traits[field].includes(value))warnings.push(APPEARANCE_LABELS[field]+'描述不一致，未说明外貌变化，沿用先前明确条件。');};
    for(const segment of namedSegments(person,text,names)){
        const change=/染(?:成|了|为|黑|白|红|蓝|绿)|剪(?:短|成|了)|换(?:成|了).*(?:发型|美瞳)|变(?:成|为).*(?:头发|发色|瞳色)|dyed|haircut/i.test(segment);
        const found=[];
        const colorNames=Object.keys(colors).sort((a,b)=>b.length-a.length).join('|');
        for(const m of segment.matchAll(new RegExp('('+colorNames+')(?:色)?(?:的)?(?:长|短|齐肩|及腰|超长)?(?:直|卷)?(?:发|头发)','g')))found.push(['hair_color',colors[m[1]],m.index]);
        for(const m of segment.matchAll(new RegExp('('+colorNames+')(?:色)?(?:的)?(?:眼睛|眼眸|双眼|瞳孔|瞳|眸)','g')))found.push(['eye_color',colors[m[1]]==='blonde'?'yellow':colors[m[1]],m.index]);
        for(const m of segment.matchAll(/(?:眼睛|瞳色|眼眸)(?:是|为|呈)?(黑|白|棕|褐|金|黄|红|蓝|绿|紫|粉|灰|银|青)(?:色)?/g))found.push(['eye_color',colors[m[1]]==='blonde'?'yellow':colors[m[1]],m.index]);
        const rules=[['hair_length','very long',/超长发|过腰长发|very long hair/gi],['hair_length','long',/长发|长直发|long hair/gi],['hair_length','medium',/齐肩发|齐肩(?:长|短)?发|中长发|shoulder.length hair|medium hair/gi],['hair_length','short',/短发|齐耳发|short hair/gi],['hair_style','straight hair',/直发|黑长直|长直发|straight hair/gi],['hair_style','curly hair',/卷发|curly hair/gi],['hair_style','twintails',/双马尾|twintails/gi],['hair_style','ponytail',/(?<!双)马尾|(?<!twin )ponytail/gi],['hair_style','bob cut',/波波头|bob cut/gi],['hair_style','hair bun',/丸子头|盘发|hair bun/gi],['height','tall',/高挑|高个子|高个(?:女性|女孩)|tall female/gi],['height','short',/身材娇小|娇小|矮个|short stature|petite/gi],['height','average',/中等身高|average height/gi],['bust','flat chest',/平胸|flat chest/gi],['bust','small breasts',/小胸|胸(?:部|型)?(?:较小|偏小)|small breasts/gi],['bust','medium breasts',/中等胸(?:部|型)?|胸(?:部|型)?适中|medium breasts/gi],['bust','large breasts',/大胸|胸(?:部|型)?丰满|large breasts/gi]];
        const covered=[];
        for(const[field,value,re]of rules)for(const m of segment.matchAll(re)){if(covered.some(([a,b,f])=>f===field&&m.index>=a&&m.index+m[0].length<=b))continue;found.push([field,value,m.index]);covered.push([m.index,m.index+m[0].length,field]);}
        for(const m of termsFor(catalog)){if(['height','age_group'].includes(m.facet))continue;const at=norm(segment).indexOf(m.tag);if(at>=0)found.push([m.facet,m.value,at]);}
        for(const[field,value,at]of found.sort((a,b)=>a[2]-b[2]))if(!/(?:不是|并非|没有|not |no )\s*$/.test(segment.slice(Math.max(0,at-8),at)))add(field,value,segment,change);
        const am=segment.match(/(\d{1,3})\s*(?:岁|years old)/i),category=segment.match(/小女孩|儿童|少女|少妇|成熟女性|成年女性|child|teenage|mature female|young woman/i);
        if(am&&!age){age=am[1]+' years old';add('age_group',ageGroup(age),segment);}else if(category&&!traits.age_group){const g=ageGroup(category[0]);if(g)add('age_group',g,segment);}
        const hm=segment.match(/(?:身高\s*)?(1\.[0-9]{1,2})\s*米|(?:身高\s*)?(1[0-9]{2}|2[0-2][0-9])\s*(?:cm|厘米|公分)/i);
        if(hm&&!height_cm){height_cm=hm[1]?Math.round(Number(hm[1])*100):Number(hm[2]);add('height',heightGroup(height_cm),segment);}
    }
    return {traits,sources,age,height_cm,warnings:unique(warnings)};
}
export function storyContext(chat,messageId,offset,prose){
    return (chat||[]).slice(0,messageId+1).map((m,i)=>prose(i===messageId?String(m.mes||'').slice(0,offset):m.mes||'')).join('\n');
}
function canonicalTraits(required={},catalog){
    const out={};for(const [field,raw]of Object.entries(required)){if(!physical.has(field))continue;const values=(Array.isArray(raw)?raw:[raw]).filter(v=>typeof v==='string');if(!values.length)continue;
        if(['height','age_group','gender'].includes(field))out[field]=[values[0]];else {const v=values[0],m=catalog?.tagInfo?.(v);out[field]=[m?.facet===field?m.value:v];}}
    return out;
}
export function reconcileStoryAppearance(person,{text='',catalog,names=[],spec={},manual=false}={}){
    const before=JSON.stringify(person),old=person.story_appearance,parsed=narrativeAppearance(person,text,catalog,names);
    const initial=canonicalTraits(person.initial_query?.required,catalog),proposed=canonicalTraits(spec.required,catalog);
    const traits={...proposed,...initial,...(old?.traits||{})},sources={...(old?.sources||{})};
    for(const[f,values]of Object.entries(parsed.traits))if(old?.source!=='user'){traits[f]=values;sources[f]='剧情明确描述';}
    if(manual){for(const tag of person.chosen_appearance_tags||[]){const m=catalog?.tagInfo?.(tag);if(m&&physical.has(m.facet))traits[m.facet]=[m.value];}sources.user='人物档案编辑';}
    const age=old?.source==='user'?person.age_description:(parsed.age||person.age_description||'');if(age){person.age_description=age;traits.age_group=[ageGroup(age)||traits.age_group?.[0]].filter(Boolean);}
    if(!traits.gender)traits.gender=[person.chosen_appearance_tags?.includes('1boy')?'male':'female'];
    // Unknown source facts stay unknown. Fill only missing basic appearance from
    // a previous stable profile, never import franchise ornaments or anatomy.
    for(const tag of person.chosen_appearance_tags||[]){const m=catalog?.tagInfo?.(tag);if(m&&physical.has(m.facet)&&!traits[m.facet])traits[m.facet]=[m.value];}
    const minor=traits.age_group?.[0]==='child'||/^\d+ years old$/.test(age)&&parseInt(age)<18||/teenage|child/i.test(age);
    if(minor)delete traits.bust;
    const tags=[traits.gender[0]==='male'?'1boy':'1girl'];
    for(const field of ['hair_color','hair_length','hair_style','eye_color','bust','height']){
        const value=traits[field]?.[0];if(!value)continue;
        const tag=field==='height'?({tall:'tall',short:'petite',average:''}[value]||''):field==='hair_color'?value+' hair':field==='hair_length'?value+' hair':field==='eye_color'?value+' eyes':value;
        if(tag)tags.push(tag);
    }
    if(traits.age_group?.[0]==='child')tags.push('child');else if(minor)tags.push('teenage');else if(traits.age_group?.[0]==='mature')tags.push('mature female');else if(traits.age_group?.[0]==='young')tags.push('young woman');
    person.chosen_appearance_tags=unique(tags);person.story_appearance={version:1,source:manual||old?.source==='user'?'user':'narrative',traits,sources,height_cm:parsed.height_cm||old?.height_cm||null,warnings:parsed.warnings};
    if(person.trigger_source!=='user')person.trigger_enabled=false;
    person.appearance_completion='narrative_contract';return JSON.stringify(person)!==before;
}
export function appearanceSummary(person){const p=person.story_appearance;if(!p)return '';const labels={child:'小女孩',young:'少女',mature:'少妇/成熟女性',tall:'高挑',short:'娇小',average:'中等','small breasts':'小胸','medium breasts':'中等胸型','large breasts':'大胸','flat chest':'平胸',black:'黑',brown:'棕',blonde:'金',blue:'蓝',green:'绿',yellow:'黄',long:'长发',medium:'中长发','very long':'超长发','straight hair':'直发','curly hair':'卷发',ponytail:'马尾',twintails:'双马尾','bob cut':'波波头'};return APPEARANCE_FIELDS.map(f=>APPEARANCE_LABELS[f]+'：'+(f==='height'&&p.height_cm?p.height_cm+' cm':p.traits[f]?.map(v=>f==='hair_length'&&v==='short'?'短发':labels[v]||v).join(' / ')||'未说明')).join(' · ');}
export function catalogFacets(record){
    const fs={...record.facets},b=fs.build||[],age=fs.age_evidence||[];
    fs.height=b.some(v=>/^tall(?: female)?$/.test(v))?['tall']:b.includes('petite')?['short']:[];
    fs.age_group=age.includes('child')?['child']:age.includes('mature female')?['mature']:age.includes('teenage')?['young']:[];return fs;
}
