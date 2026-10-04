// B1. 外观分组与描述用词，不等于内容限制或完整年龄识别。
// young 包含 18～29 岁；
export function ageGroup(age){
    const n=Number(String(age).match(/\d{1,3}/)?.[0]);
    if(n>0&&n<=110)return n<13?'child':n<30?'young':'mature';
    const s=String(age||'').normalize('NFKC').toLowerCase().replaceAll('_',' ').replace(/\s+/g,' ').trim();
    return /child|儿童|小女孩|幼女/.test(s)?'child':/mature|middle|少妇|成熟|中年/.test(s)?'mature':/teen|young|少女|青少年/.test(s)?'young':'';
}
export function isYouthAppearance(traits,tags){return traits.age_group?.[0]==='child'||tags.includes('teenage');}

// 补充：保护特征导出
export function protectStoryTraits(traits = {}) {
    return traits;
}

// B2. 旧格式字段结构：保留八个名称；名字含 NSFW 不代表启用任何后端开关。
export const NATIVE_SFW_FIELDS=Object.freeze(['upperBodySFW','fullBodySFW','upperBodySFWBack','fullBodySFWBack']);
export const NATIVE_NSFW_FIELDS=Object.freeze(['upperBodyNSFW','fullBodyNSFW','upperBodyNSFWBack','fullBodyNSFWBack']);
export function emptyNativeBodyFields(){return Object.fromEntries([...NATIVE_SFW_FIELDS,...NATIVE_NSFW_FIELDS].map(key=>[key,'']));}

// 补充：根据参数计算出 8 个字段名之一（兼容对象传参与多参数传参，兜底 upperBodySFW）
export function nativeBodyField(arg1 = {}, nsfw = false, back = false) {
    if (typeof arg1 === 'object' && arg1 !== null) {
        const full = Boolean(arg1.full || arg1.isFull || arg1.fullBody || arg1.view === 'fullBody');
        const isNsfw = Boolean(arg1.nsfw || arg1.isNsfw);
        const isBack = Boolean(arg1.back || arg1.isBack);
        return `${full ? 'fullBody' : 'upperBody'}${isNsfw ? 'NSFW' : 'SFW'}${isBack ? 'Back' : ''}`;
    }
    const full = Boolean(arg1 === true || String(arg1).toLowerCase().includes('full'));
    return `${full ? 'fullBody' : 'upperBody'}${nsfw ? 'NSFW' : 'SFW'}${back ? 'Back' : ''}`;
}

// 补充：防止后续调用方导入 CATALOG_PREVIEW_POLICY 再次报错
export const CATALOG_PREVIEW_POLICY = {};

// B3. 离线 Python 构建器读取预览池定义的可选命令行入口。
// 只有直接运行 node drawing-policy.mjs --export-catalog-policy 时才输出 JSON。
// 普通 Node / 浏览器 import 不需要 Python、不启动构建器、不执行文件读取。
if(typeof process!=='undefined'&&process.versions?.node&&/[\\/]drawing-policy\.mjs$/.test(process.argv[1]||'')&&process.argv[2]==='--export-catalog-policy')console.log(JSON.stringify(CATALOG_PREVIEW_POLICY));
