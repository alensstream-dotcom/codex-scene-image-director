# 世界书生图静默救援器

正常链路：

```text
主模型 + JANIMA v8.0 单世界书 → 每轮3–6个原位 Prompt → 静默救援插件 → 智绘姬真实按钮 → ComfyUI
```

插件默认不在对话中显示状态栏、工具栏或第二列，不占正文宽度。智绘姬按钮保留在 Prompt 的原生位置：Prompt 紧跟哪段剧情，按钮和生成图片就出现在哪段剧情下。

## 安装

在 SillyTavern 扩展管理器填写：

```text
https://github.com/alensstream-dotcom/codex-scene-image-director.git
```

然后：

1. 导入 `worldbooks/JANIMA_v8_0_worldbook.json`。它基于用户原版 v7.8.2，保留 FM_DNA、场景变量与 UpdateVariable，启用新的每轮3–6张主生图合同。
2. 关闭旧 v7.8.2 主世界书，避免两套规则同时生效；已有 FM_DNA 变量数据不用删除。
3. 导入 `regex/JANIMA_rescue_regex.json`。
4. 智绘姬标记设置为 `[` 和 `]`，关闭 LLM 扩写、正文二次分析、自动重写和自动风格。

## 后台行为

- 静默检查最新 assistant 回复，不向 `.mes` 追加任何可见插件节点。
- 自动规范标点、去重、明确的 `solo` 与缺失构图词；本地处理不调用 AI。
- 删除完全重复的 Prompt。
- 如世界书本轮漏写 Prompt，静默调用酒馆当前模型补到至少3张；快节奏回复自动增加到4–6张。
- 如 Prompt 明确出现 `solo/1girl` 与第二人物互动等冲突，只让酒馆当前模型重写该条 Prompt，不改剧情。
- 给真实 `.st-chatu8-image-button` 添加原位正常文档流布局，不新建替代按钮。
- 自动唤醒智绘姬原生重扫，避免生成结束时误判“消息数量未增加”而漏掉按钮。
- 自动隐藏智绘姬对 `[Unnamed Persona]` 等非图像方括号的误识别按钮。
- 可选外部 API 审计可进一步删除低价值/错误图片 Prompt；不开也不影响上述当前模型兜底，任何失败都不覆盖原文。

## 世界书选图原则

- 每轮正常剧情至少3张：开场状态、核心动作/互动、结尾变化。
- 地点切换、新角色登场、换装、强表情、道具或动作阶段变化时增加到4张。
- 追逐、战斗、多地点高速转场可以5–6张，硬上限6张。
- 纯技术说明或用户明确要求不写剧情时才可以0张。
- 每个 Prompt 必须紧跟对应剧情，禁止堆到回复底部。

## 测试

```powershell
node --test tests/*.test.mjs
```

完整安装包：`JANIMA_worldbook_auto_image_v1_2_package.zip`。
