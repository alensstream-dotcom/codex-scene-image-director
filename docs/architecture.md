# 架构

```text
主聊天模型
  → JANIMA v8.1 身份锁世界书（保留 v7.8.2 的 FM_DNA/变量体系）
  → 剧情段落 + 紧随其后的 [English prompt] + IMG_COUNT
  → 静默救援器（本地异常检查 + 身份 DNA，不渲染对话 UI）
  → 智绘姬原生按钮
  → JANIMA Galgame Turbo 8 步实时工作流
```

## 世界书

v8.1 采用强制动态合同：每轮正常剧情至少3张，地点/人物/服装/道具/动作阶段变化时4张，追逐、战斗或多地点高速转场时5–6张，硬上限6张。每张 Prompt 必须重复可见角色的固定脸、头发、眼睛、体型与标志服装；多人场景必须分别描述并定位每个人。

## 静默插件

插件只读取最新 assistant 消息，解析 Prompt、段落位置与 `IMG_COUNT`。它会删除旧版残留的 `.janima-rescue-panel`，从不向消息容器追加状态栏、工具栏或第二列。

本地纠错处理标点、空白、标签去重、明确的 `1girl → solo`、缺失构图词和完全重复 Prompt。只有 Prompt 真正存在人数冲突、身份锚点缺失或关键道具错误时，插件才通过 `generateQuietPrompt` 修复该条；若有效 Prompt 少于动态目标，则只返回段落索引和英文标签 JSON，再按字符位置插入。默认关闭逐图 AI 深度重审，正常 Prompt 不增加等待时间。

JANIMA 是 Anima 架构而不是 SD1.5/SDXL UNet，不能直接套用经典 IP-Adapter 工作流。角色连续性由完整逐图 DNA 保持；生成端恢复用户原有 Turbo LoRA，以 8 步实时出图，符合 Galgame 连续游玩的优先级。

## 按钮原位

st-chatu8 2.7.7 会按 Prompt 在原始回复中的字符位置创建 `.st-chatu8-image-button`。v8.1 强制 Prompt 紧跟剧情；插件只给真实图像 Prompt 按钮和其原生父节点添加正常文档流样式，并在智绘姬误判生成结束时唤醒其原生 DOM 重扫。对 `[Unnamed Persona]` 与 JSON Patch 数组等误生成按钮会静默隐藏。

## 可选后台 AI 审计

启用后，每轮只发送当前 assistant 回复、已有 Prompt 位置、`IMG_COUNT` 与相关角色 DNA。AI 只能返回删除、替换或在指定段落后插入 Prompt 的 JSON 补丁，不能重写剧情。解析、结构验证全部成功才写回；任何失败均保留原文。
