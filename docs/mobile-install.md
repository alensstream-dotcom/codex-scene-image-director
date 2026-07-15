# 手机酒馆安装

## 需要的两个核心文件

- 插件安装地址：`https://github.com/alensstream-dotcom/codex-scene-image-director.git`
- 世界书直链：`https://github.com/alensstream-dotcom/codex-scene-image-director/releases/download/v1.11.5/JANIMA_v8_8_Galgame_SameReply_Ledger_Director.json`

必须另外安装智绘姬 `st-chatu8`，因为真正的生成图片按钮由智绘姬创建；本插件负责把主回复末尾的隐藏账本在本地变成原位 Prompt，并完成动作/女性/DNA/服装校验与手机视口重扫，不发第二次 LLM 请求，也不能代替智绘姬连接 ComfyUI。推荐同时导入正则：`https://github.com/alensstream-dotcom/codex-scene-image-director/releases/download/v1.11.5/JANIMA_rescue_regex.json`。

v8.8 世界书已使用 SillyTavern 原生变量宏，不需要额外安装 EJS、酒馆助手或 JS-Slash-Runner。

## 手机操作

1. 先确认智绘姬 `st-chatu8` 已安装并启用；再在手机 SillyTavern 的扩展管理器选择“安装扩展”，粘贴本插件安装地址并刷新页面。
2. 用手机浏览器下载世界书 JSON，在“世界信息/世界书”中导入并绑定到当前角色或聊天。
3. 关闭旧 JANIMA v7.8.2、v7.9、v8.1–v8.7 主生图世界书，只保留 v8.8；已有 FM_DNA 不用删除。
4. 导入正则 JSON；智绘姬的识别标记设为 `[` 和 `]`，关闭它的 LLM 扩写、二次分析与自动改写。
5. 智绘姬选择 ComfyUI。插件会自动选中 `JANIMA_Galgame_Turbo_8步_Anima原生提示词_v2`。
6. 插件确认版本为 v1.11.5 或更高；“回复后慢速 AI 审计/二次改写”保持关闭。v8.8 会在同一次主回复中提交隐藏账本，插件本地处理。

插件和世界书运行在手机浏览器里的 SillyTavern 前端；真正的 JANIMA 模型仍运行在 ComfyUI 所在电脑/服务器。手机必须能够通过当前酒馆配置访问该 ComfyUI 服务。

## 预期效果

- 只有1–2个独立女性事件时只给1–2个按钮；通常3个，确有4–6个不同快节奏事件时才增至4–6个。
- 同一持续动作不会换角度重复出图；后半段新动作或转折会得到对应原位按钮。
- 每张读取上一张图之后的完整剧情并选最佳女性画面。
- 成人剧情按动作阶段选赢家；首次进入、换体位和高潮结果不会再被普通触碰或静态姿势覆盖。
- 纯男性、纯场景和纯道具 Prompt 会被后台拦截。
- 插件不在聊天旁新增面板，适合手机单列阅读。
- 实机 QA 中，主回复开始到 4 个原位按钮全部出现为 3.48 秒，后台为 1 次聊天补全、0 次 fallback；实际 768×1024 Turbo 8 步生成为 6.57–8.16 秒。手机网络会影响页面显示，但不应再等 3 分钟的第二模型。
