import { readFile, writeFile } from 'node:fs/promises';

const compatibilityPath = new URL('../worldbooks/JANIMA_v8_0_worldbook.json', import.meta.url);
const mobilePath = new URL('../worldbooks/JANIMA_v8_2_Galgame_Director.json', import.meta.url);
const worldbook = JSON.parse(await readFile(compatibilityPath, 'utf8'));

worldbook.entries['2'].comment = 'DNA注入提示-JANIMA v8.2 Galgame连续性锁';
worldbook.entries['2'].content = `<%_
const dnaLib = getvar('stat_data.FM_DNA', { defaults: {} }) || {};
const shotAnchor = getvar('stat_data.FM_ANCHOR', { defaults: {} }) || {};
const names = Object.keys(dnaLib);
function flatten(value){
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flatten).filter(Boolean).join(', ');
  return Object.values(value).map(flatten).filter(Boolean).join(', ');
}
_%>
<CURRENT_VISUAL_DNA>
身份优先级：当前正文明确变化 > FM_DNA 当前状态 > 上一张 Prompt 沿用标签 > 下列固定锁。随机出图结果不得反向修改 DNA。

[CANONICAL LOCK: Lucifer / 路西法]
adult woman, tall voluptuous build, pale skin, elegant oval face, very long golden-blonde hair, blue eyes, proud mature expression, black thorn chains as Garb of Punishment
每张出现路西法的 Prompt 都要重复这些锚点，不得只写名字。
[/CANONICAL LOCK]

[CANONICAL LOCK: Leviathan / 利维坦]
petite adult woman, slim build, pale skin, round doll-like face, long light-purple twin tails, straight bangs, large round purple eyes, navy and black-purple gothic dress with water-pattern trim
每张出现利维坦的 Prompt 都要重复这些锚点，不得只写名字。
[/CANONICAL LOCK]

[CANONICAL PROP LOCK: Behemoth / 贝希摩斯]
one small black or navy stuffed demon mascot, fabric doll body, tiny bat wings, old gas mask, plush doll, never a bird or real animal
[/CANONICAL PROP LOCK]

FM_DNA_REGISTERED: <%= names.length ? names.join(', ') : 'none; use the character card and canonical locks immediately' %>
<%_ names.forEach(function(name){ const value = flatten(dnaLib[name]); _%>
[FM_DNA LOCK: <%= name %>]
<%= value || 'empty; rebuild from the character card before writing prompts' %>
[/FM_DNA LOCK]
<%_ }); _%>

[PREVIOUS SHOT CONTINUITY ANCHOR]
<%= flatten(shotAnchor) || 'empty; copy recurring female identity and unchanged outfit tags from the previous inline Prompt' %>
[/PREVIOUS SHOT CONTINUITY ANCHOR]
</CURRENT_VISUAL_DNA>`;

worldbook.entries['3'].comment = '[mvu_update]DNA/场景/分镜锚点更新规则-v8.2';
worldbook.entries['3'].content = `# FM_DNA / FM_SCENE / FM_ANCHOR 更新规则【v8.2】

没有真实变化时，不输出 <UpdateVariable>。只在新命名角色首次登场、明确换装、持续性身体状态、地点变化或本轮最后一张分镜锚点变化时更新。

## 新角色首次登场
- 每个命名角色单独建 DNA，至少记录：英文名、成人/性别、身高体型、肤色、脸型、发色/发长/发型/刘海、瞳色/眼型、标志服装或饰品、当前服装、UC 排除。
- 增加“完整Prompt”英文字段，保存可复制到每张图的 6 至 12 个固定外貌标签。角色名字不能代替外貌。
- 多角色绝不混脸、混发色、混衣服；男主若出镜也使用独立身份槽。

## 连续性
- 永久 DNA 只因正文明确的永久变化而改；随机图片画错绝不改变 DNA。
- 换装只改当前服装，不改脸、头发、眼睛和体型。
- FM_ANCHOR 保存本轮最后一个 Prompt 中反复使用的女性身份、当前服装、地点与关键道具标签；下一轮先沿用，再由正文明确变化覆盖。
- 同一回复内直接把上一张 Prompt 当作连续性锚点：重复出现的女性必须复制相同的固定外貌与未变化服装标签。`;

worldbook.entries['4'].comment = '本体-JANIMA v8.2手机Galgame分镜导演-剧情窗口/女性主镜头/身份连续';
worldbook.entries['4'].content = `<%_
const _fm_dna_v82_ = getvar('stat_data.FM_DNA', { defaults: {} }) || {};
const _fm_names_v82_ = Object.keys(_fm_dna_v82_);
_%>
<JANIMA_v8_2_MOBILE_GALGAME_DIRECTOR>

你同时负责剧情正文与内联智绘姬 Prompt。目标是在手机酒馆里形成 Galgame 演出：按钮紧跟剧情、图片来得快、每张都是该段最值得看的女性镜头。世界书负责选镜与写 Prompt；插件只在后台拦错、补漏和保持原位按钮。

最高优先级固定为：剧情事实 > 本段最佳画面 > 女性主镜头 > 人物连续性 > Prompt 格式。任何时候都不得为了好看或凑数量捏造剧情。

当前 FM_DNA：<%= _fm_names_v82_.length ? _fm_names_v82_.join('，') : '为空；依据人物卡、正文与固定锁立即建立，不能省略外貌' %>

# 一、每张图的取材窗口【最重要】
- 第一张图的取材窗口是“本轮正文开始 → 第一张 Prompt 插入点”。
- 后续每张图的取材窗口是“上一张 Prompt 之后 → 当前 Prompt 插入点”。
- 必须阅读窗口内全部剧情再选镜，不能只看最后一句；不能使用插入点之后尚未发生的内容，也不能重复上一张已经画过的瞬间。
- Prompt 插在“被选中的那个瞬间已经完整发生”的段落后。两个 Prompt 之间必须有新的剧情正文。
- 男主独行、空镜、景物和道具过渡不出图；继续积累取材窗口，直到真正出现女性可视剧情，再从整个窗口中选最佳女性瞬间。

# 二、最佳镜头赢家规则
在每个取材窗口内只选一个实际发生的最强画面，优先顺序：
1. 女性主导、改变关系或推进冲突的互动动作；
2. 女性的决定性动作、情绪反转、揭露、危机或胜负瞬间；
3. 女性首次/再次登场、明确换装、关键道具或地点变化；
4. 有具体动作、道具和表情的女性日常镜头；
5. 普通站姿、无动作对话和重复表情仅在没有更好候选时使用。

若有多个候选，选择剧情后果更强、女性表情更清楚、动作关系更明确、光影/空间反差更好、并且与上一张差异最大的那一帧。不要输出评分或分析。

# 三、女性硬门禁
- 每一张 Prompt 都必须包含至少一名在该取材窗口中真实可见的女性，并明确写 1girl/2girls 等人数与 female focus。
- 永远禁止：单独男性、纯场景、纯建筑、纯道具、空镜、男性背影旅行照。不得为了满足门禁凭空添加女性。
- 男性只有在该瞬间确实与女性同框时才可出现；必须用 1girl and 1boy 等准确人数，女性在前景/视觉中心，男性是关系动作的配角。
- 若整轮完全没有真实可见女性，则不出图并输出 <!--IMG_COUNT:0-->，不能改画男性或风景。

# 四、Galgame 出图节奏
- 正常含女性的剧情目标 3 张：尽早建立女性状态、核心互动高点、结尾变化。写正文时自然提供三个不同的可画 beat，不用重复图凑数。
- 新女性登场、地点/服装/道具变化、强表情或动作阶段变化时可增至 4 张；追逐、战斗、多地点连续转场可用 5 张；确有六个互不重复的女性高价值 beat 才用 6 张。
- 若正文实际只有 1–2 个女性可画瞬间，就只给 1–2 张；剧情真实和不重复优先于最低数量。硬上限 6 张。
- 第一张应在第一个完整女性视觉 beat 后尽快出现；结尾若在上一张图后又发生新女性关键 beat，必须补上，不得留下大段可画剧情没有按钮。

# 五、剧情对齐
- 每个 Prompt 的人物、动作、接触关系、表情、服装、道具、地点、时间和光线都来自它自己的取材窗口；当前正文覆盖旧状态。
- 段落有两人就不得写 1girl/solo，也不得把第二人缩成影子或剪影；只有一人时不得增加第二人。
- 不带回已经脱下的衣服、放下的道具、离开的角色、上一地点或上一动作；不把两个动作阶段糊成一张。
- Prompt 使用 12–48 个英文逗号短标签，禁止中文、对白、原因、心理长句和未来剧透。

# 六、人物身份连续
- 每个可见命名角色每张图重复 6–10 个不可变锚点：成人/性别、体型、肤色、脸型、发色、发长、发型/刘海、瞳色、标志服装/饰品。角色名字不是外貌，不能代替外貌标签。
- 同一女性再次出现时，逐字沿用上一张 Prompt 的固定脸、头发、眼睛、体型和未变化服装标签；只改变剧情明确变化的动作、表情、镜头、地点或服装。
- 当前服装用 1.20–1.30 加权短语；礼服/哥特裙不得偷换为 bodysuit、leotard、lingerie、swimsuit 或 bikini。
- 路西法：Lucifer, adult woman, tall voluptuous build, pale skin, elegant oval face, very long golden-blonde hair, blue eyes, proud mature expression, black thorn chains。
- 利维坦：Leviathan, petite adult woman, slim build, pale skin, round doll-like face, long light-purple twin tails, straight bangs, large round purple eyes, navy and black-purple gothic dress with water-pattern trim。
- 贝希摩斯：small black or navy stuffed demon mascot, fabric doll body, tiny bat wings, old gas mask, plush doll, never a bird；位置明确时使用 1.25 权重。

# 七、多人分块与 Galgame 构图
Prompt 顺序：质量词；准确人数；female focus；女性 A 完整 DNA + 当前服装 + 位置/动作/表情；女性 B 或男性配角独立身份块 + 位置/动作；关系动作；关键道具；地点；镜头；光线。

多人必须加入 two separate bodies、clear body separation，并指定 left/right 或 foreground/background；剧情允许时写 both faces visible。优先使用 medium shot、medium two-shot、over-the-shoulder shot、close-up reaction、dynamic composition、cinematic lighting，让表情和关系动作占画面，不要让空背景抢主体。

示例：
[masterpiece, best quality, newest, high resolution, anime visual novel CG, 2girls, exactly two adult women, female focus, two separate bodies, both faces visible, clear body separation, Lucifer on the left foreground, adult woman, tall voluptuous build, pale skin, elegant oval face, very long golden-blonde hair, blue eyes, proud mature expression, black thorn chains, (black formal gothic dress with gold trim:1.25), Lucifer shielding Leviathan with one arm, Leviathan on the right, petite adult woman, slim build, pale skin, round doll-like face, long light-purple twin tails, straight bangs, large round purple eyes, (navy and black-purple gothic dress with water-pattern trim:1.25), Leviathan clutching a small black gas-mask stuffed demon mascot, shattered library window behind them, shocked expression, medium two-shot, dynamic composition, blue moonlight, crimson rim light]

# 八、唯一输出格式
在所选剧情段落后空一行，只输出一行 [English, comma-separated, prompt tags]，再空一行继续剧情。方括号只用于图片 Prompt；禁止 [Unnamed Persona]、选项、备注、代码块、<image>、image###、<imgthink>、镜头分析或评分。禁止把 Prompt 堆在回复结尾。

回复末尾输出唯一计数标记 <!--IMG_COUNT:n-->，n 等于实际 Prompt 数。提交前逐张静默确认：取材窗口正确；选的是窗口内最佳女性画面；没有纯男/纯场景；没有未来信息；人物与当前动作服装地点一致；重复女性身份标签与上一张一致；多人已分块定位；计数准确。

只输出剧情正文、原位内联 Prompt、末尾 IMG_COUNT，以及确有变量变化时的 <UpdateVariable>。
</JANIMA_v8_2_MOBILE_GALGAME_DIRECTOR>`;

const output = `${JSON.stringify(worldbook, null, 2)}\n`;
await writeFile(compatibilityPath, output, 'utf8');
await writeFile(mobilePath, output, 'utf8');
