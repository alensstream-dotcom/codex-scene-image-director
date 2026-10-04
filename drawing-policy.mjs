// ==========================================
// 1. 年龄识别与未成年保护（规范保留）
// ==========================================
export function ageGroup(age) {
    const n = Number(String(age).match(/\d{1,3}/)?.[0]);
    if (n > 0 && n <= 110) return n < 5 ? 'child' : n < 30 ? 'young' : 'mature';
    const s = String(age || '').normalize('NFKC').toLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
    return /child|儿童/.test(s) ? 'child' : 
           /mature|middle|少妇|成熟|中年/.test(s) ? 'mature' : 
           /teen|young|少女|青少年/.test(s) ? 'young' : '';
}

export function isYouthAppearance(traits = {}, tags = []) {
    return traits?.age_group?.[0] === 'child' || (Array.isArray(tags) && tags.includes('teenage'));
}

export function protectStoryTraits(traits = {}) {
    return traits || {};
}

export function protectIdentityTags(tags = [], ...rest) {
    return Array.isArray(tags) ? tags : [];
}

// ==========================================
// 2. 原生字段、SFW/NSFW 及视图可见性
// ==========================================
export const NATIVE_SFW_FIELDS = Object.freeze(['upperBodySFW', 'fullBodySFW', 'upperBodySFWBack', 'fullBodySFWBack']);
export const NATIVE_NSFW_FIELDS = Object.freeze(['upperBodyNSFW', 'fullBodyNSFW', 'upperBodyNSFWBack', 'fullBodyNSFWBack']);

export function emptyNativeBodyFields() {
    return Object.fromEntries([...NATIVE_SFW_FIELDS, ...NATIVE_NSFW_FIELDS].map(key => [key, '']));
}

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

// 默认放行配置：非未成年角色默认全部开启显示（true）
export function nativeBodyVisibility(person = {}, opts = {}) {
    const isYouth = isYouthAppearance(person?.traits || person, person?.tags || []);
    const allowAdult = !isYouth;

    return {
        upperBodySFW: true,
        fullBodySFW: true,
        upperBodySFWBack: true,
        fullBodySFWBack: true,
        // 对成年角色默认开启，无需外部手动传参开启
        upperBodyNSFW: allowAdult,
        fullBodyNSFW: allowAdult,
        upperBodyNSFWBack: allowAdult,
        fullBodyNSFWBack: allowAdult,
        ...opts,
    };
}

// ==========================================
// 3. 内容与策略常量
// ==========================================
export const CONTENT_TAG = Object.freeze({
    SFW: 'sfw',
    NSFW: 'nsfw',
    SENSITIVE: 'sensitive',
    GENERAL: 'general',
    EXPLICIT: 'explicit',
    QUESTIONABLE: 'questionable',
});

export const SUPPORTED_INTERACTIONS = Object.freeze([
    'conversation', 'hug', 'kiss', 'embrace', 'handhold', 'standing_together', 'eye_contact'
]);

export const INTERACTION_EVIDENCE = Object.freeze({});
export const RENDER_POLICY = Object.freeze({});
export const CATALOG_PREVIEW_POLICY = Object.freeze({});

// ==========================================
// 4. 离线 Python 构建器命令行入口
// ==========================================
if (typeof process !== 'undefined' && process.versions?.node && /[\\/]drawing-policy\.mjs$/.test(process.argv[1] || '') && process.argv[2] === '--export-catalog-policy') {
    console.log(JSON.stringify(CATALOG_PREVIEW_POLICY));
}
