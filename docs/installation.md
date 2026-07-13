# 安装

1. 在 SillyTavern 扩展管理器安装 `https://github.com/alensstream-dotcom/codex-scene-image-director.git`，刷新页面。
2. 导入 `worldbooks/JANIMA_v8_0_worldbook.json`。
3. 关闭旧 v7.8.2 主世界书，避免两套主生图合同同时触发；已有 FM_DNA 变量数据保留。
4. 导入 `regex/JANIMA_rescue_regex.json`，第三条 UpdateVariable 规则保持关闭，除非确实需要隐藏变量更新。
5. 智绘姬使用 ComfyUI 模式，开始/结束标记设置为 `[` / `]`，关闭智绘姬 LLM 扩写与二次改写。
6. 刷新后对话区域应保持单列；插件不会显示“生图检查”或 Prompt 工具栏。
7. 默认已启用“缺图自动兜底”：当世界书输出少于3个有效 Prompt 时，使用酒馆当前模型静默补齐，无需额外 API Key。独立 AI 审计仍是可选功能。

未配置 API 时，世界书正常生成 Prompt，插件只做静默本地纠错和真实按钮原位布局。AI 审计失败时不会覆盖正文。
