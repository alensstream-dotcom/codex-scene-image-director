import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../worldbooks/JANIMA_v8_0_worldbook.json', import.meta.url);
const worldbook = JSON.parse(await readFile(path, 'utf8'));

worldbook.entries['2'].comment = 'DNA注入提示-JANIMA v8.1角色身份锁';
worldbook.entries['2'].content = `<%_
const dnaLib = getvar('stat_data.FM_DNA', { defaults: {} }) || {};
const names = Object.keys(dnaLib);
function flatten(value){
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flatten).filter(Boolean).join(', ');
  return Object.values(value).map(flatten).filter(Boolean).join(', ');
}
_%>
<CURRENT_VISUAL_DNA>
视觉身份优先级：当前正文明确的临时状态/换装 > FM_DNA当前状态 > 下列固定身份锁。临时换装不能改掉脸型、发色、瞳色、体型等不可变身份。

[CANONICAL LOCK: Lucifer / 路西法]
adult woman, tall voluptuous build, pale skin, elegant oval face, very long golden-blonde hair, blue eyes, proud mature expression, black thorn chains as Garb of Punishment
每一张出现路西法的 Prompt 都要重复这些可见锚点；不得只写 Lucifer 名字。
[/CANONICAL LOCK]

[CANONICAL LOCK: Leviathan / 利维坦]
petite adult woman, slim build, pale skin, round doll-like face, long light-purple twin tails, straight bangs, large round purple eyes, navy and black-purple gothic dress with water-pattern trim
每一张出现利维坦的 Prompt 都要重复这些可见锚点；不得只写 Leviathan 名字。
[/CANONICAL LOCK]

[CANONICAL PROP LOCK: Behemoth / 贝希摩斯]
one small black or navy stuffed demon mascot, fabric doll body, tiny bat wings, old gas mask, plush doll, never a bird or real animal
[/CANONICAL PROP LOCK]

FM_DNA_REGISTERED: <%= names.length ? names.join(', ') : 'none; use canonical locks above immediately' %>
<%_ names.forEach(function(name){ const value = flatten(dnaLib[name]); _%>
[FM_DNA LOCK: <%= name %>]
<%= value || 'empty; rebuild from the character card before writing prompts' %>
[/FM_DNA LOCK]
<%_ }); _%>
</CURRENT_VISUAL_DNA>`;

worldbook.entries['3'].comment = '[mvu_update]DNA/场景/锚点更新规则-v8.1';
worldbook.entries['3'].content = `# FM_DNA / FM_SCENE / FM_ANCHOR 更新规则【v8.1】

没有真实变化时，不输出 <UpdateVariable>。只在新命名角色首次登场、明确换装、持续性身体状态、地点变化或重要图像锚点变化时更新。

## 新角色首次登场必须建 DNA
- FM_DNA 为空不等于可以省略身份：先依据人物卡和当前正文建立该角色条目。
- 每个命名角色单独记录，禁止把两个人的脸、发色、瞳色、体型或衣服混在同一条目。
- DNA 至少记录：英文名、成人/性别、身高体型、肤色、脸型、发色发型刘海、瞳色眼型、标志服装/饰品、当前服装、UC排除。
- 增加一个“完整Prompt”英文字段，写成可直接复制到每张图的 6 至 12 个固定外貌标签；后续每张图都必须重复，不能只写角色名。

## 连续性
- 固定身份只在剧情明确发生永久外貌变化时更新；普通随机出图结果永远不能反向修改 DNA。
- 当前换装只改“当前服装”，不改脸、头发、眼睛和体型。
- 男主也要有稳定身份槽；多角色必须各自保持独立身份。
- FM_ANCHOR 记录最近一张已接受图片所用的角色身份标签、当前服装和关键道具，供下一张重复使用。`;

worldbook.entries['4'].comment = '本体-JANIMA剧情自动生图v8.1-剧情对齐与角色身份锁';
worldbook.entries['4'].content = `<%_
const _fm_dna_v81_ = getvar('stat_data.FM_DNA', { defaults: {} }) || {};
const _fm_names_v81_ = Object.keys(_fm_dna_v81_);
_%>
<JANIMA_v8_1_INLINE_IDENTITY_CONTRACT>

你必须在每次正常剧情回复时，一边写正文，一边把英文生图 Prompt 以独立方括号行插在它所属的剧情段落下方。方括号 Prompt 会被智绘姬变成该剧情正下方的“生成图片”按钮。禁止在结尾集中补按钮。

当前 FM_DNA：<%= _fm_names_v81_.length ? _fm_names_v81_.join('，') : '为空；立即使用 DNA 注入条目的固定身份锁，并在首次登场时建立 FM_DNA' %>

# 一、图片数量
- 正常剧情回复至少 3 个有效 Prompt。
- 普通节奏 3 张：开场状态、核心互动、结尾变化三个不同 beat。
- 地点切换、新角色登场、强表情反转、换装、道具变化或动作阶段转换时 4 张。
- 追逐、战斗、多地点转场可用 5 张；特别长且确有 6 个独立 beat 时才用 6 张。
- 硬上限 6 张。纯设置说明、技术回答或用户明确不写剧情时可以 0 张。

# 二、剧情对齐是最高约束
- 每个 Prompt 只描绘它正上方紧邻段落的那一瞬间。先列出该段“可见人物、动作、服装、道具、地点”，再写 Prompt，但不要输出分析。
- 段落明确有两人时不得写 1girl/solo，也不得把第二人变成影子、远景剪影或背景装饰。段落只有一人时不得凭空增加第二人。
- 当前段落的信息覆盖旧场景：不得带回已经脱下的衣服、已经放下的道具、上一地点或上一动作。
- 每个 Prompt 写 12 至 48 个英文逗号短标签，允许为了完整双人身份超过旧版 30 标签限制。

# 三、同一角色每张图都要重复完整身份 DNA
- 角色名字不是外貌。每个可见命名角色必须在每一张图中重复 6 至 10 个不可变锚点：成人/性别、体型、肤色、脸型、发色、发长、发型/刘海、瞳色、标志服装或饰品。
- 当前换装只覆盖服装部分，绝不覆盖脸、头发、眼睛和体型。
- 当前服装必须用一个 1.20 至 1.30 的加权短语加强，例如 (navy and black-purple gothic dress with water-pattern trim:1.25)；礼服或哥特裙不得偷换成 bodysuit、leotard、lingerie、swimsuit 或 bikini。
- 路西法固定块：Lucifer, adult woman, tall voluptuous build, pale skin, elegant oval face, very long golden-blonde hair, blue eyes, proud mature expression, black thorn chains。
- 利维坦固定块：Leviathan, petite adult woman, slim build, pale skin, round doll-like face, long light-purple twin tails, straight bangs, large round purple eyes, navy and black-purple gothic dress with water-pattern trim。
- 贝希摩斯必须写视觉定义：small black or navy stuffed demon mascot, fabric doll body, tiny bat wings, old gas mask, plush doll, not a bird。
- 剧情明确道具位置时也要加权，例如 (Behemoth mascot perched on Leviathan's shoulder:1.25)，防止布偶漂浮或跑到错误角色身上。

# 四、双人/多人必须分块和定位置
多人 Prompt 顺序固定为：质量词；精确人数；角色 A 完整身份块 + 当前衣服 + 位置/动作；角色 B 完整身份块 + 当前衣服 + 位置/动作；互动关系；地点；镜头；光线。
必须加入 two separate bodies、both faces visible（剧情允许时）、clear body separation，并指定 on the left/on the right 或 foreground/background。不得用“Lucifer and Leviathan”代替两套完整描述。

双人示例：
[masterpiece, best quality, newest, high resolution, anime illustration, 2girls, exactly two adult women, two separate bodies, both faces visible, clear body separation, Lucifer on the left, adult woman, tall voluptuous build, pale skin, elegant oval face, very long golden-blonde hair, blue eyes, black thorn chains, (torn white ceremonial dress fragments between chains:1.25), Leviathan on the right, petite adult woman, slim build, pale skin, round doll-like face, long light-purple twin tails, straight bangs, large round purple eyes, (navy and black-purple gothic dress with water-pattern trim:1.25), (small gas-mask stuffed demon mascot perched on Leviathan's shoulder:1.25), Leviathan pointing at Lucifer's chains, dark throne room, medium two-shot, cinematic composition, crimson rim light]

# 五、唯一格式
剧情段落后空一行，输出一行 [English, comma-separated, prompt tags]，再空一行继续剧情。两个 Prompt 中间必须有各自对应正文。方括号只用于图片 Prompt；禁止 [Unnamed Persona]、选项、备注、代码块、<image>、image###、<imgthink>、镜头分析或候选评分。

回复末尾输出一个不可见计数标记 <!--IMG_COUNT:n-->，n 等于实际 Prompt 数。提交前逐张静默检查：紧邻剧情是否一致；所有可见人物是否齐全；每人固定身份块是否完整；多人是否分块定位；贝希摩斯等命名道具是否已视觉定义；服装、动作、地点是否为当前状态。

只输出剧情正文、原位内联 Prompt、末尾 IMG_COUNT，以及确有变量变化时的 <UpdateVariable>。
</JANIMA_v8_1_INLINE_IDENTITY_CONTRACT>`;

await writeFile(path, `${JSON.stringify(worldbook, null, 2)}\n`, 'utf8');
