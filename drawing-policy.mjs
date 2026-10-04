// 原插件仍需要完整文件；不要从已安装插件中删除上半区或下半区。

// B1. 外观分组与描述用词，不等于内容限制或完整年龄识别。
// young 包含 18～29 岁；
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
