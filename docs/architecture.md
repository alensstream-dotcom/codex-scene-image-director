# 架构

## 固定职责

```text
主聊天模型
  → IMG-CONTRACT / IMG-GRAMMAR / CHARACTER-DNA 世界书
  → 当前回复中的 [scene tags] 与 <!--IMG_COUNT:n-->
  → 世界书生图救援器（只检查最新回复）
  → 智绘姬真实按钮
  → ComfyUI 固定工作流
```

- 世界书理解剧情、选镜头、处理动作服装和人物关系。
- 救援器解析、校验、确定性补强，并在用户点击时修复或补漏。
- 智绘姬识别方括号 Prompt、显示按钮并传输生成请求。
- ComfyUI 固定模型、采样、尺寸、质量和风格。

## 默认性能路径

新 assistant 消息完成后，插件只读取 `chat[messageId].mes` 一次，解析最后一个 `IMG_COUNT`，扫描独立方括号行，运行本地 validator 并渲染状态。它不扫描历史聊天、不更新长期记忆、不调用 `fetch`、不改正文。

## Prompt 识别

只有“整行方括号 + 至少三个英文逗号标签 + 明确视觉标签，或至少六个标签”才会被识别。Markdown 链接、短选项、对白方括号与 `[A, B, C]` 不会命中。每个命中记录字符偏移和段落索引，因此单 Prompt 替换和缺图插入不需要重写整条消息。

## 本地 validator

检查缺少/重复 `IMG_COUNT`、声明数量不匹配、末尾堆叠、中文、英文小说连接词、650 字符上限、重复 Prompt，以及 `1girl/2girls/solo/duo` 冲突。

本地补强只做：中文标点转英文逗号、空白/括号规范化、标签去重、明确 `1girl` 且非 `2girls` 时补 `solo`、完全缺镜头构图标签时补紧凑构图。它不会猜人物、服装、动作、地点或镜头。

## AI 边界与失败保护

- 修复单 Prompt：只发原 Prompt、前/所在/后一段剧情和当前相关角色 DNA。
- 修复本轮：只发当前这一条 assistant 回复、已有 Prompt、`IMG_COUNT`、缺失数和当前相关角色 DNA。
- 手动补图：只发选中段、相邻段、当前相关角色 DNA 和最近一个 Prompt 作为格式参考。

API 必须返回严格 JSON。解析、结构校验与数量校验全部成功后才写回；超时、HTTP 错误或 JSON 错误均保留原文。缓存 key 是 `messageId:messageContentHash:originalPromptHash:repairMode`。

## 智绘姬边界

适配基于 st-chatu8 2.7.7 源码和运行 DOM 核验出的 `.st-chatu8-image-button`。重新识别通过 SillyTavern `MESSAGE_UPDATED` 触发重新渲染，然后等待真实按钮。立即生图只调用该真实元素的 `click()`；没有按钮时记录 `not-found` 并报错，不发送猜测事件。

旧 0.7.0 自主导演、视觉长期记忆、PRISM、compilePrompt 和 Fast/Accurate 模式不在新入口中执行，保留于 `master` 与 `pre-rescue-rebuild-0.7.0`。
