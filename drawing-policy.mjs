/**
 * 本文件没有 import、网络请求或文件读取。
 * 上半区：本文件中的全部内容保护与范围限制定义，可独立复制。
 * 下半区：插件使用的分类、兼容字段结构和离线导出辅助代码。
 * 世界书模型指令及后端/工作流规则是独立层，不包含在此代码复制区内。
 * 所有导出名称与原逻辑保持不变；调用方继续负责绑定、镜头和通信流程。
 */

// ==================== 可复制限制代码：开始 ====================
/**
 * 复制本区域至自己的 .mjs 文件，按需 import 并调用。
 * 本区域不引用下半区，也不依赖酒馆、ComfyUI、角色库文件或插件全局变量。
 * 这些定义不会自动接管请求；函数需要由调用方传入年龄、特征和标签分类。
 * 这不是完整的内容检测器；SFW 标记也不能保证后端实际输出的图片内容。
 */

// A1. 年龄与未成年特征保护。
// 保留原有输入约定："17 years old"、teenage/child 或显式 group='child'。
// young 外观分组同时包含未成年与成年人，不能直接作为成年判据。
export function isMinorAppearance(age,{group,ignoreCase=false}={}){
    return group==='child'||/^\d+ years old$/.test(age)&&parseInt(age)<18||(ignoreCase?/teenage|child/i:/teenage|child/).test(age);
}
// 剧情事实路径：直接修改传入 traits，只删除未成年胸型；返回是否命中。
export function protectStoryTraits(traits,age){
    const minor=isMinorAppearance(age,{group:traits.age_group?.[0],ignoreCase:true});
    if(minor)delete traits.bust;
    return minor;
}
// 未绑定身份路径：抑制未成年 bust/build 标签，不修改原标签数组。
// tagInfo 是调用方自己的 {标签: {facet: 分类}} 对象，不会从任何数据库加载。
export function protectIdentityTags(tags,age,tagInfo){
    return isMinorAppearance(age)?tags.filter(tag=>!['bust','build'].includes(tagInfo[tag]?.facet)):tags;
}

// A2. SFW 内容约定。后两项用于原插件的旧格式，其他项目可按需采用。
// 只返回标记/字段名称；不会连接旧插件，也不会查找字段对应的文件。
export const CONTENT_TAG='SFW';
export function nativeBodyVisibility(visible=true){return visible?'sfw':'hidden';}
export function nativeBodyField({full=false,back=false}={}){return (full?'fullBody':'upperBody')+'SFW'+(back?'Back':'');}

// A3. 离线角色预览池的范围限制：只提供数据，不筛选绘图 API 请求。
// knownChildIds 是原角色库的已知 ID 清单；其他项目应按自己的数据调整。
export const CATALOG_PREVIEW_POLICY=Object.freeze({
    blockedTags:Object.freeze(['loli','shota','child','toddler','baby','chibi','super deformed','furry','anthro','nude','naked']),
    knownChildIds:Object.freeze(['konomori_kanon','anya_(spy_x_family)','klee_(genshin_impact)','qiqi_(genshin_impact)','nahida_(genshin_impact)','diona_(genshin_impact)','yaoyao_(genshin_impact)','sigewinne_(genshin_impact)','alice_(blue_archive)','arisu_(blue_archive)'])
});

// A4. 原插件的互动范围和主体约定：属于绘图业务范围，按需复制。
// 证据正则仅确认剧情中已出现的动作；镜头、人物归属和衣装流程不在这里。
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

// ==================== 可复制限制代码：结束 ====================
// ==================== 下方：插件需要的辅助代码 ====================
// 单独复制上半区时，不需要复制下面的代码。
// 原插件仍需要完整文件；不要从已安装插件中删除上半区或下半区。

// B1. 外观分组与描述用词，不等于内容限制或完整年龄识别。
// young 包含 13～29 岁；未知数值年龄不会被自动判为成年。
export function ageGroup(age){
    const n=Number(String(age).match(/\d{1,3}/)?.[0]);
    if(n>0&&n<=110)return n<13?'child':n<30?'young':'mature';
    const s=String(age||'').normalize('NFKC').toLowerCase().replaceAll('_',' ').replace(/\s+/g,' ').trim();
    return /child|儿童|小女孩|幼女/.test(s)?'child':/mature|middle|少妇|成熟|中年/.test(s)?'mature':/teen|young|少女|青少年/.test(s)?'young':'';
}
export function isYouthAppearance(traits,tags){return traits.age_group?.[0]==='child'||tags.includes('teenage');}

// B2. 旧格式字段结构：保留八个名称；名字含 NSFW 不代表启用任何后端开关。
export const NATIVE_SFW_FIELDS=Object.freeze(['upperBodySFW','fullBodySFW','upperBodySFWBack','fullBodySFWBack']);
export const NATIVE_NSFW_FIELDS=Object.freeze(['upperBodyNSFW','fullBodyNSFW','upperBodyNSFWBack','fullBodyNSFWBack']);
export function emptyNativeBodyFields(){return Object.fromEntries([...NATIVE_SFW_FIELDS,...NATIVE_NSFW_FIELDS].map(key=>[key,'']));}

// B3. 离线 Python 构建器读取预览池定义的可选命令行入口。
// 只有直接运行 node drawing-policy.mjs --export-catalog-policy 时才输出 JSON。
// 普通 Node / 浏览器 import 不需要 Python、不启动构建器、不执行文件读取。
if(typeof process!=='undefined'&&process.versions?.node&&/[\\/]drawing-policy\.mjs$/.test(process.argv[1]||'')&&process.argv[2]==='--export-catalog-policy')console.log(JSON.stringify(CATALOG_PREVIEW_POLICY));
