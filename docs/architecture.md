# 架构

```text
主聊天模型
  → JANIMA v8.0 单世界书（保留 v7.8.2 的 FM_DNA/变量体系）
  → 剧情段落 + 紧随其后的 [English prompt] + IMG_COUNT
  → 静默救援器（不渲染对话 UI）
  → 智绘姬原生按钮
  → ComfyUI
```

## 世界书

v8.0 采用强制动态合同：每轮正常剧情至少3张，地点/人物/服装/道具/动作阶段变化时4张，追逐、战斗或多地点高速转场时5–6张，硬上限6张。它保留原文件中的 DNA 初始化、DNA 注入和变量更新条目。

## 静默插件

插件只读取最新 assistant 消息，解析 Prompt、段落位置与 `IMG_COUNT`。它会删除旧版残留的 `.janima-rescue-panel`，从不向消息容器追加状态栏、工具栏或第二列。

本地纠错处理标点、空白、标签去重、明确的 `1girl → solo`、缺失构图词和完全重复 Prompt。若发现 `solo/1girl` 与第二人物互动等明确冲突，插件通过 `generateQuietPrompt` 只重写有问题的 Prompt；若有效 Prompt 少于动态目标，则只返回段落索引和英文标签 JSON，再按字符位置插入。两条路径都不重写剧情，也不需要单独填写 API。

## 按钮原位

st-chatu8 2.7.7 会按 Prompt 在原始回复中的字符位置创建 `.st-chatu8-image-button`。v8.0 强制 Prompt 紧跟剧情；插件只给真实图像 Prompt 按钮和其原生父节点添加正常文档流样式，并在智绘姬误判生成结束时唤醒其原生 DOM 重扫。对 `[Unnamed Persona]` 与 JSON Patch 数组等误生成按钮会静默隐藏。

## 可选后台 AI 审计

启用后，每轮只发送当前 assistant 回复、已有 Prompt 位置、`IMG_COUNT` 与相关角色 DNA。AI 只能返回删除、替换或在指定段落后插入 Prompt 的 JSON 补丁，不能重写剧情。解析、结构验证全部成功才写回；任何失败均保留原文。
