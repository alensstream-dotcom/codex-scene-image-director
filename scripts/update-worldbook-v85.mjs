import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = new URL('../worldbooks/JANIMA_v8_4_Galgame_Director.json', import.meta.url);
const outputPath = new URL('../worldbooks/JANIMA_v8_5_Galgame_Director.json', import.meta.url);
const worldbook = JSON.parse(await readFile(sourcePath, 'utf8'));

worldbook.entries['2'].comment = 'DNA注入提示-JANIMA v8.5 Galgame连续性锁';
worldbook.entries['3'].comment = '[mvu_update]DNA/场景/分镜锚点更新规则-v8.5';
worldbook.entries['3'].content = worldbook.entries['3'].content.replaceAll('v8.4', 'v8.5');
worldbook.entries['4'].comment = '本体-JANIMA v8.5手机Galgame即时直出导演-流式Prompt/本地兜底';

let content = worldbook.entries['4'].content
    .replaceAll('JANIMA_v8_4_MOBILE_GALGAME_EVENT_LEDGER_DIRECTOR', 'JANIMA_v8_5_MOBILE_GALGAME_STREAMING_DIRECTOR')
    .replaceAll('【v8.4核心】', '【v8.5核心】')
    .replace('世界书先建立整轮事件账本，再按剧情显著性选镜与写 Prompt；插件在后台复核主体—动作—对象—结果、成人动作阶段、高潮覆盖、人物连续性和原位按钮。', '世界书先在构思中建立整轮事件账本；正式回复时正文与 Prompt 一次生成，Prompt 紧跟对应事件流式输出。插件只做即时本地原位整理与漏图兜底，默认禁止第二次 LLM 重排。');

content = content.replace('# 零、整轮事件表【输出前必须静默完成】', `# 负一、即时直出协议【v8.5最高执行优先级】
- 本轮所有 Prompt 必须由当前这一次剧情回复直接写出，绝不等待插件、智绘姬内部 LLM 或回复结束后的第二次模型调用。
- 构思阶段可以先静默规划整轮事件，但正式输出时必须按“剧情段落 → 该事件 Prompt → 下一段剧情”的顺序流式写出。一个 Prompt 的方括号闭合后，智绘姬即可立即识别按钮。
- 禁止先输出完整正文，再把全部 Prompt 堆到结尾；禁止只输出 IMG_COUNT 却没有 Prompt；禁止把 Prompt 放入 thinking、details、代码块、变量块或隐藏区。
- 正常女性剧情至少直接输出 3 个 Prompt；快节奏按真实阶段输出 4–6 个。若回复长度接近上限，优先保留已规划的 Prompt 与正文，缩短气氛描写、状态总结和变量更新，绝不省略后半段关键动作 Prompt。
- 每个 Prompt 必须一次写完整且以 ] 闭合，禁止半截标签、占位符、稍后补充或让插件改写。插件的即时本地兜底只是防止模型偶发漏写，不是正常生产路径。

# 零、整轮事件表【输出前必须静默完成】`);

content = content.replace('提交前逐张静默确认：已列出主体—动作—对象—结果；', '提交前逐张静默确认：每个 Prompt 已在同一次回复中紧跟对应剧情而不是留给第二次 LLM；已列出主体—动作—对象—结果；');

worldbook.entries['4'].content = content;
await writeFile(outputPath, `${JSON.stringify(worldbook, null, 2)}\n`, 'utf8');
