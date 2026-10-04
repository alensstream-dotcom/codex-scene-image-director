import {worldbookInstruction} from './worldbook-library.mjs';
/** Default protocol used only before the editable worldbook migration. */
export const AUTOMATIC_INSTRUCTION=`【剧情插图协议 v2】本协议替代旧世界书、预设与历史消息中的图片模板。所有新图片块必须用 ADCAP JSON，不使用 image###Scene Composition: 旧格式；只替换图片块格式，正常写剧情和原有状态栏。ADSCENE 是本地插件的内部按钮标记，不能输出、复制或编造；每轮重新描述当前画面，用 ADCAP。普通可见场景按回复长度选 1～3 个不同视觉时刻，每块紧跟对应段落；短回复可一张。不要输出插图规划、审查或额外思考。只描绘非露骨场景；不适合人物插图的段落可用环境镜头。不要为插图改写剧情。
图片格式（严格 JSON）：
image###ADCAP{"v":2,"summary":"中文画面说明","scene":"English camera, framing, background, lighting tags","people":[{"name":"正文人物完整姓名","appearance":{},"outfit":{"mode":"keep","items":[]},"action":"English exact visible posture, expression, action"}]}END;###
最多4位人物。已有绑定人物 appearance 用 {}；新人物可写 {"required":{"gender":["female"],"hair_color":["black"]}}，只填正文明确特征。姓名不使用她/他/你等代词。scene 不写固定外貌和衣装，action 只写此人的动作。女性是画面主要主体；环境图 people 用 []。
衣装用 outfit，mode 为 snapshot（完整当前衣装）、patch（仅更新变化）或 keep（没有新事实）。每件衣物格式 {"id":"coat","name":"灰外套","state":"worn","tags":["grey coat"],"state_tags":[],"condition_tags":[]}；同一衣物保持 id。state 可用 worn/removed/open/partly_open/rolled/loose/held/draped。款式没变不等于穿着状态没变：卷起袖口用 patch+rolled，state_tags:["rolled sleeves"]；放下袖口用 patch+worn，state_tags:[]，不能 keep 或继续保留 rolled sleeves；tags:[] 可复用原款式。明确脱下用 removed，未提衣物不等于脱下，不混用前后时刻。新人物正文明确衣装时应写 snapshot。
明确脱下后放在椅背、桌面等家具上的衣物，state 必须用 removed；道具位置写入 scene，不能当作人物身上的 draped。draped 用于正文明确披在身上的衣物，state_tags 必须写明确位置；不猜测披肩。无图段落明确换装时可记录 <!--ADMEM{"v":2,"people":[{"name":"完整姓名","outfit":{"mode":"patch","items":[{"id":"coat","name":"灰外套","state":"removed","tags":[],"state_tags":[],"condition_tags":[]}]}}]}END-->。
普通成年角色拥抱/牵手/共舞可增加 interactions:[{"kind":"hug|holding_hands|arm_in_arm|dance|hand_on_shoulder|helping_up","initiator":"完整姓名","recipient":"另一完整姓名","view":"auto|pov|third_person","partner_visibility":"hands|arms|torso|full"}]；双方都列入 people，各写自己的动作。`;
export function automaticPrompt(story,settings={},outfits={}){
    if(settings.enabled===false||settings.automatic===false||settings.worldbook_read_error)return '';
    const people=Object.values(story?.cast?.people||{}).slice(-8).map(p=>({name:p.person,aliases:p.aliases||[],appearance:p.story_appearance?.traits||{},age:p.age_description||'',height_cm:p.story_appearance?.height_cm||null}));
    const clothes=Object.entries(outfits).slice(-4).filter(([,outfit])=>outfit?.known).map(([name,outfit])=>({name,items:outfit.items.slice(0,6).map(item=>({id:item.id,state:item.state,design:item.tags.join(', ').slice(0,80),state_tags:(item.state_tags||[]).join(', ').slice(0,60)}))}));
    const rules=worldbookInstruction(settings);if(rules===null||rules===''&&settings.worldbook_library?.books.find(b=>b.name===settings.worldbook_library.active)?.mode!=='native')return '';
    return (rules??AUTOMATIC_INSTRUCTION+'\n精简 tags：scene 最多8个短标签（构图、地点、一个光线描述），action 最多6个短标签（一个主要动作、必要道具、一个表情）。不堆叠主体强调、精细五官和同义光线。剧情人物的胸型、身高、瞳色、发色、发长、发型、年龄只填写明确事实；未说明保持未知。')+(people.length?'\n已确认人物外貌：'+JSON.stringify(people)+'。正文与图片描述必须沿用这些条件，不能擅自改变发色、发长、眼睛和年龄；只有明确染发、剪发等变化才更新。appearance 用 {}，不能借原型名替换剧情人物。':'')+(clothes.length?'\n生成前的已确认衣装状态（本轮明确变化必须逐件 patch；提示可能只列部分衣物，不可当完整 snapshot）：'+JSON.stringify(clothes):'');
}
