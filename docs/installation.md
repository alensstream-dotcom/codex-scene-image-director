# 安装

1. 在 SillyTavern 扩展管理器安装 `https://github.com/alensstream-dotcom/codex-scene-image-director.git`，刷新页面。
2. 导入 `worldbooks/JANIMA_v8_5_Galgame_Director.json`。
3. 关闭旧 v7.8.2、v7.9、v8.1、v8.2、v8.3 主世界书，避免两套主生图合同同时触发；已有 FM_DNA 变量数据保留。
4. 导入 `regex/JANIMA_rescue_regex.json`，第三条 UpdateVariable 规则保持关闭，除非确实需要隐藏变量更新。
5. 智绘姬使用 ComfyUI 模式，开始/结束标记设置为 `[` / `]`，关闭智绘姬 LLM 扩写与二次改写。
6. 刷新后对话区域应保持单列；插件不会显示“生图检查”或 Prompt 工具栏。
7. 默认让主回复保持纯剧情，结束后只调用当前模型一次完成整轮分镜；启用持续动作合并、动作类型校验、女性门禁、人物 DNA 锁和手机视口重扫。主回复同步 Prompt、逐图改写与外部 API 深度审计均默认关闭。
8. 插件会自动安装并选中智绘姬工作流 `JANIMA_Galgame_Turbo_8步_Anima原生提示词_v2`，恢复 Turbo LoRA 和 8 步实时生成，并启用 JANIMA/Anima 原生质量标签顺序。

无需另配 API；批量分镜复用当前聊天模型连接。可选外部 AI 审计失败时不会覆盖正文。
