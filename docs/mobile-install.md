# 手机酒馆安装

## 需要的两个核心文件

- 插件安装地址：`https://github.com/alensstream-dotcom/codex-scene-image-director.git`
- 世界书直链：`https://github.com/alensstream-dotcom/codex-scene-image-director/releases/download/v1.5.0/JANIMA_v8_2_Galgame_Director.json`

推荐同时导入正则：`https://github.com/alensstream-dotcom/codex-scene-image-director/releases/download/v1.5.0/JANIMA_rescue_regex.json`，避免历史 Prompt 和 IMG_COUNT 回灌给模型。

## 手机操作

1. 在手机 SillyTavern 的扩展管理器选择“安装扩展”，粘贴插件安装地址并刷新页面。
2. 用手机浏览器下载世界书 JSON，在“世界信息/世界书”中导入并绑定到当前角色或聊天。
3. 关闭旧 JANIMA v7.8.2、v7.9、v8.1 主生图世界书，只保留 v8.2；已有 FM_DNA 不用删除。
4. 导入正则 JSON；智绘姬的识别标记设为 `[` 和 `]`，关闭它的 LLM 扩写、二次分析与自动改写。
5. 智绘姬选择 ComfyUI。插件会自动选中 `JANIMA_Galgame_Turbo_8步_角色锁_v1`。

插件和世界书运行在手机浏览器里的 SillyTavern 前端；真正的 JANIMA 模型仍运行在 ComfyUI 所在电脑/服务器。手机必须能够通过当前酒馆配置访问该 ComfyUI 服务。

## 预期效果

- 正常含女性剧情目标3个原位按钮，快节奏时4–6个。
- 每张读取上一张图之后的完整剧情并选最佳女性画面。
- 纯男性、纯场景和纯道具 Prompt 会被后台拦截。
- 插件不在聊天旁新增面板，适合手机单列阅读。
