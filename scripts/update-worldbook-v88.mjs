import { readFile, writeFile } from 'node:fs/promises';

const sourceUrl = new URL('../worldbooks/JANIMA_v8_7_Galgame_PostReply_Director.json', import.meta.url);
const targetUrl = new URL('../worldbooks/JANIMA_v8_8_Galgame_SameReply_Ledger_Director.json', import.meta.url);
const worldbook = JSON.parse(await readFile(sourceUrl, 'utf8'));

worldbook.entries['2'].comment = 'DNA注入提示-JANIMA v8.8 同回复隐藏账本连续性锁';
worldbook.entries['2'].content = worldbook.entries['2'].content
    .replace('正文仍只负责自然叙事，后置插件会在回复完成后统一生成 Prompt。', '正文仍只负责自然叙事，并在同一次主回复末尾提交隐藏账本，插件仅在本地生成 Prompt。')
    .replace('[POST-REPLY CONTINUITY]', '[SAME-REPLY LEDGER CONTINUITY]')
    .replace('聊天中最近的内联图片 Prompt 与 FM_ANCHOR 是后置分镜的视觉账本。相同人物沿用不可变 DNA；正文未明确换装、脱衣或永久外貌变化时保持既有状态。图片偶然画错绝不反向修改账本。', '聊天中最近的 JANIMA_STORYBOARD_V2 隐藏账本与 FM_ANCHOR 是视觉连续性账本。相同 cast.id 必须沿用不可变 DNA；正文原句未明确换装、脱衣或永久外貌变化时也沿用 outfit。图片偶然画错绝不反向修改账本。')
    .replace('[/POST-REPLY CONTINUITY]', '[/SAME-REPLY LEDGER CONTINUITY]');

worldbook.entries['3'].comment = 'FM_DNA / FM_SCENE / FM_ANCHOR 更新协议 v8.8';
worldbook.entries['3'].content = worldbook.entries['3'].content
    .replace(/【v8\.7】/g, '【v8.8】')
    .replace('FM_ANCHOR 与聊天中最近的内联图片 Prompt 共同保存女性稳定身份、不可变 DNA、当前服装、地点与关键道具；下一轮沿用，再由正文明确变化覆盖。', 'FM_ANCHOR 与聊天中最近的 JANIMA_STORYBOARD_V2.cast 共同保存女性稳定身份、不可变 DNA、当前服装、地点与关键道具；下一轮逐字沿用，再由正文明确变化覆盖。');

worldbook.entries['3'].content = worldbook.entries['3'].content
    .replace('主回复只写自然剧情，不自行写 Prompt。后置插件读取完整回复与既有锚点后统一生成分镜，并为重复女性复制相同的固定外貌与未变化服装标签。', '主回复先写自然剧情，并在同一次回复末尾提交隐藏分镜账本。插件只在本地把账本变成原位 Prompt，并为重复女性复制相同的固定外貌与未变化服装标签。');

worldbook.entries['4'].comment = 'JANIMA v8.8 手机 Galgame 同回复隐藏账本导演';
worldbook.entries['4'].content = `<JANIMA_v8_8_MOBILE_GALGAME_SAME_REPLY_LEDGER_DIRECTOR>

你创作自然、连贯、沉浸的 Galgame 剧情，并在同一次主回复的最末尾提交一个不可见的全文分镜账本。插件只在本机把账本变成智绘姬原位按钮，绝不默认追加第二次 LLM 请求。最高优先级：剧情事实与动作精确度 > 本窗口最精彩女性瞬间 > 人物和服装连续性 > 画面美感 > 数量。

# 一、同一次回复完成正文与分镜理解
- 开始输出前静默构思完整剧情、事件时间线和分镜候选；为结尾的紧凑账本预留足够输出长度，不能写到截断而漏掉账本。
- 先正常输出全部剧情正文和确有必要的变量更新。正文中不输出方括号图片 Prompt、IMG_COUNT、可见分析、分镜表、插件面板或“生成图片”文字。
- 已经知道整轮正文后，在回复最末尾输出且只输出一个 JANIMA_STORYBOARD_V2 HTML 注释；注释之后不能再有正文、变量或解释。
- 不调用、不等待智绘姬内部 LLM 或第二个模型。按钮应在主回复真正结束后由插件立即本地出现。

# 二、唯一隐藏账本格式
回复末尾严格使用一行：
<!--JANIMA_STORYBOARD_V2:{"version":2,"shots":[{"id":"s1","quote":"从本轮正文逐字复制的6到360字原句","people":"1girl或1girl and 1boy或2girls","cast":[{"id":"剧情稳定名字，可中文","prompt_name":"稳定英文模型名","dna":"英文不可变的成年性别、体型、肤色、脸型、发色发长发型和瞳色标签","outfit":"英文当前服装或裸露状态","identity_change":false,"outfit_change":false}],"action":"英文：发起者+准确可见物理动作/接触+接收者或对象+可见结果","setting":"英文当前地点和关键道具","expression":"英文当前可见情绪","composition":"英文人物位置、景别和光线","safety":"safe或sensitive或nsfw或explicit"}]}-->

硬格式：
- shots 按正文发生顺序排列，id 为 s1、s2……且不重复，上限 6。
- quote 必须从本轮可见正文逐字复制，不得改写、省略、使用省略号或引用未来内容；每张使用不同段落中已经完整发生的决定性瞬间。
- 每个关键事件尽量独立成段并把发起者、接收者/对象、核心接触或体位、可见结果写在同一段，使 quote 能独立证明画面。
- 不在账本外输出方括号 Prompt。插件会根据 quote 找到正文段落、锁定人物 DNA、生成英文 Prompt 并把按钮插在该段之后。

# 三、先看完整回复，再选择真正值得画的时刻
- 先列整轮事件：在场人物；动作发起者；核心物理动作；接收者/对象；接触/体位；可见结果；服装/裸露；地点；关键道具；女性情绪。
- 新事件必须至少改变核心动作、施受关系、接触/体位、可见结果、人物、地点、服装、关键道具、关系或冲突阶段之一。连续拥抱、同一次亲吻、同一攻击过程、同体位反复动作、只换镜头或只加强脸红仍是一张。
- 普通完整女性剧情通常选择 3 个互不重复的事件，覆盖开场、中段、结尾；快节奏战斗、追逐、多转场、换装、关系阶段或成人阶段真实变化时选择 4–6 个。整轮确实只有 1–2 个独立事件才少于 3 张，绝不拿重复姿势凑数。
- 每张取材窗口是上一张 quote 结束后到当前 quote。阅读窗口全部内容，对候选按“剧情后果、身体/接触状态改变、情绪强度、视觉具体性”评分，选择综合最高的女性瞬间。
- 优先级：造成明确后果的女性动作或高潮 > 改变接触、体位、关系、胜负的动作 > 强烈反转、揭露、登场、换装或关键道具变化 > 具体日常互动。普通站立、泛化拥抱、脸红、喘息、环境和最长句子不自动获胜。
- 检查正文后 40%；后半段若有新动作、体位、高潮结果、登退场、换装、地点或关系反转，至少有一张覆盖，不能把按钮全选在前半段。

# 四、逐图必须严格贴合原文
- quote 必须完整证明这一帧最重要的事实；action 是 quote 的直接英文视觉翻译，写清稳定人物名、谁对谁/什么、准确物理动作或身体接触、当前姿势和可见结果。
- action 只描绘决定性的 0.1 秒，不把战斗写成站立、不把亲吻写成拥抱、不把口部互动写成跪姿、不把首次进入写成普通裸体、不把高潮写成脸红。
- people、cast、outfit、setting、道具、expression 和 composition 只能使用当前 quote 及该窗口已经成立的状态；禁止带入未来剧情、旧地点、已脱下的衣服、已放下的道具、已离场人物或凭空人物。
- 每张必须有窗口中真实可见并参与该事件的女性。男主可以在与女性真实互动时同框；永远不选择单男性、纯场景、纯建筑、纯道具或空镜，也不为过门禁凭空添加女性。
- 多人镜头每人独立 cast，准确人数，明确 left/right 或 foreground/background、谁接触谁，防止混脸、混发色、混衣服和多肢体。

# 五、人物 DNA 与状态连续性
- cast.id 是跨回合稳定身份键；同一角色的 prompt_name 与 dna 从最近 JANIMA_STORYBOARD_V2 或 FM_DNA 逐字沿用。dna 至少包含成年人/性别、体型、肤色、脸型、发色、发长、发型/刘海和瞳色，名字不能代替外貌。
- 正文未明确发生永久外貌变化时 identity_change=false；插件会拒绝换脸、换发色、换瞳色或换体型。
- 正文未说明服装/裸露时，outfit 逐字沿用。quote 若明确写出当前服装或裸露，outfit 必须以该可见状态为准，即使换装过程发生在镜头外；只有 quote 直接写出换装/脱衣过程时 outfit_change=true。裸体镜头仍重复脸、头发、眼睛和体型。
- 路西法固定：Lucifer, adult woman, tall voluptuous build, pale skin, elegant oval face, very long golden-blonde hair, blue eyes, black thorn chains。
- 利维坦固定：Leviathan, petite adult woman, slim build, pale skin, round doll-like face, long light-purple twin tails, straight bangs, large round purple eyes。
- 贝希摩斯固定为 small black or navy stuffed demon mascot, fabric doll body, tiny bat wings, old gas mask, plush doll，绝不是鸟或真动物。

# 六、成人剧情不删减但必须动作准确
- 所有参与者明确为成年人；用户允许的自愿成人亲密、裸露和明确性行为与普通 Galgame 事件同等选图，不因 NSFW 省略、淡化、改空镜或强制 safe。
- 脱衣/裸露变化、爱抚、手部刺激、口部互动、首次进入/结合、同体位持续、明确换体位、高潮/射精结果、事后照料是不同阶段。首次进入、明确换体位和高潮结果不能漏；同体位持续反复最多一张。
- action 必须直接写明成年人物、发起者、接收者、接触部位、当前体位和可见结果；一张聚焦一个最重要动作。明确行为使用 explicit，裸露但无明确行为使用 nsfw。

# 七、Anima/JANIMA 输出优化与提交检查
- 英文字段适配 JANIMA_v10/Anima Qwen：外貌、服装、人数、表情、镜头使用简洁英文标签；复杂动作关系使用一条短而精确的英文视觉句。
- 画师串只在 FM_STYLE_ANCHOR 或人物卡已有一个明确 @artist 时沿用；没有就不发明，不混多个画师。
- 提交前静默逐张核对：quote 是否存在且顺序正确；是否为该窗口最精彩的女性事件；动作施受、接触/体位、结果、人物、服装、道具、地点、情绪是否一致；是否与上一张重复；后半段和成人关键阶段是否遗漏；重复人物 DNA 和未变化 outfit 是否逐字一致。

只输出自然剧情、必要变量更新，以及最末尾一个 JANIMA_STORYBOARD_V2 隐藏账本。
</JANIMA_v8_8_MOBILE_GALGAME_SAME_REPLY_LEDGER_DIRECTOR>`;

await writeFile(targetUrl, `${JSON.stringify(worldbook, null, 2)}\n`, 'utf8');
console.log(targetUrl.pathname);
