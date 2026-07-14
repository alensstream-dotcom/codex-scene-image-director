import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = new URL('../worldbooks/JANIMA_v8_3_Galgame_Director.json', import.meta.url);
const outputPath = new URL('../worldbooks/JANIMA_v8_4_Galgame_Director.json', import.meta.url);
const worldbook = JSON.parse(await readFile(sourcePath, 'utf8'));

worldbook.entries['2'].comment = 'DNA注入提示-JANIMA v8.4 Galgame连续性锁';
worldbook.entries['3'].comment = '[mvu_update]DNA/场景/分镜锚点更新规则-v8.4';
worldbook.entries['3'].content = worldbook.entries['3'].content.replaceAll('v8.3', 'v8.4');
worldbook.entries['4'].comment = '本体-JANIMA v8.4手机Galgame事件账本导演-关键动作/NSFW阶段/高潮选帧';

let content = worldbook.entries['4'].content
    .replaceAll('JANIMA_v8_3_MOBILE_GALGAME_STORYBOARD_DIRECTOR', 'JANIMA_v8_4_MOBILE_GALGAME_EVENT_LEDGER_DIRECTOR')
    .replace('世界书先规划整轮独立事件，再选镜与写 Prompt；插件在后台复核事件覆盖、合并重复动作、重排前密后疏的按钮，并保持原位显示。', '世界书先建立整轮事件账本，再按剧情显著性选镜与写 Prompt；插件在后台复核主体—动作—对象—结果、成人动作阶段、高潮覆盖、人物连续性和原位按钮。');

content = content.replace('# 一、每张图的取材窗口【最重要】', `# 零点五、事件账本与高潮赢家【v8.4核心】
- 对每个可见女性事件静默记录四元组：主体/发起者；核心物理动作；接收者或对象；动作造成的可见结果。缺少核心动作的背景、解释、回忆、普通对白和气氛句只算支撑信息，不能单独抢走图片位。
- 同时记录动作前后状态：人物数量、身体接触关系、相对位置/体位、服装或裸露、关键道具、地点、冲突阶段、女性情绪方向。只要其中发生不可逆或剧情明确的变化，就是新的候选事件。
- 每个取材窗口必须比较全部候选再选赢家。优先级：产生后果的女性关键动作或高潮 > 改变身体接触/体位/关系/胜负的动作 > 强烈情绪反转或揭露 > 登场/换装/地点道具变化 > 普通反应。最后一句不是天然赢家，描写最长也不是天然赢家。
- Prompt 只画赢家事件的一帧，但要继承窗口内已经确定的人物身份、当前服装/裸露、道具和地点。禁止把整个窗口概括成站立、跪坐、脸红、拥抱或卧室肖像而丢掉真正的核心动作。
- 按钮放在赢家所属事件组完整结束之后；若后续只是同一动作的持续描写，不再出图；若接触关系、动作施受、体位、服装状态、结果或情绪方向改变，则建立新事件。

# 一、每张图的取材窗口【最重要】`);

content = content.replace('# 五、剧情对齐', `# 四点六、成人动作阶段账本【不得合并关键阶段】
- 成人亲密剧情按阶段识别：脱衣/裸露变化；爱抚或挑逗；手部刺激；口部互动；首次进入/结合；同体位持续动作；明确换体位；高潮/射精及可见结果；事后照料。阶段名称只用于静默判断，不输出分析。
- “首次进入”“明确换体位”“高潮/射精结果”永远是独立高显著事件，不能因为段落相邻、人物相同或都属于性行为而合并。它们在自己的取材窗口中出现时必须参与赢家比较，不能被普通抚摸、喘息、脸红或静态姿势取代。
- 同一体位、同一施受关系下反复抽送、喘息或细小力度变化属于一个持续事件，最多一张；只有正文明确改变体位、主动权、接触部位、参与者、服装状态、地点、高潮阶段或可见结果才开新事件。
- 成人 Prompt 采用稳定命名角色 ID，明确成年人数、发起者、接收者、接触部位、当前相对位置/体位与可见结果。动作关系用一条简洁直接的英文自然语言短句表达，其余用 Anima 标签；不要用含糊代词、隐喻或同时堆多个动作。
- 动作描述占 Prompt 的主要语义，背景、灯光和装饰只能辅助。若模型空间关系复杂，优先保留“谁对谁做什么”和当前体位，删除不重要的左右手、复杂朝向与背景细节。

# 五、剧情对齐`);

content = content.replace('提交前逐张静默确认：取材窗口正确；每张核心动作签名互不重复；', '提交前逐张静默确认：已列出主体—动作—对象—结果；赢家确实比窗口内其他候选更有后果和画面感；成人阶段没有漏掉首次进入、换体位或高潮结果；每张核心动作签名互不重复；');

worldbook.entries['4'].content = content;
await writeFile(outputPath, `${JSON.stringify(worldbook, null, 2)}\n`, 'utf8');
