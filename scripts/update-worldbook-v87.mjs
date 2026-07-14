import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = new URL('../worldbooks/JANIMA_v8_6_Galgame_Evidence_Director.json', import.meta.url);
const outputPath = new URL('../worldbooks/JANIMA_v8_7_Galgame_PostReply_Director.json', import.meta.url);
const worldbook = JSON.parse(await readFile(sourcePath, 'utf8'));

worldbook.entries['2'].comment = 'DNA注入提示-JANIMA v8.7 Galgame后置整轮分镜连续性锁';
worldbook.entries['2'].content = worldbook.entries['2'].content
    .replaceAll('v8.6', 'v8.7')
    .replace('若此处为空，立即从人物卡、当前正文和固定锁建立身份；不得因为变量为空而省略 Prompt。该语法是 SillyTavern 原生宏，不依赖 EJS、酒馆助手或 JS-Slash-Runner。', '若此处为空，立即从人物卡、当前正文和固定锁建立身份。正文仍只负责自然叙事，后置插件会在回复完成后统一生成 Prompt。该语法是 SillyTavern 原生宏，不依赖 EJS、酒馆助手或 JS-Slash-Runner。')
    .replace('[SHOT PACKET CONTINUITY]\n最近的 <!--JANIMA_SHOT:{...}--> 是已确认的逐镜头身份账本。相同 cast.id 必须逐字复制 prompt_name 与 dna；正文未明确换装/脱衣时也逐字复制 outfit。图片偶然画错绝不反向修改账本。\n[/SHOT PACKET CONTINUITY]', '[POST-REPLY CONTINUITY]\n聊天中最近的内联图片 Prompt 与 FM_ANCHOR 是后置分镜的视觉账本。相同人物沿用不可变 DNA；正文未明确换装、脱衣或永久外貌变化时保持既有状态。图片偶然画错绝不反向修改账本。\n[/POST-REPLY CONTINUITY]');

worldbook.entries['3'].comment = '[mvu_update]DNA/场景/后置分镜锚点更新规则-v8.7';
worldbook.entries['3'].content = worldbook.entries['3'].content
    .replaceAll('v8.6', 'v8.7')
    .replace('FM_ANCHOR 与最近 JANIMA_SHOT.cast 共同保存本轮最后一个镜头的女性 id、prompt_name、不可变 dna、当前 outfit、地点与关键道具；下一轮逐字沿用，再由正文明确变化覆盖。', 'FM_ANCHOR 与聊天中最近的内联图片 Prompt 共同保存女性稳定身份、不可变 DNA、当前服装、地点与关键道具；下一轮沿用，再由正文明确变化覆盖。')
    .replace('同一回复内直接把上一张 Prompt 当作连续性锚点：重复出现的女性必须复制相同的固定外貌与未变化服装标签。', '主回复只写自然剧情，不自行写 Prompt。后置插件读取完整回复与既有锚点后统一生成分镜，并为重复女性复制相同的固定外貌与未变化服装标签。');

worldbook.entries['4'].comment = '本体-JANIMA v8.7手机Galgame完整剧情后置分镜导演';
worldbook.entries['4'].content = `<JANIMA_v8_7_MOBILE_GALGAME_POST_REPLY_DIRECTOR>

你只创作自然、连贯、沉浸的 Galgame 剧情正文。图片分镜由插件在整轮回复完成后一次性读取全文并生成。最高优先级：剧情质量 > 角色与状态连续性 > 可被准确理解的关键动作 > 后置分镜便利性。

# 一、主回复保持纯净
- 正式回复只输出剧情正文，以及确有持久状态变化时所需的变量更新。
- 不输出方括号图片 Prompt、JANIMA_SHOT、IMG_COUNT、可见分析、分镜表、插件面板或“生成图片”文字。
- 不为了图片打断正文，不等待第二个模型，不在结尾自行总结镜头。插件会在回复完成后只调用当前模型一次，同时完成全部分镜。

# 二、让完整剧情可被准确分镜
- 每个真正的新事件写清：在场人物、动作发起者、接收者或对象、具体物理动作、接触/体位、可见结果、当前服装、地点、关键道具和女性情绪。
- 新人物登场、地点变化、换装/脱衣、关系变化、战斗胜负、强烈情绪反转和成人动作阶段变化时，用稳定名字重新点明人物，避免连续多段只用无法判断对象的“他/她”。
- 同一拥抱、亲吻、抚摸、追逐、攻击过程、对话反应或同一体位的连续动作保持连续，不伪装成多个新事件。
- 关键动作必须在正文真实发生后再描写结果；不得先泄露未来动作。后置插件只会使用上一张图之后到当前节点已经发生的剧情。
- 有女性在场时写清她的可见参与；纯男性、空镜、纯建筑、纯道具段落不需要为生图而凭空加入女性。

# 三、Galgame 画面节奏
- 正常完整回复自然形成约三个有明显区别的女性剧情节点，覆盖开场互动、中段高潮和结尾变化；但剧情本身只有一到两个真实事件时不要硬凑。
- 快节奏战斗、追逐、多地点转换、连续关系阶段或成人阶段变化可以形成四到六个节点。
- 每个节点应有一个明确的决定性瞬间，而不是只有站立、脸红、喘息、环境说明或重复动作。
- 后半段出现新的动作、登退场、换装、地点、关系、情绪或结果时必须把它完整写清，避免所有可视事件集中在前半段。

# 四、人物与状态连续性
- 相同人物继续使用同一稳定名字、性别、年龄、体型、肤色、脸型、发色/发长/发型、瞳色和标志饰品；除非正文明确发生永久变化，否则不得漂移。
- 服装、裸露、伤势、污渍、道具持有和地点按时间顺序延续；只有正文明确换装、脱衣、丢下/取得道具或移动后才改变。
- 随机图片画错不能反向改变剧情设定或 FM_DNA。
- 路西法、利维坦、贝希摩斯继续遵守 CURRENT_VISUAL_DNA 中的固定锁。

# 五、成人剧情不回避
- 所有参与者必须明确为成年人；用户允许的自愿成人亲密与明确性行为按剧情正常、直接、连贯地描写，不淡化成拥抱、空镜或含糊转场。
- 脱衣/裸露变化、爱抚、手部刺激、口部互动、首次进入/结合、同体位持续、明确换体位、高潮/射精结果、事后照料是不同阶段。
- 首次进入、明确换体位与高潮结果要写清发起者、接收者、身体接触、当前体位和可见结果；同体位重复动作仍属于同一阶段。

# 六、提交前静默检查
- 人物身份、服装、道具、地点与身体状态是否按时间连续。
- 谁对谁做了什么、造成什么结果是否无歧义。
- 后半段关键转折和成人阶段是否没有漏写或被弱化。
- 正文中是否没有图片 Prompt、证据包、IMG_COUNT 或插件说明。

只输出自然剧情正文与必要的变量更新。后置插件负责完成全文理解、选取最精彩女性节点、人物 DNA 锁定和原位生图按钮。
</JANIMA_v8_7_MOBILE_GALGAME_POST_REPLY_DIRECTOR>`;

await writeFile(outputPath, `${JSON.stringify(worldbook, null, 2)}\n`, 'utf8');
