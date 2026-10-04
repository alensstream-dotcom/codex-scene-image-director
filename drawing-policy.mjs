/**
 * Copyable drawing policy: pure JavaScript, no plugin, host or catalog imports.
 * Worldbook model instructions and server/workflow checks are separate boundaries.
 * Callers keep their binding, camera, wardrobe and transport flow unchanged.
 */
export const CONTENT_TAG='SFW';
export const NATIVE_SFW_FIELDS=Object.freeze(['upperBodySFW','fullBodySFW','upperBodySFWBack','fullBodySFWBack']);
export const NATIVE_NSFW_FIELDS=Object.freeze(['upperBodyNSFW','fullBodyNSFW','upperBodyNSFWBack','fullBodyNSFWBack']);
export const SUPPORTED_INTERACTIONS=Object.freeze(['hug','holding_hands','arm_in_arm','dance','hand_on_shoulder','helping_up']);
export const INTERACTION_EVIDENCE=Object.freeze({
    hug:/\b(?:hugging|hugs?|embracing|embraces?)\b|拥抱|相拥|抱住/i,
    holding_hands:/\b(?:holding hands|holds? (?:her|his|the woman's|the man's) hand|hand in hand)\b|牵手|牵住.+手/i,
    arm_in_arm:/\barm in arm\b|挽着.+手臂|挽住.+手臂/i,
    dance:/\b(?:couple dancing|dancing with|waltz)\b|共舞/i,
    hand_on_shoulder:/\b(?:hand (?:resting |placed )?on (?:her|his|the woman's|the man's) shoulder|(?:patting|touching) (?:her|his) shoulder)\b|轻拍.+肩|手.+肩膀/i,
    helping_up:/\b(?:helping .+ (?:stand|to stand)|helping .+ up)\b|扶.+起身|扶.+站起/i
});
export const RENDER_POLICY='女性是画面主体；普通剧情省略男性主体。必要的牵手、拥抱、舞蹈等非露骨双人互动必须保留动作发起者和接触对象，不能只留女性再把对方动作移给她。另一人可只显示手臂或着装躯干；第一人称镜头不必显示对方脸。女性居中且占主要画面。环境镜头不凭空添加人物。';
/** Appearance group is not adult age: "young" includes ages 13 through 29. */
export function ageGroup(age){
    const n=Number(String(age).match(/\d{1,3}/)?.[0]);
    if(n>0&&n<=110)return n<13?'child':n<30?'young':'mature';
    const s=String(age||'').normalize('NFKC').toLowerCase().replaceAll('_',' ').replace(/\s+/g,' ').trim();
    return /child|儿童|小女孩|幼女/.test(s)?'child':/mature|middle|少妇|成熟|中年/.test(s)?'mature':/teen|young|少女|青少年/.test(s)?'young':'';
}
export function isMinorAppearance(age,{group,ignoreCase=false}={}){
    return group==='child'||/^\d+ years old$/.test(age)&&parseInt(age)<18||(ignoreCase?/teenage|child/i:/teenage|child/).test(age);
}
/** Mirrors the story-fact path: only bust is removed; the caller rebuilds tags. */
export function protectStoryTraits(traits,age){
    const minor=isMinorAppearance(age,{group:traits.age_group?.[0],ignoreCase:true});
    if(minor)delete traits.bust;
    return minor;
}
/** Mirrors the unbound identity path: bust/build facets are suppressed. */
export function protectIdentityTags(tags,age,tagInfo){
    return isMinorAppearance(age)?tags.filter(tag=>!['bust','build'].includes(tagInfo[tag]?.facet)):tags;
}
/** This selects age wording for a caption; it does not infer an unstated age. */
export function isYouthAppearance(traits,tags){return traits.age_group?.[0]==='child'||tags.includes('teenage');}
export function nativeBodyVisibility(visible=true){return visible?'sfw':'hidden';}
export function nativeBodyField({full=false,back=false}={}){return (full?'fullBody':'upperBody')+'SFW'+(back?'Back':'');}
export function emptyNativeBodyFields(){return Object.fromEntries([...NATIVE_SFW_FIELDS,...NATIVE_NSFW_FIELDS].map(key=>[key,'']));}
/** Offline catalog preview eligibility only; never filters a drawing API request. */
export const CATALOG_PREVIEW_POLICY=Object.freeze({
    blockedTags:Object.freeze(['loli','shota','child','toddler','baby','chibi','super deformed','furry','anthro','nude','naked']),
    knownChildIds:Object.freeze(['konomori_kanon','anya_(spy_x_family)','klee_(genshin_impact)','qiqi_(genshin_impact)','nahida_(genshin_impact)','diona_(genshin_impact)','yaoyao_(genshin_impact)','sigewinne_(genshin_impact)','alice_(blue_archive)','arisu_(blue_archive)'])
});
// The offline Python builder reads this same definition; no third-party dependency.
if(typeof process!=='undefined'&&process.versions?.node&&/[\\/]drawing-policy\.mjs$/.test(process.argv[1]||'')&&process.argv[2]==='--export-catalog-policy')console.log(JSON.stringify(CATALOG_PREVIEW_POLICY));
