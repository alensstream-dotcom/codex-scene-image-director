// Supply missing native prompts. The native request builders, API selection,
// confirmation dialogs, storage, and role expansion remain authoritative.
export const NATIVE_AI_PROFILE_VERSION = 1;
import {CONTENT_TAG,nativeBodyVisibility} from './drawing-policy.mjs';
const entry = (id, role, content) => ({ id, role, content, enabled:true, triggerMode:'always', triggerWords:'', andTriggerWords:'' });
const profile = (instruction, variables) => ({ entries:[entry(1,'system',instruction),entry(2,'user',variables)] });

const schema = `人物用 <人物>...</人物>；衣装用 <服装>...</服装>。每个字段独占一行，使用 ASCII 冒号。衣装紧跟其主人，归属人填写人物英文名称。
<人物>
中文名称: 明确的人物姓名
英文名称: 唯一英文标识
角色特征: 性别、已知年龄、发色发型等永久身份标签
五官外貌: 眼色、眼型、脸型等稳定描述
五官外貌背面:
上半身SFW: 可见上半身体态标签
上半身SFW背面:
下半身SFW: 可见下半身体态标签
下半身SFW背面:
</人物>
<服装>
归属人: 人物英文名称
中文名称: 衣装名称
英文名称: 唯一衣装标识
上半身: 上衣、外套、上半身饰物标签
上半身背面:
下半身: 裙裤、鞋袜标签
下半身背面:
</服装>`;

export const NATIVE_AI_PROFILES = {
    char_design: {
        name:'Animadex·原生角色服装设计',
        data:profile(`你为智绘姬原生角色管理生成结构化预设。只处理用户指定的明确姓名人物；未指定时处理正文里当前可见、具名的人物。原文事实优先，未知信息保守补全，不编造年龄、剧情或身份。设计漂亮且有区别的脸型和发型，衣装严格按正文或用户要求。永久身份与衣装分开；表情、动作、背景不放入永久字段。只输出人物和服装块，不输出思考、说明、Markdown 或图片按钮。字段值用英文绘图标签，保留中文姓名；未出现的字段留空。${schema}`,
            '用户需求：\n{{用户需求}}\n当前正文：\n{{正文}}'),
    },
    char_modify: {
        name:'Animadex·原生角色服装修订',
        data:profile(`你修改智绘姬当前选中的角色或服装预设。用户明确要求修改的字段才改变，其余已保存字段、中文名称、英文名称和归属人原样保留。角色外貌与服装分开，不用衣服改变发型，不借另一个人物的设定。只返回完整的相应人物块或服装块，不输出思考、说明、Markdown 或图片按钮。标签用英文，未填写字段留空。${schema}`,
            '用户需求：\n{{用户需求}}\n当前角色：\n{{当前角色}}\n当前服装：\n{{当前服装}}'),
    },
    char_display: {
        name:'Animadex·原生角色服装展示',
        data:profile(`你为智绘姬当前角色或服装生成一张展示图的提示词。使用提供的英文名称作为原生引用；角色和服装的完整身份标签由智绘姬展开，不重新描述发色、发型、眼色、脸型或衣服。优先选择与角色绑定的当前衣装；用户未要求换装时保留。镜头、背景、光照和画风放在 Scene Composition；人物引用、衣装引用、动作与表情放在 Character 1 Prompt。默认单人、${CONTENT_TAG}、704x1152；自然优雅的全身或用户指定的构图，漂亮精细、柔和光照，避免裁脚。只输出 image###...;###，不输出规划、思考或说明。
角色 JSON 包含 name、angle、upperBody、lowerBody；服装 JSON 不含 angle。可见部位用 sfw（角色）/visible（服装）；不出镜部位 hidden。角色须先于衣装。示例（将名称替换为提供的真实英文名称）：
image###Scene Composition:${CONTENT_TAG}, 1girl, solo, full body, garden, soft daylight, @Painterly, 704x1152; Character 1 Prompt:$${JSON.stringify({name:'ROLE_EN',angle:'front',upperBody:nativeBodyVisibility(),lowerBody:nativeBodyVisibility()})}$, $${JSON.stringify({name:'OUTFIT_EN',upperBody:'visible',lowerBody:'visible'})}$, sitting on a bench, reading a book, gentle smile;###
若只提供服装而没有人物，使用该服装原生引用与普通成年女性模特，不捏造具名角色。没有衣装资料时不编造衣装引用。`,
            '用户需求：\n{{用户需求}}\n当前角色：\n{{当前角色}}\n角色绑定服装：\n{{服装列表}}\n当前服装：\n{{当前服装}}'),
    },
};

function hasPrompt(data) {
    if (Array.isArray(data?.entries)) return data.entries.some(e=>e.enabled&&String(e.content || '').trim());
    return (data?.history || []).some(e=>String(e.user || '').trim()||String(e.assistant || '').trim());
}

export function installMissingNativeAIProfiles(native) {
    native.test_context_profiles ??= {};
    native.llm_request_type_configs ??= {};
    const added=[], selected=[];
    const missing=Object.keys(NATIVE_AI_PROFILES).filter(kind=>{
        const current=native.llm_request_type_configs[kind]?.context_profile || '默认';
        return !hasPrompt(native.test_context_profiles[current] || Object.values(native.test_context_profiles)[0]);
    });
    for (const [kind, preset] of Object.entries(NATIVE_AI_PROFILES)) {
        if (!native.test_context_profiles[preset.name]) {
            native.test_context_profiles[preset.name]=structuredClone(preset.data);
            added.push(preset.name);
        }
        const config=native.llm_request_type_configs[kind];
        if (missing.includes(kind)) {
            // API profile choice/credentials are preserved. Select only missing
            // native context prompts; never replace a working user profile.
            native.llm_request_type_configs[kind]={...(config || {api_profile:'默认'}),context_profile:preset.name};
            selected.push(kind);
        }
    }
    return {version:NATIVE_AI_PROFILE_VERSION,added,selected,changed:added.length>0||selected.length>0};
}
