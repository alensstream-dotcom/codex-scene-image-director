# 剧情镜头导演

一个独立的 SillyTavern 文生图辅助插件。

核心流程：

1. 你手动选择或粘贴真正值得生图的剧情段落。
2. 插件读取自己的视觉记忆库，包括角色形象、服装、地点、世界观和画风。
3. 插件快速生成正向提示词、反向提示词和镜头卡。
4. 后台可选调用额外 OpenAI 兼容 API，异步维护视觉记忆，不阻塞文字生成和生图操作。

## GitHub 安装

在 SillyTavern 中打开：

`扩展 -> 安装扩展 -> 输入 Git URL`

填入：

`https://github.com/alensstream-dotcom/codex-scene-image-director.git`

安装完成后刷新 SillyTavern，在扩展设置里打开“剧情镜头导演”。

手机端同样使用这个链接；实际安装发生在运行 SillyTavern 的电脑或服务器上。

## 手动安装

也可以把整个 `codex-scene-image-director` 文件夹复制到 SillyTavern 的第三方扩展目录后刷新页面。

## 兼容

- 不依赖世界书。
- 不依赖智绘姬或 st-chatu8。
- 如果安装了“酒馆助手 / JS-Slash-Runner”，可以在插件中开启变量同步。

## 第一版范围

- 独立视觉记忆库
- 手选剧情段落生成提示词
- 最近消息选择
- 背景异步记忆更新
- OpenAI 兼容 API 配置
- 酒馆助手变量兼容层
- 手机端紧凑 UI

