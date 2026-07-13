# 世界书生图静默救援器

正常链路：

```text
主模型 + JANIMA v8.2 手机 Galgame 分镜世界书 → 逐段最佳女性 Prompt → 本地剧情窗口/女性门禁 → 智绘姬真实按钮 → JANIMA Galgame Turbo 8步工作流
```

插件默认不在对话中显示状态栏、工具栏或第二列，不占正文宽度。智绘姬按钮保留在 Prompt 的原生位置：Prompt 紧跟哪段剧情，按钮和生成图片就出现在哪段剧情下。

## 安装

在 SillyTavern 扩展管理器填写：

```text
https://github.com/alensstream-dotcom/codex-scene-image-director.git
```

然后：

1. 手机下载并导入 `worldbooks/JANIMA_v8_2_Galgame_Director.json`。兼容文件 `JANIMA_v8_0_worldbook.json` 内容相同；它保留 FM_DNA、场景变量与 UpdateVariable。v8.2 使用 SillyTavern 原生变量宏，不再依赖 EJS/JS-Slash-Runner。
2. 关闭旧 v7.8.2 主世界书，避免两套规则同时生效；已有 FM_DNA 变量数据不用删除。
3. 导入 `regex/JANIMA_rescue_regex.json`。
4. 智绘姬标记设置为 `[` 和 `]`，关闭 LLM 扩写、正文二次分析、自动重写和自动风格。

## 后台行为

- 静默检查最新 assistant 回复，不向 `.mes` 追加任何可见插件节点。
- 自动删除完全重复的 Prompt；不会在智绘姬按钮创建后改写其内容，避免界面新 Prompt 与实际 ComfyUI 旧 Prompt 不一致。
- 删除完全重复的 Prompt。
- 如世界书漏写 Prompt，静默调用酒馆当前模型按“上一张图之后的完整剧情窗口”补图；快节奏回复自动增加到4–6张。
- 自动拦截纯男性、纯场景、纯建筑、纯道具以及载荷与正文不一致的旧按钮。动态人数、动作和身份修正由世界书在按钮创建前完成；默认关闭逐图二次模型改写，正常 Prompt 直接进入快速生成。
- 每个可见命名角色在每张图中重复脸、发色/发型、瞳色、体型和标志服装锚点；双人图强制分角色块、左右/前后位置和独立身体。
- 自动安装并选中 `JANIMA_Galgame_Turbo_8步_Anima原生提示词_v2`：使用官方 Turbo 建议的 `anima-turbo-lora-v0.2`、8 步、CFG 1、`euler` + `normal`，并按 JANIMA/Anima 的原生质量标签顺序生成，优先保证聊天中的即时出图体验。
- 实机 A/B 后采用更稳的精简原生质量块 `masterpiece, best quality, score_7, highres, newest`，再按剧情只选一个 `safe / sensitive / nsfw / explicit`；不会把 `safe` 写死到成人剧情。画师标签只作为可选的单一 `@artist` 风格锁，同一聊天不得随镜头切换。
- 给真实 `.st-chatu8-image-button` 添加原位正常文档流布局，不新建替代按钮。
- 自动唤醒智绘姬原生重扫，避免生成结束时误判“消息数量未增加”而漏掉按钮。
- 自动隐藏智绘姬对 `[Unnamed Persona]` 等非图像方括号的误识别按钮。
- 可选外部 API 审计可进一步删除低价值/错误图片 Prompt；不开也不影响上述当前模型兜底，任何失败都不覆盖原文。

## v8.2 世界书选图原则

- 每张图读取“上一张 Prompt 之后到当前插入点”的完整剧情，不只看最后一句，不使用未来剧情。
- 从该窗口选择剧情后果、女性情绪、动作关系、视觉反差和镜头新鲜度最强的一帧。
- 每张必须有剧情中真实出现的女性；禁止单男、空镜、风景和纯道具。整轮没有女性时宁可0张，也不捏造女性。
- 正常含女性剧情目标3张：开场女性状态、核心互动高点、结尾变化；实际只有1–2个有效女性 beat 时不重复凑图。
- 地点切换、新角色登场、换装、强表情、道具或动作阶段变化时增加到4张。
- 追逐、战斗、多地点高速转场可以5–6张，硬上限6张。
- 每个 Prompt 必须紧跟对应剧情，禁止堆到回复底部。

## 测试

```powershell
node --test tests/*.test.mjs
```

手机安装说明见 `docs/mobile-install.md`。
